# Hardest bugs & traps (running log)

1. **The 1-row silent failure.** A single-course POST to `p_display_report` returns the
   "no results" page *for a course that genuinely transfers*. Cause: Oracle mod_plsql binds a
   single repeated form field as a scalar, not a TABLE type, so the procedure sees no rows.
   Fix: always pad to 5 rows (`FORM_ROWS`), enforced in `buildReportBody` + regression test.
   Found by stress-testing before writing the client — would have shipped as "nothing transfers."

2. **Batch results come back alphabetized.** Request order ≠ response order. Matching response
   rows to requested courses by index corrupts every batch. Fix: match by (subject, number).

3. **Continuation rows.** One transfer course → N Purdue courses; rows 2..N have `&nbsp;` in the
   first five cells. Naive per-row parsing invents phantom courses. Fix: group by non-empty
   Transfer School cell (`parseReportHtml`).

4. **Case-sensitive, silently.** `csci` → HTTP 200 + empty list. No error to catch anywhere.
   Fix: uppercase at the client boundary, tested.

5. **MV3 has no DOMParser in service workers.** Parsing lives in an offscreen document;
   `background.ts` only orchestrates. (CLAUDE.md originally suggested DOMParser in the worker —
   spike corrected it.)

6. **Cascade presence ≠ articulation.** ENGL 111H lists in the course dropdown but returns no
   report row. The "in the list so it transfers" shortcut is wrong; only absence is meaningful.
