/**
 * E2E QA: drives real Chromium with the built extension (dist/) via Playwright.
 * Live Purdue lookups — run locally, not in CI. Also captures 1280×800 store screenshots.
 *   npm run build && node scripts/e2e-qa.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const DIST = resolve("dist");
const SHOTS = resolve("docs/screenshots");
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true, // new headless supports extensions on the chromium channel
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});

try {
  // ---- extension id via its service worker ----
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent("serviceworker", { timeout: 10_000 });
  const extId = new URL(sw.url()).host;
  check("extension service worker registered", !!extId, extId);

  // ---- fake Ivy Tech catalog page so domain auto-detection kicks in ----
  await context.route("https://www.ivytech.edu/qa-catalog/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><head><meta charset="utf-8"></head><body style="font:16px/1.6 system-ui,sans-serif;margin:0;color:#222">
        <div style="background:#00563F;color:#fff;padding:14px 40px;font-weight:600">
          Ivy Tech Community College &nbsp;·&nbsp; Course Catalog 2026–27</div>
        <div style="padding:36px 40px;max-width:760px">
          <h1 style="margin:0 0 4px;font-size:26px">Mathematics</h1>
          <p style="color:#666;margin:0 0 26px">Associate of Science · Transfer pathway</p>
          <div style="border:1px solid #e0e0e0;border-radius:6px;padding:18px 20px;margin-bottom:14px">
            <p id="course" style="margin:0 0 6px;font-size:19px;font-weight:600">MATH 211 - Calculus I</p>
            <p style="margin:0;color:#555">4 credits · Prerequisite: MATH 136 or placement.
            Limits, derivatives, and integrals of algebraic and transcendental functions.</p>
          </div>
          <div style="border:1px solid #e0e0e0;border-radius:6px;padding:18px 20px">
            <p style="margin:0 0 6px;font-size:19px;font-weight:600">MATH 212 - Calculus II</p>
            <p style="margin:0;color:#555">4 credits · Techniques of integration, sequences and series.</p>
          </div>
        </div></body></html>`,
    }),
  );

  // ================= A. Popup: 10-course batch =================
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.fill("#schoolSearch", "ivy tech community");
  await popup.waitForFunction(() => document.querySelectorAll("#school option").length > 0);
  const firstSchool = await popup.locator("#school option").first().textContent();
  check("global search finds Ivy Tech", /Ivy Tech/i.test(firstSchool ?? ""), firstSchool ?? "");
  const autoSel = await popup.locator("#selected").textContent();
  check("top match auto-selected (no manual click needed)", /Ivy Tech/i.test(autoSel ?? ""), autoSel ?? "");
  await popup.fill("#courses",
    "MATH 211, CHEM 105, CSCI 201, ENGL 111, PSYC 101, MATH 080, ENGL 063, FIRE 101, DENT 101, SOCI 111");
  await popup.click("#check");
  await popup.waitForSelector("#results .summary", { timeout: 45_000 });
  const counts = {};
  for (const v of ["DIRECT", "PARTIAL", "ELECTIVE", "NONE", "UNKNOWN"]) {
    counts[v] = await popup.locator(`#results .card.${v}`).count();
  }
  // Live-verified 2026-07-13: SOCI 111 -> SOC 10000 (direct!), ENGL 063 -> ENGL NC (-> NONE)
  check("batch: 3 DIRECT (MATH 211, PSYC 101, SOCI 111)", counts.DIRECT === 3, JSON.stringify(counts));
  check("batch: 1 PARTIAL (CHEM 105)", counts.PARTIAL === 1);
  check("batch: 2 ELECTIVE (CSCI 201, ENGL 111)", counts.ELECTIVE === 2);
  check("batch: 4 NONE (MATH 080, ENGL 063->NC, FIRE 101, DENT 101)", counts.NONE === 4);
  check("batch: 0 UNKNOWN", counts.UNKNOWN === 0);
  const chem = await popup
    .locator(".card.PARTIAL li")
    .allTextContents();
  check("CHEM 105 shows 3 equivalency rows", chem.length === 3, chem.join(" | "));
  const disclaimer = await popup.locator(".disclaimer").textContent();
  check("disclaimer visible", /Unofficial/i.test(disclaimer ?? ""));
  await popup.screenshot({ path: `${SHOTS}/popup-batch.png` });

  // ================= B. Global search (the UND bug) =================
  await popup.fill("#schoolSearch", "north dakota");
  await popup.waitForTimeout(300);
  const opts = await popup.locator("#school option").allTextContents();
  check("UND findable regardless of default state", opts.some((o) => /Univ Of North Dakota.*\(ND\)/i.test(o)),
    opts.slice(0, 3).join(" | "));
  // bug #12: slow async init used to wipe the user's search results
  await popup.waitForTimeout(4000);
  const stillThere = await popup.locator("#selected").textContent();
  check("search survives async init (no clobber)", /North Dakota/i.test(stillThere ?? ""), stillThere ?? "");

  // ================= C. Cache populated =================
  const stored = await sw.evaluate(() => chrome.storage.local.get(null));
  const resultKeys = Object.keys(stored).filter((k) => k.startsWith("r:003825:"));
  check("results cached in chrome.storage.local", resultKeys.length >= 10, `${resultKeys.length} keys`);

  // ================= D. Highlight flow on 'ivytech.edu' =================
  // Clear the key first so a stale entry from the batch above cannot make the
  // chip-click assertion pass falsely.
  await sw.evaluate(() => chrome.storage.local.remove("r:003825:MATH:211"));

  const page = await context.newPage();
  await page.goto("https://www.ivytech.edu/qa-catalog/math.html");
  const rect = await page.evaluate(() => {
    const r = document.getElementById("course").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const upX = rect.x + rect.w - 2;
  const upY = rect.y + rect.h / 2;
  // Real mouse drag; synthetic events are deliberately ignored (security finding 1).
  // Note: mousedown *inside* an existing selection starts a text drag in Chrome,
  // so always collapse the selection before re-selecting.
  const select = async () => {
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await page.mouse.click(5, 5);
    await page.mouse.move(rect.x + 2, upY);
    await page.mouse.down();
    await page.mouse.move(upX, upY, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  };

  await select();
  await page.screenshot({ path: `${SHOTS}/highlight-chip.png` });
  check("chip appears on a real selection gesture",
    await page.evaluate(() => !!document.querySelector('div[id^="ptc-"]')));

  // Click the chip: it renders at (min(upX, vw-160), upY+8), ~26px tall.
  const clickX = Math.min(upX, 1280 - 160) + 55;
  const clickY = upY + 8 + 13;
  check("chip is hit-testable at its rendered position",
    await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return !!el && /^ptc-/.test(el.id);
    }, [clickX, clickY]));
  await page.mouse.click(clickX, clickY);

  let landed = false;
  for (let i = 0; i < 30 && !landed; i++) {
    await page.waitForTimeout(500);
    landed = await sw.evaluate(async () =>
      Object.keys(await chrome.storage.local.get(null)).includes("r:003825:MATH:211"));
  }
  check("chip click performed a real lookup (cache key written fresh)", landed);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/highlight-card.png` });
  check("result card is painted where the chip was",
    await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y + 30); // card is taller than the chip
      return !!el && /^ptc-/.test(el.id);
    }, [clickX, clickY]));

  // ---- hostile-page probes, run last so they can't disturb the flow above ----
  const synthetic = await page.evaluate(() => {
    document.querySelector('div[id^="ptc-"]')?.remove();
    const el = document.getElementById("course");
    const r = document.createRange();
    r.selectNodeContents(el.firstChild);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 5, clientY: 5 }));
    return new Promise((res) =>
      setTimeout(() => res(!!document.querySelector('div[id^="ptc-"]')), 400),
    );
  });
  check("synthetic events cannot induce our UI (no fingerprinting)", synthetic === false);
  check("host element id is randomized (not a fixed fingerprint)",
    !(await page.evaluate(() => !!document.getElementById("purdue-transfer-check-root"))));

  // ================= E. Nonsense course -> clean NONE =================
  await popup.bringToFront();
  await popup.fill("#schoolSearch", "ivy tech community");
  await popup.waitForTimeout(300);
  await popup.fill("#courses", "ZZZZ 999");
  await popup.click("#check");
  // wait for the NEW render (old batch results are still in the DOM until it lands)
  await popup.waitForFunction(
    () => document.querySelectorAll("#results .card").length === 1,
    undefined,
    { timeout: 45_000 },
  );
  const noneCount = await popup.locator("#results .card.NONE").count();
  const unkCount = await popup.locator("#results .card.UNKNOWN").count();
  check("nonsense course -> NONE, not UNKNOWN/error", noneCount === 1 && unkCount === 0,
    `NONE=${noneCount} UNKNOWN=${unkCount}`);
  const evalLink = await popup.locator(".card.NONE .caveats").first().textContent();
  check("NONE card offers evaluation contact", /transfercredit@purdue\.edu/.test(evalLink ?? ""));

  // ================= F. Bug #9 regression: 4-digit course at OSU =================
  await popup.fill("#schoolSearch", "ohio state");
  await popup.waitForTimeout(300);
  await popup.fill("#courses", "PSYCH 1100");
  await popup.click("#check");
  await popup.waitForFunction(
    () => document.querySelector("#results .card")?.textContent?.includes("PSYCH 1100"),
    undefined,
    { timeout: 45_000 },
  );
  const osuCard = await popup.locator("#results .card").first().textContent();
  check("4-digit course parses and resolves (OSU PSYCH 1100 -> PSY 12000)",
    /Direct credit/.test(osuCard ?? "") && /PSY 12000/.test(osuCard ?? ""),
    (osuCard ?? "").slice(0, 80));
} finally {
  await context.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots -> docs/screenshots/`);
process.exit(failed.length ? 1 : 0);
