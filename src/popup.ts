import { sendBg } from "./messages";
import { searchSchools } from "./school-map";
import type { TransferReport, TransferResult } from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const locationSel = $<HTMLSelectElement>("location");
const stateSel = $<HTMLSelectElement>("state");
const schoolSel = $<HTMLSelectElement>("school");
const schoolSearch = $<HTMLInputElement>("schoolSearch");
const coursesTa = $<HTMLTextAreaElement>("courses");
const checkBtn = $<HTMLButtonElement>("check");
const resultsDiv = $<HTMLDivElement>("results");

let allSchools: { label: string; value: string }[] = [];

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

async function loadSchools(): Promise<void> {
  const res = await sendBg({
    kind: "AJAX_LIST", type: "school", values: [stateSel.value, locationSel.value],
  });
  if ("list" in res && res.ok) {
    allSchools = res.list;
    renderSchools(allSchools);
  }
}

function renderSchools(list: { label: string; value: string }[]): void {
  schoolSel.innerHTML = "";
  for (const s of list) {
    const o = document.createElement("option");
    o.value = s.value;
    o.textContent = s.label;
    schoolSel.append(o);
  }
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
  const schoolCode = schoolSel.value;
  const schoolName = schoolSel.selectedOptions[0]?.textContent ?? "";
  if (!courses.length || !schoolCode) {
    resultsDiv.innerHTML = `<div class="err">Pick a school and enter at least one course like “MATH 211”.</div>`;
    return;
  }
  checkBtn.disabled = true;
  checkBtn.textContent = "Checking…";
  try {
    const res = await sendBg({
      kind: "LOOKUP", location: locationSel.value, state: stateSel.value,
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

schoolSearch.addEventListener("input", () => renderSchools(searchSchools(allSchools, schoolSearch.value)));
locationSel.addEventListener("change", async () => { await loadStates(); await loadSchools(); });
stateSel.addEventListener("change", loadSchools);

void (async () => {
  // Pre-fill from active tab: detected school + any highlighted course text
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await loadStates();
  await loadSchools();
  if (tab?.url) {
    try {
      const host = new URL(tab.url).hostname;
      const res = await sendBg({ kind: "DETECT_SCHOOL", hostname: host });
      if ("school" in res && res.ok && res.school) {
        locationSel.value = res.school.location;
        stateSel.value = res.school.state;
        await loadSchools();
        schoolSel.value = res.school.code;
      }
    } catch { /* non-fatal */ }
  }
})();
