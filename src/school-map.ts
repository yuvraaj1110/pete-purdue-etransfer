/**
 * Domain -> Purdue source-institution code (verified via p_ajax school list).
 * Pure. Fallback is the popup's searchable picker fed by the live list.
 */

export interface SchoolEntry {
  code: string; // Purdue's 6-char code, e.g. "003825"
  name: string; // display name as Purdue lists it
  location: string; // "US"
  state: string; // "IN"
}

const DOMAIN_MAP: Record<string, SchoolEntry> = {
  "ivytech.edu": { code: "003825", name: "Ivy Tech Community College-IN", location: "US", state: "IN" },
  "iu.edu": { code: "001324", name: "Indiana University Bloomington", location: "US", state: "IN" },
  "indstate.edu": { code: "001322", name: "Indiana State Univ Terre Haute", location: "US", state: "IN" },
  "bsu.edu": { code: "001051", name: "Ball State Univ Muncie-IN", location: "US", state: "IN" },
  "butler.edu": { code: "001073", name: "Butler Univ Indianapolis-IN", location: "US", state: "IN" },
  "usi.edu": { code: "001335", name: "Univ of Southern Indiana", location: "US", state: "IN" },
  "uindy.edu": { code: "001321", name: "Univ of Indianapolis-IN", location: "US", state: "IN" },
  "nd.edu": { code: "001841", name: "Univ of Notre Dame-IN", location: "US", state: "IN" },
};

/** Match a hostname (or any subdomain of it) to a known school. */
export function domainToSchool(hostname: string): SchoolEntry | null {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  const parts = h.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join(".");
    const hit = DOMAIN_MAP[candidate];
    if (hit) return hit;
  }
  return null;
}

/** Case/spacing-tolerant search over a school list (from p_ajax). */
export function searchSchools(
  list: { label: string; value: string }[],
  query: string,
): { label: string; value: string }[] {
  const q = query.toLowerCase().trim();
  if (!q) return list;
  return list.filter((s) => s.label.toLowerCase().includes(q));
}
