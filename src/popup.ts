import { sendBg } from "./messages";
import { searchSchoolIndex, SCHOOL_INDEX, type IndexedSchool } from "./school-index";
import type { TransferReport, TransferResult } from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const locationSel = $<HTMLSelectElement>("location");
const stateSel = $<HTMLSelectElement>("state");
const schoolSel = $<HTMLSelectElement>("school");
const schoolSearch = $<HTMLInputElement>("schoolSearch");
const coursesTa = $<HTMLTextAreaElement>("courses");
const checkBtn = $<HTMLButtonElement>("check");
const resultsDiv = $<HTMLDivElement>("results");

/** Global search over the bundled index — every school Purdue articulates from. */
let visibleSchools: IndexedSchool[] = [];

async function loadStates(): Promise<void> {
  const res = await sendBg({ kind: "AJAX_LIST", type: "states", values: [locationSel.value] });
  if ("list" in res && res.ok) {
    stateSel.innerHTML = "";
    for (const s of res.list) {
      const o = document.createElement("option");
      o.value = s.value;
      o.textContent = s.label;
      if (s.value === "IN") o.selected = true;
      stateSel.append(o);
    }
  }
}

function schoolsForCurrentState(): IndexedSchool[] {
  return SCHOOL_INDEX.filter((e) => e.l === locationSel.value && e.s === stateSel.value);
}

function renderSchools(list: IndexedSchool[]): void {
  visibleSchools = list;
  schoolSel.innerHTML = "";
  list.forEach((e, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = e.s === stateSel.value ? e.n : `${e.n} (${e.s})`;
    schoolSel.append(o);
  });
}

/** Selecting a search hit syncs location + state so the lookup query is correct. */
async function syncToSelectedSchool(): Promise<IndexedSchool | null> {
  const e = visibleSchools[Number(schoolSel.value)];
  if (!e) return null;
  if (locationSel.value !== e.l) {
    locationSel.value = e.l;
    await loadStates();
  }
  stateSel.value = e.s;
  return e;
}

function parseCourseLines(text: string): { subject: string; number: string }[] {
  return text
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.toUpperCase().match(/([A-Z]{2,5})[\s\-–—]*(\d{2,3}[A-Z]{0,2})/);
      return m ? { subject: m[1]!, number: m[2]! } : null;
    })
    .filter((c): c is { subject: string; number: string } => c !== null);
}

function verdictLabel(v: TransferResult["verdict"]): string {
  return {
    DIRECT: "✅ Direct credit",
    PARTIAL: "🟡 Partial (direct + elective)",
    ELECTIVE: "🟡 Elective/undistributed credit",
    NONE: "❌ No equivalency on file",
    UNKNOWN: "❓ Could not determine",
  }[v];
}

function render(report: TransferReport): void {
  resultsDiv.innerHTML = "";
  const s = report.summary;
  const sum = document.createElement("div");
  sum.className = "summary";
  sum.textContent =
    `${s.direct} direct · ${s.partial} partial · ${s.elective} elective · ${s.none} none` +
    (s.unknown ? ` · ${s.unknown} unknown` : "") +
    ` — ~${s.totalCredits} transferable credits`;
  resultsDiv.append(sum);

  for (const item of report.items) {
    const card = document.createElement("div");
    card.className = `card ${item.verdict}`;
    const title = document.createElement("div");
    title.innerHTML = `<span class="v">${item.source.subject} ${item.source.number}</span> — ${verdictLabel(item.verdict)}`;
    card.append(title);

    if (item.equivalencies.length) {
      const ul = document.createElement("ul");
      ul.className = "eq";
      for (const e of item.equivalencies) {
        const li = document.createElement("li");
        li.textContent = `${e.subject} ${e.number} — ${e.title}${e.credits != null ? ` (${e.credits} cr)` : ""}`;
        ul.append(li);
      }
      card.append(ul);
    }

    const cav = document.createElement("div");
    cav.className = "caveats";
    cav.textContent = item.caveats[0] ?? "";
    card.append(cav);
    resultsDiv.append(card);
  }
}

checkBtn.addEventListener("click", async () => {
  const courses = parseCourseLines(coursesTa.value);
  const school = await syncToSelectedSchool();
  const schoolCode = school?.c ?? "";
  const schoolName = school?.n ?? "";
  if (!courses.length || !schoolCode) {
    resultsDiv.innerHTML = `<div class="err">Pick a school and enter at least one course like “MATH 211”.</div>`;
    return;
  }
  checkBtn.disabled = true;
  checkBtn.textContent = "Checking…";
  try {
    const res = await sendBg({
      kind: "LOOKUP", location: school!.l, state: school!.s,
      schoolCode, schoolName, courses,
    });
    if ("report" in res && res.ok) render(res.report);
    else resultsDiv.innerHTML = `<div class="err">${"error" in res ? res.error : "Lookup failed"}</div>`;
  } catch (e) {
    resultsDiv.innerHTML = `<div class="err">${e instanceof Error ? e.message : String(e)}</div>`;
  } finally {
    checkBtn.disabled = false;
    checkBtn.textContent = "Check transfer credit";
  }
});

schoolSearch.addEventListener("input", () => {
  const q = schoolSearch.value.trim();
  renderSchools(q ? searchSchoolIndex(q) : schoolsForCurrentState());
});
locationSel.addEventListener("change", async () => {
  await loadStates();
  renderSchools(schoolsForCurrentState());
});
stateSel.addEventListener("change", () => renderSchools(schoolsForCurrentState()));

void (async () => {
  // Pre-fill from active tab: detected school + any highlighted course text
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await loadStates();
  renderSchools(schoolsForCurrentState());
  if (tab?.url) {
    try {
      const host = new URL(tab.url).hostname;
      const res = await sendBg({ kind: "DETECT_SCHOOL", hostname: host });
      if ("school" in res && res.ok && res.school) {
        locationSel.value = res.school.location;
        await loadStates();
        stateSel.value = res.school.state;
        renderSchools(schoolsForCurrentState());
        const i = visibleSchools.findIndex((e) => e.c === res.school!.code);
        if (i >= 0) schoolSel.value = String(i);
      }
    } catch { /* non-fatal */ }
  }
})();
