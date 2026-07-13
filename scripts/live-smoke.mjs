/**
 * Live end-to-end smoke test (run manually, NOT in CI):
 *   node scripts/live-smoke.mjs
 * Exercises the real transfer-client request shape + real parser against
 * Purdue's live endpoint using jsdom as the DOMParser host.
 * Known-good expectations come from docs/purdue-endpoint.md.
 */
import { JSDOM } from "jsdom";

globalThis.DOMParser = new JSDOM().window.DOMParser;

const { buildReportBody } = await import("../dist-smoke/transfer-client.js");
const { parseReportHtml, deriveVerdict } = await import("../dist-smoke/parser.js");

const req = {
  location: "US",
  state: "IN",
  schoolCode: "003825",
  courses: [
    { subject: "MATH", number: "211" }, // expect DIRECT -> MA 16500
    { subject: "CHEM", number: "105" }, // expect PARTIAL -> 3 equivalencies
    { subject: "CSCI", number: "201" }, // expect ELECTIVE -> CS 2XUND
  ],
};

const res = await fetch("https://selfservice.mypurdue.purdue.edu/prod/bzwtxcrd.p_display_report", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: buildReportBody(req),
});
console.log("HTTP", res.status);
const html = await res.text();
const out = parseReportHtml(html);
if (!out.ok) {
  console.error("PARSE FAILED:", out.reason);
  process.exit(1);
}

const expected = {
  "MATH 211": "DIRECT",
  "CHEM 105": "PARTIAL",
  "CSCI 201": "ELECTIVE",
};
let fail = 0;
for (const r of out.results) {
  const key = `${r.transfer.subject} ${r.transfer.number}`;
  const verdict = deriveVerdict(r.equivalencies);
  const want = expected[key];
  const okMark = want === verdict ? "OK " : (fail++, "FAIL");
  console.log(
    `${okMark} ${key} -> ${verdict} [${r.equivalencies.map((e) => `${e.subject} ${e.number}`).join(", ")}]`,
  );
}
process.exit(fail ? 1 : 0);
