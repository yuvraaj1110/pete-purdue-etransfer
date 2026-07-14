import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { describe, expect, it } from "vitest";
import {
  classifyPurdueCourse,
  deriveVerdict,
  parseAjaxList,
  parseCourseFromText,
  parseReportHtml,
} from "../src/parser";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("parseReportHtml", () => {
  it("parses a DIRECT result (MATH 211 -> MA 16500)", () => {
    const out = parseReportHtml(fixture("direct.html"));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.results).toHaveLength(1);
    const r = out.results[0]!;
    expect(r.transfer).toMatchObject({
      school: "Ivy Tech Community College-IN",
      subject: "MATH",
      number: "211",
      credits: 4,
    });
    expect(r.equivalencies).toEqual([
      { subject: "MA", number: "16500", title: "Anlytc Geomtry&Calc I", credits: 4, kind: "DIRECT" },
    ]);
    // dagger marker stripped from number, surfaced as caveat
    expect(r.caveats.some((c) => c.includes("Transfer Indiana"))).toBe(true);
    expect(deriveVerdict(r.equivalencies)).toBe("DIRECT");
  });

  it("parses an ELECTIVE result (CSCI 201 -> CS 2XUND)", () => {
    const out = parseReportHtml(fixture("undistributed.html"));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const r = out.results[0]!;
    expect(r.equivalencies[0]).toMatchObject({ subject: "CS", number: "2XUND", kind: "ELECTIVE" });
    expect(deriveVerdict(r.equivalencies)).toBe("ELECTIVE");
  });

  it("returns empty results (NONE) when Results header present but no table", () => {
    const out = parseReportHtml(fixture("no-match.html"));
    expect(out).toEqual({ ok: true, results: [] });
  });

  it("groups continuation rows: CHEM 105 -> 3 Purdue courses, PARTIAL verdict", () => {
    const out = parseReportHtml(fixture("batch5.html"));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const chem = out.results.find((r) => r.transfer.subject === "CHEM");
    expect(chem).toBeDefined();
    expect(chem!.equivalencies.map((e) => e.number)).toEqual(["11510", "11520", "1XTRA"]);
    expect(chem!.equivalencies.map((e) => e.kind)).toEqual(["DIRECT", "DIRECT", "ELECTIVE"]);
    expect(deriveVerdict(chem!.equivalencies)).toBe("PARTIAL");
  });

  it("parses all 5 batch courses (alphabetized by Banner, not request order)", () => {
    const out = parseReportHtml(fixture("batch5.html"));
    if (!out.ok) throw new Error("parse failed");
    expect(out.results.map((r) => `${r.transfer.subject} ${r.transfer.number}`)).toEqual([
      "BIOL 101",
      "CHEM 105",
      "CSCI 201",
      "ENGL 111",
      "MATH 211",
    ]);
  });

  it("fails LOUDLY (not silently) on an unrecognized page", () => {
    const out = parseReportHtml("<html><body><p>Totally different page</p></body></html>");
    expect(out).toEqual({ ok: false, reason: "NO_RESULTS_SECTION" });
  });

  it("fails LOUDLY on header drift", () => {
    const html = `<html><body><h2>Create a Report by Transfer School Course - Results</h2>
      <table class="reportTable"><tr><th>Different</th><th>Columns</th></tr>
      <tr><td>a</td><td>b</td><td>c</td><td>d</td><td>e</td><td>f</td><td>g</td><td>h</td><td>i</td></tr>
      </table></body></html>`;
    expect(parseReportHtml(html)).toEqual({ ok: false, reason: "HEADER_MISMATCH" });
  });
});

describe("classifyPurdueCourse", () => {
  it.each([
    ["16500", "DIRECT"],
    ["11510", "DIRECT"],
    ["2XUND", "ELECTIVE"],
    ["1XSCI", "ELECTIVE"],
    ["1XUWC", "ELECTIVE"],
    ["1XTRA", "ELECTIVE"],
    ["1XXXX", "ELECTIVE"],
    ["3XXXX", "ELECTIVE"],
    ["NC", "NOCREDIT"],
    ["WEIRD", "UNKNOWN"],
    ["165", "UNKNOWN"],
    ["", "UNKNOWN"],
  ])("%s -> %s", (num, kind) => {
    expect(classifyPurdueCourse(num)).toBe(kind);
  });
});

