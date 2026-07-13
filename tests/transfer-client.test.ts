import { describe, expect, it, vi } from "vitest";
import {
  buildAjaxUrl,
  buildReportBody,
  chunkCourses,
  fetchReportHtml,
  Throttle,
} from "../src/transfer-client";
import type { LookupRequest } from "../src/types";

const req = (courses: LookupRequest["courses"]): LookupRequest => ({
  location: "US",
  state: "IN",
  schoolCode: "003825",
  courses,
});

const countParam = (body: string, name: string) =>
  body.split("&").filter((p) => p.startsWith(`${name}=`)).length;

describe("buildReportBody", () => {
  it("NEVER produces fewer than 5 rows — the 1-row silent-failure invariant", () => {
    const body = buildReportBody(req([{ subject: "MATH", number: "211" }]));
    for (const p of ["location_in", "state_in", "school_in", "subject_in", "course_in",
      "purdue_subject_in", "purdue_course_in", "purdue_location_in", "purdue_state_in", "purdue_school_in"]) {
      expect(countParam(body, p)).toBe(5);
    }
  });

  it("uppercases + trims subject and course (case-sensitivity invariant)", () => {
    const body = buildReportBody(req([{ subject: " csci ", number: "201h " }]));
    expect(body).toContain("subject_in=CSCI");
    expect(body).toContain("course_in=201H");
  });

  it("expands beyond 5 rows for batches", () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ subject: "MATH", number: `${100 + i}` }));
    const body = buildReportBody(req(eight));
    expect(countParam(body, "location_in")).toBe(8);
    expect(countParam(body, "purdue_school_in")).toBe(8);
  });

  it("rejects empty and >10-course requests", () => {
    expect(() => buildReportBody(req([]))).toThrow();
    const eleven = Array.from({ length: 11 }, () => ({ subject: "A", number: "1" }));
    expect(() => buildReportBody(req(eleven))).toThrow(/max 10/);
  });

  it("matches the byte-for-byte shape verified live in the spike", () => {
    const body = buildReportBody(req([{ subject: "CSCI", number: "201" }]));
    expect(body.startsWith(
      "location_in=US&state_in=IN&school_in=003825&subject_in=CSCI&course_in=201" +
      "&purdue_subject_in=&purdue_course_in=&purdue_location_in=&purdue_state_in=&purdue_school_in=" +
      "&location_in=&state_in=&school_in=&subject_in=&course_in=",
    )).toBe(true);
  });
});

describe("chunkCourses", () => {
  it("splits 23 courses into 10/10/3", () => {
    const chunks = chunkCourses(Array.from({ length: 23 }, (_, i) => i));
    expect(chunks.map((c) => c.length)).toEqual([10, 10, 3]);
  });
});

describe("buildAjaxUrl", () => {
  it("fills unused values with literal 'null' as the page's ajaxLoad does", () => {
    const url = buildAjaxUrl("course", ["CSCI", "003825"]);
    expect(url).toContain("request_type=course");
    expect(url).toContain("request_value=CSCI");
    expect(url).toContain("request_value2=003825");
    expect(url).toContain("request_value3=null");
    expect(url).toContain("request_value4=null");
  });

  it("encodes spaces (Outside US)", () => {
    expect(buildAjaxUrl("states", ["Outside US"])).toContain("request_value=Outside+US");
  });
});

describe("fetchReportHtml", () => {
  const ok = (body: string) => new Response(body, { status: 200 });

  it("uses GET with query params — extension POSTs get 403 ORDS-13002 (cross-origin validation)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok("<html>fine</html>"));
    await fetchReportHtml(req([{ subject: "MATH", number: "211" }]), fetchFn, async () => {});
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toContain("bzwtxcrd.p_display_report?location_in=US");
    expect(url).toContain("subject_in=MATH");
    expect(init).toBeUndefined(); // plain GET: no method, no body, no Origin header sent
  });

  it("retries once on 5xx and succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 502 }))
      .mockResolvedValueOnce(ok("<html>fine</html>"));
    const html = await fetchReportHtml(req([{ subject: "MATH", number: "211" }]), fetchFn, async () => {});
    expect(html).toBe("<html>fine</html>");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("fails loudly on 403 — error bodies must never reach the parser", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("{\"code\":\"Forbidden\"}", { status: 403 }));
    await expect(
      fetchReportHtml(req([{ subject: "MATH", number: "211" }]), fetchFn, async () => {}),
    ).rejects.toThrow(/HTTP 403/);
  });

  it("throws after the second failure (single retry only)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(
      fetchReportHtml(req([{ subject: "MATH", number: "211" }]), fetchFn, async () => {}),
    ).rejects.toThrow(/after retry/);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("Throttle", () => {
  it("allows a burst of 3 then forces waiting", async () => {
    let clock = 0;
    const waits: number[] = [];
    const t = new Throttle(1, 3, () => clock, async (ms) => {
      waits.push(ms);
      clock += ms;
    });
    await t.take();
    await t.take();
    await t.take(); // burst exhausted
    await t.take(); // must wait ~1s
    expect(waits.length).toBeGreaterThan(0);
    expect(waits[0]).toBeGreaterThan(900);
  });
});
