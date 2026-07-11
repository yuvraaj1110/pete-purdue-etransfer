# CLAUDE.md — Purdue Transfer-Check Browser Extension

This is the complete project context. Read it fully before writing code. This file is intentionally scoped to ONLY this project.

## 1. What we are building

A Chrome (Manifest V3) browser extension called **PurdueTransferCheck**.

User story: A prospective/transfer student is browsing another college's course catalog (e.g., a community college site). They highlight a course (like `CSCI 240 - Data Structures`), trigger the extension, and instantly see whether that course transfers to Purdue University (West Lafayette) — and if so, as which Purdue course and what kind of credit (direct course credit, elective/undistributed credit, or no equivalency). Today this requires manually leaving the page and searching Purdue's transfer directory.

Core value: eliminate the manual "open Purdue's directory → select school → type course → read result" loop. Make it highlight-and-know.

## 2. Who uses it

Prospective Purdue transfer students, current students taking summer courses elsewhere for credit, community-college students in Indiana planning a transfer, and international students evaluating credit. Purdue admits thousands of transfer students, so the audience is real and reachable (e.g., r/Purdue, Purdue transfer/advising communities).

## 3. The data source (the backend we do NOT own)

Purdue publishes a public Transfer Credit Course Equivalency Guide (Banner self-service):

* Entry page: `https://selfservice.mypurdue.purdue.edu/prod/bzwtxcrd.p_select_info`
* It lets you choose a source institution, enter a course subject/prefix + number, and returns whether Purdue grants direct course credit, elective/undistributed credit, or no match.

IMPORTANT — do NOT assume the exact request format. The precise HTTP method, form field names, session/cookie requirements, and result HTML structure must be discovered by inspecting the live page (DevTools → Network tab while performing a real lookup). Your first coding task is a spike to capture:

1. The exact request (URL, method, form params) that a lookup issues.
2. How the source institution is identified (an ID? an exact name string?).
3. The structure of the returned HTML result so we can parse credit type + Purdue course number. Document findings in `docs/purdue-endpoint.md` before building the query layer.

Note: Transferology (CollegeSource) also has equivalency data, but its APIs are institution-only (Banner/PeopleSoft extractors gated by school-issued API keys) and are NOT available to us. We rely solely on Purdue's public page.

## 4. Non-goals / scope discipline

* Only Purdue West Lafayette as the destination. Do not try to support every university.
* Do not build user accounts, payments, or a backend server for the MVP. Everything runs in the extension; optionally add a tiny caching proxy later only if CORS forces it.
* Do not scrape at scale or store Purdue data in bulk beyond a lightweight cache.

## 5. Architecture (Manifest V3)

```
[content script] detects highlighted text on the active tab
      → sends selection to [background service worker]
[popup / injected UI] lets user confirm source school + course code
[background service worker] issues the equivalency query (fetch), parses HTML
      → returns a normalized result
[result UI] shows: credit type, Purdue course, caveats, link to full result
[cache] (chrome.storage.local) stores recent lookups
```

Components:

* `content-script.js` — reads `window.getSelection()`, attempts to parse a course subject+number from the highlighted text, injects a small result badge/card.
* `background.js` (service worker) — performs the cross-origin `fetch` to Purdue, parses the response, normalizes to a result object, handles caching + throttling.
* `popup.html/js` — fallback UI: source-school dropdown/search + editable subject/number fields (pre-filled from the highlight) + a "Check" button.
* `school-map.js` — a domain→(Purdue source-institution identifier) lookup for auto-detecting the source school; fall back to manual selection.
* `parser.js` — pure functions: (a) extract `{subject, number, title}` from messy highlighted text; (b) parse Purdue's result HTML into `{creditType, purdueCourse, notes}`. Keep these pure and unit-tested.

Result object shape (target):

```js
{
  source: { school, subject, number, title },
  result: "DIRECT" | "ELECTIVE" | "NONE" | "UNKNOWN",
  purdueCourse: "CS 18000" | null,
  credits: number | null,
  caveats: string[],   // e.g. "C- or higher required", ">10 years may not count"
  fetchedAt: ISOstring
}
```

## 6. Tech stack

