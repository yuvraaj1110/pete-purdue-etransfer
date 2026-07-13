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
 * Rank-aware global search: every query token must match a word of the school
 * name. Matching is prefix-tolerant BOTH ways because Purdue's directory
 * abbreviates aggressively ("Univ Of North Dakota", "Coll of DuPage"):
 *   query "university" matches name word "univ"; query "tech" matches
 *   "technology". Short words (<4 chars) must match exactly ("of", "st").
 */
function tokenMatchesWord(t: string, w: string): boolean {
  if (w.startsWith(t)) return true; // "tech" -> "technology"
  return t.length >= 4 && w.length >= 4 && t.startsWith(w); // "university" -> "univ"
}

export function searchSchoolIndex(query: string, limit = 50): IndexedSchool[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored: { e: IndexedSchool; score: number }[] = [];
  for (const e of SCHOOL_INDEX) {
    const words = e.n.toLowerCase().split(/[\s\-/]+/).filter(Boolean);
    let score = 0;
    let ok = true;
    for (const t of tokens) {
      const wi = words.findIndex((w) => tokenMatchesWord(t, w));
      if (wi === -1) {
        ok = false;
        break;
      }
      score += (words[wi] === t ? 2 : 1) + (wi === 0 ? 1 : 0); // exact + leading-word bonus
    }
    if (ok) scored.push({ e, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.e.n.localeCompare(b.e.n))
    .slice(0, limit)
    .map((s) => s.e);
}
