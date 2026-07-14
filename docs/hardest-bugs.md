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

7. **ORDS-13002: the POST that only fails inside the extension.** All curl testing passed;
   the shipped extension got `403 Forbidden — "failed cross origin request validation"` on the
   report POST. Chrome silently attaches `Origin: chrome-extension://…` to cross-origin POSTs
   and Oracle ORDS rejects foreign origins. curl never sends Origin, so the spike couldn't see
   it. Fix: switched the report call to GET (identical params, byte-identical response, no
   Origin header). Lesson: an HTTP client is not a browser — the *headers your runtime adds*
   are part of the request contract.

8. **Closed shadow roots are write-only.** `element.shadowRoot` is `null` for
   `attachShadow({mode:"closed"})`, so re-reading it on the second render returned null and the
   highlight chip's click handler crashed before drawing anything. Fix: keep the ShadowRoot in
   a module variable. Symptom looked like "button ignores clicks" — it was actually a TypeError
   on the re-render path.

9. **[OPEN — must fix before store submission] 4-digit course numbers don't parse.**
   `parseCourse()` caps numbers at `\d{2,3}`, so `PSYCH 1100` (Ohio State), `COP 3502` (UCF),
   `CS 1110` (Cornell), `ENGL 1301` (every Texas school) all return NO MATCH — verified against
   the live regex 2026-07-13. Ohio State, UCF, ASU, Cornell, TAMU, and most Florida/Texas
   schools use 4-digit numbering, so v0.2.3's 130-school auto-detect made this reachable by
   roughly half the target audience: we detect their school, then fail to read every course on
   their catalog. User path: install → highlight `COP 3502` → "Couldn't find a course" →
   uninstall. A feature shipped yesterday turned a dormant parser limit into the #1 launch risk.

   Fix plan (interacting pieces — do together, not piecemeal):
   - widen number to `\d{2,4}` and subject to `[A-Z]{2,8}` (`COMPSCI 61A` also fails today);
   - add a term/noise-word guard (FALL, SPRING, SUMMER, ROOM, BLDG, YEAR…) — widening alone
     makes "Fall 2024" parse as a course, worsening the existing chip false-positive problem
     ("Meeting at 10:30" → "AT 10", "Room 204" → "ROOM 204", both verified);
   - gate the content-script chip on an actual parseCourse() hit instead of "any 5+ chars with
     a digit", so the chip stops appearing on Gmail/Docs selections.
