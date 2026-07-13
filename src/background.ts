import { cacheGet, cacheSet, cacheSweep, RESULT_TTL, resultKey, SCHOOL_LIST_TTL, schoolListKey } from "./cache";
import type { BgRequest } from "./messages";
import { deriveVerdict, parseAjaxList, parseCourseFromText } from "./parser";
import { domainToSchool } from "./school-map";
import { chunkCourses, fetchAjaxList, fetchReportHtml, Throttle } from "./transfer-client";
import type { ParseOutcome, TransferReport, TransferResult } from "./types";

/** Service worker: orchestration only. Parsing -> offscreen doc; correctness -> pure modules. */

const throttle = new Throttle(1, 3);

const GLOBAL_CAVEATS = [
  "Unofficial — confirm with your advisor or the Purdue Registrar.",
  "Only courses from regionally accredited institutions, C- or higher.",
  "Articulations older than 10 years have been removed and may need re-review.",
];

// ---------- offscreen parsing ----------

let offscreenReady: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  offscreenReady ??= (async () => {
    const has = await chrome.offscreen.hasDocument();
    if (!has) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.DOM_PARSER],
        justification: "Parse Purdue Banner result HTML (DOMParser unavailable in service workers)",
      });
    }
  })();
  return offscreenReady;
}

async function parseInOffscreen(html: string): Promise<ParseOutcome> {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ kind: "PARSE_REPORT_HTML", html });
}

// ---------- lookup orchestration ----------

async function doLookup(req: Extract<BgRequest, { kind: "LOOKUP" }>): Promise<TransferReport> {
  const now = new Date().toISOString();
  const items: TransferResult[] = [];
  const misses: { subject: string; number: string }[] = [];

  // cache first
  for (const c of req.courses) {
    const hit = await cacheGet<TransferResult>(resultKey(req.schoolCode, c.subject, c.number));
    if (hit) items.push({ ...hit, sourceKind: "CACHE" });
    else misses.push({ subject: c.subject.toUpperCase().trim(), number: c.number.toUpperCase().trim() });
  }

  for (const chunk of chunkCourses(misses)) {
    await throttle.take();
    const html = await fetchReportHtml({
      location: req.location, state: req.state, schoolCode: req.schoolCode, courses: chunk,
    });
    const outcome = await parseInOffscreen(html);

    for (const c of chunk) {
      let result: TransferResult;
      if (!outcome.ok) {
        // Loud UNKNOWN: unrecognized layout — never guess (parser drift canary).
        result = {
          source: { school: req.schoolName, schoolCode: req.schoolCode, ...c },
          verdict: "UNKNOWN",
          equivalencies: [],
          totalCredits: null,
          caveats: [
            `Could not read Purdue's response (${outcome.reason}). Check the official page directly.`,
            ...GLOBAL_CAVEATS,
          ],
          sourceKind: "LIVE",
          fetchedAt: now,
        };
      } else {
        // Banner returns rows alphabetized — match by (subject, number), never index.
        const row = outcome.results.find(
          (r) => r.transfer.subject === c.subject && r.transfer.number === c.number,
        );
        if (!row) {
          result = {
            source: { school: req.schoolName, schoolCode: req.schoolCode, ...c },
            verdict: "NONE",
            equivalencies: [],
            totalCredits: null,
            caveats: [
              "No articulation on file. You may request an evaluation: transfercredit@purdue.edu",
              ...GLOBAL_CAVEATS,
            ],
            sourceKind: "LIVE",
            fetchedAt: now,
          };
        } else {
          const credits = row.equivalencies.reduce<number | null>(
            (acc, e) => (e.credits == null ? acc : (acc ?? 0) + e.credits),
            null,
          );
          result = {
            source: {
              school: req.schoolName, schoolCode: req.schoolCode,
              subject: c.subject, number: c.number, title: row.transfer.title,
            },
            verdict: deriveVerdict(row.equivalencies),
            equivalencies: row.equivalencies,
            totalCredits: credits,
            caveats: [...row.caveats, ...GLOBAL_CAVEATS],
            sourceKind: "LIVE",
            fetchedAt: now,
          };
        }
        await cacheSet(resultKey(req.schoolCode, c.subject, c.number), result, RESULT_TTL);
      }
      items.push(result);
    }
  }

  const summary = {
    direct: items.filter((i) => i.verdict === "DIRECT").length,
    elective: items.filter((i) => i.verdict === "ELECTIVE").length,
    partial: items.filter((i) => i.verdict === "PARTIAL").length,
    none: items.filter((i) => i.verdict === "NONE").length,
    unknown: items.filter((i) => i.verdict === "UNKNOWN").length,
    totalCredits: items.reduce((a, i) => a + (i.totalCredits ?? 0), 0),
  };

  return { school: req.schoolName, schoolCode: req.schoolCode, items, summary, generatedAt: now };
}

async function doAjaxList(req: Extract<BgRequest, { kind: "AJAX_LIST" }>) {
  const key = req.type === "school" ? schoolListKey(req.values[1] ?? "", req.values[0]) : null;
  if (key) {
    const hit = await cacheGet<{ label: string; value: string }[]>(key);
    if (hit) return hit;
  }
  await throttle.take();
  const body = await fetchAjaxList(req.type, req.values);
  const list = parseAjaxList(body);
  if (key && list.length) await cacheSet(key, list, SCHOOL_LIST_TTL);
  return list;
}

// ---------- message router ----------

chrome.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object" || !("kind" in msg)) return false;
  // offscreen parse replies are handled by the offscreen doc itself
  if ((msg as { kind: string }).kind === "PARSE_REPORT_HTML") return false;

  (async () => {
    try {
      switch (msg.kind) {
        case "LOOKUP":
          sendResponse({ ok: true, report: await doLookup(msg) });
          break;
        case "AJAX_LIST":
          sendResponse({ ok: true, list: await doAjaxList(msg) });
          break;
        case "DETECT_SCHOOL": {
          const s = domainToSchool(msg.hostname);
          sendResponse({ ok: true, school: s ? { code: s.code, name: s.name, location: s.location, state: s.state } : null });
          break;
        }
        case "PARSE_SELECTION":
          sendResponse({ ok: true, courses: parseCourseFromText(msg.text) });
          break;
      }
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  })();
  return true; // async response
});

chrome.runtime.onInstalled.addListener(() => {
  void cacheSweep();
  chrome.contextMenus.create({
    id: "ptc-check",
    title: "Check Purdue transfer credit for \"%s\"",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "ptc-check" && tab?.id != null && info.selectionText) {
    void chrome.tabs.sendMessage(tab.id, { kind: "CHECK_SELECTION", text: info.selectionText });
  }
});
