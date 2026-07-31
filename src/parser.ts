import type { CourseRef, Equivalency, ParseOutcome, ParsedRow, Verdict } from "./types";

/**
 * Pure parsing functions. No network, no chrome.* — runs in the offscreen
 * document (extension) and jsdom (tests). Correctness lives here.
 *
 * Invariants from docs/purdue-endpoint.md §6 — do not regress:
 *  - lenient HTML parsing only (titles contain raw `&`)
 *  - course numbers are opaque strings (111H, 063)
 *  - continuation rows (blank leading cells) belong to the previous course
 *  - unrecognized layout => loud UNKNOWN, never a guess
 */

const EXPECTED_HEADERS = [
  "Transfer School",
  "Transfer Subject",
  "Transfer Course",
  "Transfer Title",
  "Transfer Credits",
  "Purdue Subject",
  "Purdue Course",
  "Purdue Title",
  "Purdue Credits",
];

const DIRECT_RE = /^\d{5}$/;
const ELECTIVE_RE = /^\dX[A-Z]{3}$/;
/** † = Transfer Indiana initiative marker (appears inside the course cell). */
const DAGGER_CAVEAT = "Part of the Transfer Indiana initiative (†)";

function cellText(el: Element): string {
  return (el.textContent ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

function parseCredits(s: string): number | null {
  const n = Number(s.replace(/[^\d.]/g, ""));
  return s.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

export function classifyPurdueCourse(number: string): Equivalency["kind"] {
  if (DIRECT_RE.test(number)) return "DIRECT";
  if (ELECTIVE_RE.test(number)) return "ELECTIVE";
  if (number === "NC") return "NOCREDIT"; // seen live: OSU "Precollege Math" -> MA NC
  return "UNKNOWN";
}

/**
 * Parse the p_display_report HTML.
 * Shapes (fixtures in tests/fixtures/):
 *  - table.reportTable present  -> rows (with continuation-row grouping)
 *  - Results <h2> but no table  -> ok:true, results: [] (NONE for all queried)
 *  - neither                    -> HEADER/SECTION mismatch -> caller maps to UNKNOWN
 */
export function parseReportHtml(html: string): ParseOutcome {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const table = doc.querySelector("table.reportTable");
  if (!table) {
    const hasResultsHeader = [...doc.querySelectorAll("h2")].some((h) =>
      /Results/i.test(h.textContent ?? ""),
    );
    return hasResultsHeader
      ? { ok: true, results: [] }
      : { ok: false, reason: "NO_RESULTS_SECTION" };
  }

  const headers = [...table.querySelectorAll("th")]
    .map(cellText)
    .filter((t) => t !== "");
  const headerOk = EXPECTED_HEADERS.every((h, i) => headers[i] === h);
  if (!headerOk) return { ok: false, reason: "HEADER_MISMATCH" };

  const results: ParsedRow[] = [];
  for (const tr of table.querySelectorAll("tr")) {
    const tds = [...tr.querySelectorAll("td")];
    if (tds.length !== 9) continue; // header/footer rows

    const texts = tds.map(cellText);
    const [school, subj, courseRaw, title, credits, pSubj, pCourse, pTitle, pCredits] =
      texts as [string, string, string, string, string, string, string, string, string];

    const caveats: string[] = [];
    let number = courseRaw;
    if (/[†]|&dagger;/.test(courseRaw)) {
      caveats.push(DAGGER_CAVEAT);
      number = courseRaw.replace(/[†]/g, "").trim();
    }

    const equivalency: Equivalency = {
      subject: pSubj,
      number: pCourse,
      title: pTitle,
      credits: parseCredits(pCredits),
      kind: classifyPurdueCourse(pCourse),
    };

    const isContinuation = school === "" && subj === "" && number === "";
    const prev = results[results.length - 1];
    if (isContinuation && prev) {
      prev.equivalencies.push(equivalency);
      continue;
    }

    results.push({
      transfer: { school, subject: subj, number, title, credits: parseCredits(credits) },
      equivalencies: [equivalency],
      caveats,
    });
  }

  return { ok: true, results };
}

/** Derive an overall verdict from a course's equivalencies. */
export function deriveVerdict(equivalencies: Equivalency[]): Verdict {
  if (equivalencies.length === 0) return "NONE";
  if (equivalencies.some((e) => e.kind === "UNKNOWN")) return "UNKNOWN";
  const credited = equivalencies.filter((e) => e.kind !== "NOCREDIT");
  if (credited.length === 0) return "NONE"; // an explicit "NC" row = no credit granted
  const direct = credited.some((e) => e.kind === "DIRECT");
  const elective = credited.some((e) => e.kind === "ELECTIVE");
  if (direct && elective) return "PARTIAL";
  return direct ? "DIRECT" : "ELECTIVE";
}

/**
 * Parse the newline-delimited `Display~VALUE` payload from bzwtxcrd.p_ajax.
 * First line echoes the load_into id — skip it, and never inject it into DOM.
 */
export function parseAjaxList(body: string): { label: string; value: string }[] {
  return body
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.includes("~"))
    .map((l) => {
      const i = l.lastIndexOf("~");
      return { label: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
    })
    .filter((e) => e.value !== "");
}

/**
 * Extract course refs from messy highlighted text.
 * Handles: "CSCI 240", "CS-240", "CSCI240", "CSCI 111H", 4-digit numbering
 * ("PSYCH 1100", "COP 3502" — OSU/UCF/Texas style), long subjects
 * ("COMPSCI 61A"), lists. Always returns strings; UI must allow correction.
 */
/**
 * Subject, then an optional separator, then the number — which may carry a
 * leading letter, possibly space-separated: IU writes "MATH-M 211" and Purdue
 * stores it as subject MATH / course M211, so the letter belongs to the number.
 */
const COURSE_RE = /\b([A-Z]{2,8})[\s\-–—]?([A-Z]\s?)?(\d{2,4}[A-Z]{0,2})\b/g;

/**
 * Words that precede numbers in ordinary prose but are never course subjects.
 * Load-bearing: without this, widening the regex makes "Fall 2024" a course
 * and the highlight chip pops on "Room 204" in Gmail (bug #9 in hardest-bugs).
 */
const NOISE_SUBJECTS = new Set([
  "AT", "IN", "ON", "TO", "OF", "BY", "OR", "AND", "THE", "FOR", "PER", "VS",
  "FALL", "SPRING", "SUMMER", "WINTER", "TERM", "SEMESTER", "YEAR", "SESSION",
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "SEPT", "OCT", "NOV", "DEC",
  "MON", "TUE", "TUES", "WED", "THU", "THURS", "FRI", "SAT", "SUN",
  "ROOM", "RM", "BLDG", "BUILDING", "HALL", "FLOOR", "SUITE", "STE", "APT", "UNIT", "BOX",
  "PAGE", "PG", "CH", "CHAPTER", "SEC", "SECTION", "VOL", "NO", "NUM", "ITEM", "STEP",
  "AGE", "GPA", "EST", "AM", "PM", "MIN", "MAX", "TOP", "ZIP", "EXT", "FAX", "TEL", "PHONE",
  "GRADE", "LEVEL", "WEEK", "DAY", "COVID", "CREDIT", "CREDITS", "COST", "PRICE", "TOTAL",
  // all-caps acronyms that survive the casing check but are never course subjects
  "HTTP", "HTTPS", "ISO", "NASA", "FBI", "CIA", "FAA", "FDA", "EPA", "IRS", "DMV", "TSA",
  "USA", "USD", "EUR", "GBP", "PDF", "HTML", "JSON", "XML", "URL", "URI", "FAQ", "ASAP",
  "ISBN", "ISSN", "SSN", "VIN", "GRE", "GMAT", "LSAT", "MCAT", "TOEFL", "IELTS", "PSAT",
  "HIV", "LED", "LCD", "USB", "HDMI", "RAM", "CPU", "GPU", "SSD", "DVD", "MP3", "MP4",
  "FPS", "RPM", "MPH", "KPH", "BMI", "PSI", "BTU", "KWH", "GDP", "CPI", "ROI", "IPO",
  "NFL", "NBA", "MLB", "NHL", "NCAA", "ESPN", "CNN", "BBC", "NPR", "PBS", "HBO",
  "LLC", "INC", "LTD", "VIP", "RSVP", "PO", "FYI", "TBD", "TBA", "ETC", "AKA",
]);

export interface ParseOptions {
  /**
   * Require the subject to be ALL-CAPS in the SOURCE text (as catalogs write
   * them: "MATH 211", "PSYCH 1100"). Without this, uppercasing the selection
   * first turns every prose word into a candidate — "Windows 11", "iPhone 15",
   * "Boeing 747", "Apollo 11" all parsed as courses. Use for the highlight
   * chip (must be conservative); leave off when the user explicitly typed or
   * requested the lookup.
   */
  requireUppercaseSubject?: boolean;
}

export function parseCourseFromText(raw: string, opts: ParseOptions = {}): CourseRef[] {
  const text = raw.replace(/\s+/g, " ").trim();
  const upper = text.toUpperCase();
  const seen = new Set<string>();
  const refs: CourseRef[] = [];

  for (const m of upper.matchAll(COURSE_RE)) {
    const subject = m[1]!;
    // letter prefix (if any) joins the number, space-stripped: "M 211" -> "M211"
    const number = `${(m[2] ?? "").replace(/\s/g, "")}${m[3]!}`;
    if (NOISE_SUBJECTS.has(subject)) continue;
    // compare against the ORIGINAL casing at the same offset
    if (opts.requireUppercaseSubject) {
      const original = text.slice(m.index ?? 0, (m.index ?? 0) + subject.length);
      if (original !== subject) continue;
    }
    const key = `${subject} ${number}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Title heuristic: text after a dash/colon following the match, up to EOL/next course
    const after = text.slice((m.index ?? 0) + m[0].length);
    const titleMatch = after.match(/^\s*[-–—:]\s*([^\n|;]{3,80}?)(?=\s+[A-Z]{2,5}[\s\-]?\d{2,3}\b|$)/);

    refs.push({
      subject,
      number,
      title: titleMatch?.[1]?.trim(),
      // separator-present matches ("CSCI 240") are higher confidence than glued ("CSCI240")
      confidence: /[\s\-–—]/.test(m[0]) ? 0.9 : 0.6,
      rawText: m[0],
    });
  }
  return refs;
}
