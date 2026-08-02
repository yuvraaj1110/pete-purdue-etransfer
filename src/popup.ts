import { sendBg } from "./messages";
import { parseCourseFromText } from "./parser";
import { searchSchoolIndex, SCHOOL_INDEX, type IndexedSchool } from "./school-index";
import type { TransferReport, TransferResult } from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const schoolSel = $<HTMLSelectElement>("school");
const schoolSearch = $<HTMLInputElement>("schoolSearch");
const selectedDiv = $<HTMLDivElement>("selected");
const coursesTa = $<HTMLTextAreaElement>("courses");
const checkBtn = $<HTMLButtonElement>("check");
const resultsDiv = $<HTMLDivElement>("results");

/**
 * The picker runs entirely off the bundled index — no network on open. The old
 * version fetched the state list from Purdue and re-rendered when it landed,
 * which silently wiped whatever the user had already typed (bug #12).
 * Each school entry carries its own location/state, so the user never picks them.
 */
let visibleSchools: IndexedSchool[] = [];
let selectedSchool: IndexedSchool | null = null;
let defaultState = "IN";

function showSelection(): void {
  if (selectedSchool) {
    selectedDiv.className = "selected";
    selectedDiv.textContent = `Selected: ${selectedSchool.n} (${selectedSchool.s})`;
  } else {
    selectedDiv.className = "selected none";
    selectedDiv.textContent = "No school selected";
  }
}

function renderSchools(list: IndexedSchool[]): void {
  visibleSchools = list;
  schoolSel.innerHTML = "";
  list.forEach((e, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = `${e.n} (${e.s})`;
    schoolSel.append(o);
  });
  // Auto-select the top match so "type then press Check" just works — users
  // reasonably expect the visible first result to be the one used.
  if (list.length > 0) {
    schoolSel.selectedIndex = 0;
    selectedSchool = list[0] ?? null;
  } else {
    selectedSchool = null;
  }
  showSelection();
}

function defaultList(): IndexedSchool[] {
  return SCHOOL_INDEX.filter((e) => e.l === "US" && e.s === defaultState);
}

function parseCourseLines(text: string): { subject: string; number: string }[] {
  // Single source of truth: the same parser the content script and background
  // use (a second regex here is how 4-digit numbers stayed broken in one path).
  return parseCourseFromText(text).map((r) => ({ subject: r.subject, number: r.number }));
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
  const school = selectedSchool;
  const schoolCode = school?.c ?? "";
  const schoolName = school?.n ?? "";
  if (!courses.length || !schoolCode) {
    resultsDiv.innerHTML = `<div class="err">${
      schoolCode ? "Enter at least one course like “MATH 211”." : "Search for and select your school first."
    }</div>`;
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
  renderSchools(q ? searchSchoolIndex(q) : defaultList());
});

schoolSel.addEventListener("change", () => {
  selectedSchool = visibleSchools[schoolSel.selectedIndex] ?? null;
  showSelection();
});

void (async () => {
  // Render immediately from the bundled index; auto-detection only refines it,
  // and never overwrites a list the user has already searched.
  renderSchools(defaultList());
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    const res = await sendBg({ kind: "DETECT_SCHOOL", hostname: new URL(tab.url).hostname });
    if (!("school" in res) || !res.ok || !res.school) return;
    if (schoolSearch.value.trim() !== "") return; // user is already typing — leave them alone
    const hit = SCHOOL_INDEX.find((e) => e.c === res.school!.code) ?? null;
    if (!hit) return;
    defaultState = hit.s;
    renderSchools([hit, ...SCHOOL_INDEX.filter((e) => e.l === hit.l && e.s === hit.s && e.c !== hit.c)]);
  } catch {
    /* auto-detect is a convenience; the picker works without it */
  }
})();
