import { describe, expect, it } from "vitest";
import { SCHOOL_INDEX, searchSchoolIndex } from "../src/school-index";

describe("SCHOOL_INDEX (bundled global list)", () => {
  it("covers well beyond Indiana — the whole articulation universe", () => {
    expect(SCHOOL_INDEX.length).toBeGreaterThan(1000);
    const states = new Set(SCHOOL_INDEX.map((e) => e.s));
    expect(states.size).toBeGreaterThan(40);
    expect(SCHOOL_INDEX.some((e) => e.l === "Outside US")).toBe(true);
  });

  it("contains the known anchors", () => {
    const ivy = SCHOOL_INDEX.find((e) => e.c === "003825");
    expect(ivy).toMatchObject({ s: "IN", l: "US" });
  });
});

describe("searchSchoolIndex", () => {
  it("finds Univ of North Dakota regardless of selected state (the UND bug)", () => {
    const hits = searchSchoolIndex("north dakota");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((e) => e.s === "ND" && /North Dakota/i.test(e.n))).toBe(true);
  });

  it("all tokens must match", () => {
    const hits = searchSchoolIndex("ivy tech");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((e) => /ivy/i.test(e.n) && /tech/i.test(e.n))).toBe(true);
  });

  it("empty query returns nothing (caller falls back to state list)", () => {
    expect(searchSchoolIndex("   ")).toEqual([]);
  });

  it("caps results", () => {
    expect(searchSchoolIndex("univ", 50).length).toBeLessThanOrEqual(50);
  });
});