describe("deriveVerdict", () => {
  const eq = (kind: "DIRECT" | "ELECTIVE" | "NOCREDIT" | "UNKNOWN") => ({
    subject: "X", number: "0", title: "", credits: null, kind,
  });
  it("empty -> NONE", () => expect(deriveVerdict([])).toBe("NONE"));
  it("any UNKNOWN kind poisons to UNKNOWN (never guess)", () =>
    expect(deriveVerdict([eq("DIRECT"), eq("UNKNOWN")])).toBe("UNKNOWN"));
  it("direct+elective -> PARTIAL", () =>
    expect(deriveVerdict([eq("DIRECT"), eq("ELECTIVE")])).toBe("PARTIAL"));
  it("explicit NC row -> NONE (OSU 'MA NC' case, seen live)", () =>
    expect(deriveVerdict([eq("NOCREDIT")])).toBe("NONE"));
  it("NC alongside real credit doesn't drag the verdict down", () =>
    expect(deriveVerdict([eq("DIRECT"), eq("NOCREDIT")])).toBe("DIRECT"));
});

describe("parseAjaxList", () => {
  it("parses Display~VALUE lines, skipping the echoed load_into id", () => {
    const body = "schoolSelect1\nIvy Tech Community College-IN~003825\nBall State Univ Muncie-IN~001051\n";
    expect(parseAjaxList(body)).toEqual([
      { label: "Ivy Tech Community College-IN", value: "003825" },
      { label: "Ball State Univ Muncie-IN", value: "001051" },
    ]);
  });
  it("handles empty course lists (case-sensitivity silent-empty)", () => {
    expect(parseAjaxList("c\n")).toEqual([]);
  });
});

describe("parseCourseFromText", () => {
  it.each([
    ["CSCI 240", "CSCI", "240"],
    ["CS-240", "CS", "240"],
    ["CSCI240", "CSCI", "240"],
    ["ENGL 111H", "ENGL", "111H"],
    ["MATH 063", "MATH", "063"],
  ])("extracts %s", (raw, subject, number) => {
    const refs = parseCourseFromText(raw);
    expect(refs[0]).toMatchObject({ subject, number });
  });

  it("preserves opaque course numbers (no parseInt)", () => {
    expect(parseCourseFromText("COMM 101AH")[0]).toMatchObject({ subject: "COMM", number: "101AH" });
  });

  it("extracts a title after a dash", () => {
    const [ref] = parseCourseFromText("CSCI 240 — Data Structures");
    expect(ref).toMatchObject({ subject: "CSCI", number: "240", title: "Data Structures" });
  });

  it("extracts multiple courses from a schedule blob, deduped", () => {
    const refs = parseCourseFromText(
      "MATH 211 Calculus I\nCSCI 201 Computer Science II\nENGL 111 English Comp\nMATH 211",
    );
    expect(refs.map((r) => `${r.subject} ${r.number}`)).toEqual([
      "MATH 211",
      "CSCI 201",
      "ENGL 111",
    ]);
  });

  it("returns [] on garbage", () => {
    expect(parseCourseFromText("hello world, nothing here")).toEqual([]);
  });

  // Bug #9: 4-digit numbering (OSU/UCF/Cornell/Texas) and long subjects
  it.each([
    ["PSYCH 1100", "PSYCH", "1100"],
    ["COP 3502", "COP", "3502"],
    ["CS 1110", "CS", "1110"],
    ["ENGL 1301", "ENGL", "1301"],
    ["MATH 2413", "MATH", "2413"],
    ["COMPSCI 61A", "COMPSCI", "61A"],
    ["BIOSC 0150", "BIOSC", "0150"],
  ])("parses 4-digit / long-subject form %s", (raw, subject, number) => {
    expect(parseCourseFromText(raw)[0]).toMatchObject({ subject, number });
  });

  // Bug #9 guard: prose numbers must NOT become courses (chip false positives)
  it.each([
    "Meeting at 10:30",
    "Fall 2024 Schedule",
    "Spring 2025 registration",
    "Room 204 Building 3",
    "Chapter 12, page 340",
    "Est. 1869 — GPA 3.8",
    "Dec 2026 term, week 15",
    "Total credits 120",
  ])("rejects prose: %s", (raw) => {
    expect(parseCourseFromText(raw)).toEqual([]);
  });

  it("still finds real courses embedded in noisy prose", () => {
    const refs = parseCourseFromText("Fall 2024: take PSYCH 1100 in Room 204");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ subject: "PSYCH", number: "1100" });
  });

  it("glued form has lower confidence than separated form", () => {
    const [glued] = parseCourseFromText("CSCI240");
    const [spaced] = parseCourseFromText("CSCI 240");
    expect(glued!.confidence).toBeLessThan(spaced!.confidence);
  });
});