* Vanilla TypeScript + Manifest V3 (no heavy framework needed; a light popup UI is fine — plain TS or Preact if you want components).
* Build with Vite (+ `@crxjs/vite-plugin`) or esbuild.
* Vitest for unit tests on `parser.js` and `school-map.js`.
* Lint/format: ESLint + Prettier.
* No external runtime dependencies for the core if avoidable.

## 7. Milestones (build in this order)

**v0 — spike + manual flow (first)**

1. Inspect Purdue's page, document the request/response in `docs/purdue-endpoint.md`.
2. Popup with: source-school dropdown, subject field, number field, "Check" button.
3. Background worker performs the lookup and displays the raw parsed result.
4. Unit tests for the result-HTML parser using a saved fixture of Purdue's HTML.

**v1 — the real UX (shippable)**

5. Content script: detect highlight, pre-fill subject/number, show an inline result card.
6. Auto-detect source school from the active tab's domain (`school-map.js`), with manual override.
7. Cache results in `chrome.storage.local` (keyed by school+subject+number), with TTL + throttling.
8. Clear result states (direct / elective / none / unknown) + caveats + "unofficial" disclaimer.
9. Package + Chrome Web Store listing (icons, screenshots, privacy note).

**v2 — nice-to-haves (later)**

10. Batch mode: highlight a list/schedule → check all.
11. Map results to a Purdue plan-of-study ("counts toward CS core?").
12. Save/export a transfer plan.

## 8. The hard parts (spend care here)

1. **Course extraction from messy text.** Highlighted text varies: `CSCI 240`, `CS-240`, `Computer Science 240 — Data Structures`. Write `parseCourse()` defensively; always allow manual correction in the UI. Unit-test with many real examples.
2. **Source-school mapping.** Purdue's DB keys on a specific institution identifier/name. Build `school-map.js` for common domains; fall back to a searchable dropdown populated from Purdue's list of institutions (scrape/store that list once).
3. **Querying + parsing Purdue's Banner response.** Replicate the exact request discovered in the spike. Parse defensively; if the layout is unrecognized, return `UNKNOWN` and link the user to the full page rather than guessing.
4. **Trustworthy result interpretation.** Surface Purdue's real caveats: only regionally-accredited institutions, grades of C− or higher, courses older than 10 years may not count, and department discretion. Always label results "Unofficial — confirm with your advisor / Purdue Registrar."

## 9. Legal / ethical constraints (must follow)

* We are reading a public university page. Be a good citizen: cache aggressively, throttle requests, never bulk-scrape, and add a visible "Unofficial" disclaimer.
* If cross-origin `fetch` from the extension is blocked, prefer requesting the minimum host permission for `selfservice.mypurdue.purdue.edu` rather than routing through a server. Only add a tiny proxy if unavoidable, and document why.
* Handle page-structure changes gracefully: a parser test should fail loudly (not silently return wrong data) when Purdue changes their HTML.
* No collection of personal data. If any analytics, make them privacy-respecting and disclosed.

## 10. Coding conventions

* Keep `parser.js` / `school-map.js` pure and fully unit-tested — this is where correctness lives.
* Network + DOM side-effects isolated to `background.js` and `content-script.js`.
* Small, typed functions; clear names; comments only where the why isn't obvious.
* Commit in small logical units with clear messages. Maintain a short `docs/hardest-bugs.md` log (great for the eventual portfolio write-up).

## 11. How to start (agent instructions)

1. Scaffold a Manifest V3 + TypeScript + Vite extension. Confirm it loads unpacked in Chrome with a hello-world popup.
2. Do the spike: manually perform a lookup on Purdue's equivalency page with DevTools open; capture and document the exact request/response in `docs/purdue-endpoint.md`. Save a sample result HTML as a test fixture.
3. Implement `parser.js` against that fixture with Vitest before wiring any network code.
4. Build the v0 popup flow end-to-end (manual entry → real result).
5. Then layer in the content script, school auto-detection, and caching for v1.
6. Before publishing, verify the "Unofficial — confirm with Purdue" disclaimer is visible in every result state.

## 12. Definition of done (v1)

* Highlight a course on a college site → within a couple seconds see a clear, correct result card (direct/elective/none) with the Purdue course and caveats.
* Works for at least 5 common Indiana/community-college sites via auto-detected school mapping.
* Parser has unit tests; a broken-layout case returns `UNKNOWN` gracefully.
* Packaged and installable; Chrome Web Store listing drafted with screenshots and privacy note.
