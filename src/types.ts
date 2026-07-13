export type Verdict = "DIRECT" | "ELECTIVE" | "PARTIAL" | "NONE" | "UNKNOWN";

export interface CourseRef {
  subject: string; // uppercased, e.g. "CSCI"
  number: string; // opaque string, e.g. "111H", "063"
  title?: string;
  confidence: number; // 0..1
  rawText: string;
}

export interface Equivalency {
  subject: string;
  number: string; // "11510" | "1XTRA"
  title: string;
  credits: number | null;
  kind: "DIRECT" | "ELECTIVE" | "UNKNOWN";
}

export interface TransferResult {
  source: {
    school: string;
    schoolCode: string;
    subject: string;
    number: string;
    title?: string;
  };
  verdict: Verdict;
  equivalencies: Equivalency[];
  totalCredits: number | null;
  caveats: string[];
  sourceKind: "LIVE" | "CACHE" | "SNAPSHOT";
  fetchedAt: string;
}

export interface TransferReport {
  school: string;
  schoolCode: string;
  items: TransferResult[];
  summary: {
    direct: number;
    elective: number;
    partial: number;
    none: number;
    unknown: number;
    totalCredits: number;
  };
  generatedAt: string;
}

export interface LookupRequest {
  location: string; // "US" | "Outside US"
  state: string; // "IN"
  schoolCode: string; // "003825"
  courses: { subject: string; number: string }[];
}

/** Parse failure taxonomy — UNKNOWN must never guess. */
export type ParseOutcome =
  | { ok: true; results: ParsedRow[] }
  | { ok: false; reason: "NO_RESULTS_SECTION" | "HEADER_MISMATCH" };

export interface ParsedRow {
  transfer: {
    school: string;
    subject: string;
    number: string;
    title: string;
    credits: number | null;
  };
  equivalencies: Equivalency[];
  caveats: string[];
}
