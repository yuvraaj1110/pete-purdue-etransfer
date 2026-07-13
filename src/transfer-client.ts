import type { LookupRequest } from "./types";

/**
 * The only module that talks to Purdue. Deterministic given an injected fetch.
 *
 * Invariants (docs/purdue-endpoint.md §6):
 *  - NEVER send a 1-row POST (Oracle scalar-vs-array binding silently returns
 *    "no match"). Always pad to >= FORM_ROWS.
 *  - Uppercase subject/course (lowercase silently returns empty).
 *  - Chunk batches at MAX_BATCH.
 *  - Retry once on 5xx / network failure with jittered backoff.
 */

export const BASE = "https://selfservice.mypurdue.purdue.edu/prod/";
export const FORM_ROWS = 5; // mirror the real form
export const MAX_BATCH = 10; // verified working; chunk above this

const EMPTY_PURDUE_SIDE =
  "purdue_subject_in=&purdue_course_in=&purdue_location_in=&purdue_state_in=&purdue_school_in=";

export function buildReportBody(req: LookupRequest): string {
  if (req.courses.length === 0) throw new Error("no courses");
  if (req.courses.length > MAX_BATCH) throw new Error(`max ${MAX_BATCH} courses per request`);

  const rowCount = Math.max(FORM_ROWS, req.courses.length);
  const parts: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const c = req.courses[i];
    if (c) {
      parts.push(
        [
          `location_in=${encodeURIComponent(req.location)}`,
          `state_in=${encodeURIComponent(req.state)}`,
          `school_in=${encodeURIComponent(req.schoolCode)}`,
          `subject_in=${encodeURIComponent(c.subject.toUpperCase().trim())}`,
          `course_in=${encodeURIComponent(c.number.toUpperCase().trim())}`,
        ].join("&"),
      );
    } else {
      parts.push("location_in=&state_in=&school_in=&subject_in=&course_in=");
    }
    parts.push(EMPTY_PURDUE_SIDE);
  }
  return parts.join("&");
}

export function chunkCourses<T>(courses: T[], size = MAX_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < courses.length; i += size) out.push(courses.slice(i, i + size));
  return out;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function fetchWithRetry(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit | undefined,
  sleep: (ms: number) => Promise<void>,
): Promise<Response> {
  const attempt = () => fetchFn(url, init);
  try {
    const res = await attempt();
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch {
    await sleep(500 + Math.random() * 500); // single retry, jittered
    const res = await attempt();
    if (!res.ok) throw new Error(`HTTP ${res.status} after retry`);
    return res;
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchReportHtml(
  req: LookupRequest,
  fetchFn: FetchLike = fetch,
  sleep = defaultSleep,
): Promise<string> {
  const res = await fetchWithRetry(
    fetchFn,
    `${BASE}bzwtxcrd.p_display_report`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: buildReportBody(req),
    },
    sleep,
  );
  return res.text();
}

export type AjaxRequestType = "states" | "school" | "subject" | "course";

export function buildAjaxUrl(
  type: AjaxRequestType,
  values: [string, string?, string?, string?],
): string {
  const [v1, v2, v3, v4] = values;
  const q = new URLSearchParams({
    request_type: type,
    request_value: v1,
    request_value2: v2 ?? "null",
    request_value3: v3 ?? "null",
    request_value4: v4 ?? "null",
    load_into: "x", // echoed back; value irrelevant
  });
  return `${BASE}bzwtxcrd.p_ajax?${q.toString()}`;
}

export async function fetchAjaxList(
  type: AjaxRequestType,
  values: [string, string?, string?, string?],
  fetchFn: FetchLike = fetch,
  sleep = defaultSleep,
): Promise<string> {
  const res = await fetchWithRetry(fetchFn, buildAjaxUrl(type, values), undefined, sleep);
  return res.text();
}

/** Token bucket: 1 req/s sustained, burst of 3. Shared by all outbound calls. */
export class Throttle {
  private tokens: number;
  private lastRefill: number;
  constructor(
    private readonly ratePerSec = 1,
    private readonly burst = 3,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {
    this.tokens = burst;
    this.lastRefill = now();
  }

  async take(): Promise<void> {
    for (;;) {
      const t = this.now();
      this.tokens = Math.min(this.burst, this.tokens + ((t - this.lastRefill) / 1000) * this.ratePerSec);
      this.lastRefill = t;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await this.sleep(((1 - this.tokens) / this.ratePerSec) * 1000);
    }
  }
}
