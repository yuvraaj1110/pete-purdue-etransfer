import rawIndex from "./school-index.json";

/**
 * Bundled global institution index (every school Purdue articulates from,
 * all states + countries), scraped once by scripts/build-school-index.mjs.
 * Keys are compact to keep the bundle small: n=name, c=code, s=state, l=location.
 */

export interface IndexedSchool {
  n: string; // display name
  c: string; // Purdue school code
  s: string; // state/country code (e.g. "IN", "ND", "CN")
  l: string; // "US" | "Outside US"
}

export const SCHOOL_INDEX: IndexedSchool[] = rawIndex as IndexedSchool[];

/**
 * Rank-aware global search: all query tokens must appear in the school name
 * (or state code). "north dakota univ" finds Univ of North Dakota regardless
 * of the currently selected state.
 */
export function searchSchoolIndex(query: string, limit = 50): IndexedSchool[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored: { e: IndexedSchool; score: number }[] = [];
  for (const e of SCHOOL_INDEX) {
    const hay = e.n.toLowerCase();
    let score = 0;
    let ok = true;
    for (const t of tokens) {
      const i = hay.indexOf(t);
      if (i === -1) {
        ok = false;
        break;
      }
      score += i === 0 || hay[i - 1] === " " || hay[i - 1] === "-" ? 2 : 1; // word-start bonus
    }
    if (ok) scored.push({ e, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.e.n.localeCompare(b.e.n))
    .slice(0, limit)
    .map((s) => s.e);
}
