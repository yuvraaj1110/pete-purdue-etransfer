# PurdueTransferCheck — Engineering Project Context

> Feed this file to Claude (or any assistant) as project context. It is the authoritative technical spec.
> **Prime directive: functionality first, "cool" second.** Every feature below is gated on the core lookup
> being correct. Stretch features (tagged `[STRETCH]`) exist for architectural completeness and portfolio
> surface area — build them only after the core path is green and never at the cost of core reliability.

---

## 0. Elevator pitch

A Manifest V3 Chrome extension that resolves **college-course → Purdue West Lafayette transfer-credit
equivalencies** entirely client-side, by consuming Purdue's undocumented Ellucian Banner / Oracle mod_plsql
endpoint that we reverse-engineered. Highlight a course (or a whole schedule) on any catalog page → get a
graded transfer report in seconds. No backend, no API keys, no paid infrastructure.

---

## 1. System architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ACTIVE TAB (any college catalog)                                         │
│  ┌───────────────────────┐                                                │
│  │  content-script.ts    │  selection detection, course parsing,          │
│  │  + Shadow-DOM UI       │  inline result card injection (CSS-isolated)   │
│  └───────────┬───────────┘                                                │
└──────────────┼────────────────────────────────────────────────────────────┘
               │ chrome.runtime message (typed RPC envelope)
┌──────────────▼────────────────────────────────────────────────────────────┐
│  SERVICE WORKER (background.ts) — the orchestrator                         │
│   ├─ request queue + token-bucket throttle (1 req/s, burst 3)             │
│   ├─ TransferClient: builds mod_plsql array-bound POST, retry w/ backoff  │
│   ├─ CacheLayer: chrome.storage.local, keyed hash, 30-day TTL, LRU evict  │
│   ├─ SchoolRegistry: per-state school list via p_ajax, cached             │
│   └─ dispatch → OffscreenParser                                            │
└──────────────┬──────────────────────────────────┬─────────────────────────┘
               │ chrome.offscreen                  │ chrome.storage
┌──────────────▼───────────────┐      ┌────────────▼────────────┐
│ OFFSCREEN DOCUMENT           │      │ chrome.storage.local     │
│ parser.ts (DOMParser here —  │      │ - results cache          │
│ MV3 workers lack DOMParser)  │      │ - school registry cache  │
│ pure fns, fixture-tested     │      │ - user prefs / plan      │
└──────────────────────────────┘      └──────────────────────────┘

           POPUP (popup.ts)  ─── manual lookup, batch paste, settings, saved plans
```

### Component contracts
- **`parser.ts`** — pure, side-effect-free, exhaustively fixture-tested. Two responsibilities:
  `parseCourseFromText(raw) → CourseRef[]` and `parseReportHtml(html) → TransferResult`.
- **`school-map.ts`** — pure. `domainToSchool(hostname) → SchoolCode | null` + fuzzy fallback.
- **`transfer-client.ts`** — the only module that does network I/O. Deterministic given a mock fetch.
- **`cache.ts`** — thin typed wrapper over `chrome.storage.local` with TTL + namespacing.
- **`background.ts` / `content-script.ts` / `popup.ts`** — orchestration + DOM only, no parsing logic.

Rule: correctness lives in the pure modules; everything impure is a thin shell that's easy to mock.

---

## 2. Data layer (reverse-engineered — see `purdue-endpoint.md` for the full spike)

Base: `https://selfservice.mypurdue.purdue.edu/prod/`

- **Cascade / autocomplete:** `GET bzwtxcrd.p_ajax?request_type={states|school|subject|course}&request_value=…`
  Returns newline-delimited `Display~VALUE`. Used to populate school/subject/course pickers and as a cheap
  negative pre-check (course absent from list ⇒ definitively NONE).
- **Report / lookup:** `POST bzwtxcrd.p_display_report`, `application/x-www-form-urlencoded`.
  **Oracle mod_plsql array binding**: every field repeated exactly 5× (5 form rows). Fill N rows, pad the
  rest empty. Returns server-rendered HTML with a `table.reportTable` (9 columns).
- **No auth, no cookies, no CSRF.** Verified cold. Extension needs only host permission for the origin.

### Hard-won invariants (each is a real bug we found — do not regress)
1. **Never send a 1-row POST** — Oracle scalar-vs-array binding makes it silently return "no match". Always ≥2 rows; pad to 5, chunk batches at 10.
2. **Uppercase all inputs** — lowercase subjects return empty with HTTP 200 (silent).
3. **Course numbers are opaque strings** — `111H`, `101AH`, `063`. Never `parseInt`.
4. **One transfer course → 0..N Purdue courses**, with **mixed verdicts** (direct + elective together). Continuation rows have blank leading cells; group them.
5. **Batch results return alphabetized**, not in request order — match by (subject, course), never by index.
6. **Dropdown presence ≠ articulation** — a course can list yet return no table. Present-but-empty ⇒ NONE + "request evaluation" link.
7. **Lenient HTML parsing only** — titles contain raw unescaped `&`; markers like `†` (Transfer Indiana) sit inside cells.
8. Retry once on 5xx/BigIP flakiness with jittered backoff.

---

## 3. Domain model (types)

```ts
type Verdict = "DIRECT" | "ELECTIVE" | "NONE" | "PARTIAL" | "UNKNOWN";
// PARTIAL = at least one direct + at least one elective mapping for the same source course.

interface CourseRef {           // parsed from messy highlighted text
  subject: string;              // "CSCI"  (uppercased, normalized)
  number: string;               // "201"   (opaque string)
  title?: string;
  confidence: number;           // 0..1 from the extraction heuristic
  rawText: string;
}

interface Equivalency {         // one Purdue-side row
  subject: string;              // "CHM"
  number: string;               // "11510" | "1XTRA"
  title: string;
  credits: number | null;
  kind: "DIRECT" | "ELECTIVE" | "UNKNOWN";  // 5-digit ⇒ DIRECT; \dX[A-Z]{3} ⇒ ELECTIVE
}

interface TransferResult {
  source: { school: string; schoolCode: string; subject: string; number: string; title?: string };
  verdict: Verdict;
  equivalencies: Equivalency[]; // 0..N (multi-mapping supported)
  totalCredits: number | null;
  caveats: string[];            // "C- or higher", ">10 yrs removed", "Transfer Indiana (†)", …
  source_kind: "LIVE" | "CACHE" | "SNAPSHOT";
  fetchedAt: string;            // ISO
  raw?: string;                 // retained only in debug mode
}

interface TransferReport {      // batch = the core primitive; single lookup is a batch of one
  school: string;
  items: TransferResult[];
  summary: { direct: number; elective: number; none: number; unknown: number; totalCredits: number };
  generatedAt: string;
}
```

---

## 4. Feature set

### Core (v0 → v1, must be correct)
- **F1 Highlight-to-check** — select course text on any page → inline Shadow-DOM result card.
- **F2 Manual lookup** — popup with school picker + subject/number fields (cascade-autocompleted).
- **F3 Batch report card** — highlight/paste a schedule or degree plan → one POST → graded report
  (✅ direct / 🟡 elective / ❌ none) with total transferable credits. *This is the core primitive;
  single lookup is `batch([one])`.*
- **F4 School auto-detection** — `school-map.ts` maps the tab's domain → Purdue school code, manual override.
- **F5 Defensive parsing** — header assertion; unknown layout ⇒ `UNKNOWN` + link to the live page.
- **F6 Caching + throttling** — 30-day TTL cache, token-bucket rate limit, good-citizen by default.
- **F7 Trust surface** — every result carries caveats + an "Unofficial — confirm with Purdue" disclaimer.

### Stretch / breadth (build only after core is green)
- `[STRETCH]` **F8 Degree-plan mapping** — tag each equivalency against a Purdue plan-of-study
  ("counts toward CS core / elective / gen-ed"), sourced from the catalog. Read-only, cached.
- `[STRETCH]` **F9 Transfer plan builder** — save courses to a persisted plan; running credit totals;
  export as JSON / CSV / printable PDF ("My Purdue Transfer Report").
- `[STRETCH]` **F10 Shareable report** — generate a stable, self-contained HTML snapshot of a report card
  (no PII) for sharing with an advisor.
- `[STRETCH]` **F11 Offline snapshot fallback** — bundle a small static JSON of the top ~10 Indiana feeder
  schools' most-checked courses; serve when the live endpoint is unreachable, clearly flagged `SNAPSHOT`.
- `[STRETCH]` **F12 Fuzzy course extraction** — tolerant `parseCourse()` (e.g. `CS-240`,
  `Computer Science 240 — Data Structures`, `CSCI240`) with a confidence score and always-editable UI.
- `[STRETCH]` **F13 Command palette / keyboard shortcut** — `chrome.commands` hotkey to check the current
  selection without a mouse.
- `[STRETCH]` **F14 Context-menu integration** — right-click selected text → "Check Purdue transfer".
- `[STRETCH]` **F15 History & re-check** — recent lookups list; one-click re-run to catch equivalency changes.
- `[STRETCH]` **F16 Multi-institution compare** — same course, two source schools, side by side.
- `[STRETCH]` **F17 Theming & a11y** — light/dark, prefers-reduced-motion, full keyboard nav, ARIA-labeled
  result cards, WCAG-AA contrast.
- `[STRETCH]` **F18 i18n scaffold** — externalized strings (`chrome.i18n`) for future ES/international users.
- `[STRETCH]` **F19 Privacy-respecting telemetry** — opt-in, aggregate-only counters (lookups, cache hit
  rate, parser-UNKNOWN rate) to a self-hosted or console sink; disclosed, no course/PII payloads.
- `[STRETCH]` **F20 Parser drift alarm** — if `UNKNOWN` rate crosses a threshold, surface a "Purdue may have
  changed their page" banner and link to file an issue. Turns the fixture suite into a live canary.

---

## 5. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Platform | Chrome **Manifest V3** | Target env; service-worker model |
| Language | **TypeScript** (strict) | Type-safe domain model is the correctness backbone |
| Build | **esbuild** (single config script) | Fast, zero-magic, no CRXJS breakage risk |
| Parsing | **DOMParser** in a **`chrome.offscreen`** document | MV3 workers can't parse HTML |
| Storage | **`chrome.storage.local`** (typed `cache.ts`) | 10 MB, sync API, no deps |
| UI isolation | **Shadow DOM** for injected card | No CSS collisions with host page |
| Tests | **Vitest** + saved HTML fixtures | Pure-function tests, deterministic |
| Lint/format | **ESLint + Prettier** | Consistency |
| CI | **GitHub Actions** (typecheck + test + fixture-parse) | Green-before-merge; parser canary |
| Packaging | `web-ext` / zip → Chrome Web Store | Distribution |
| Runtime deps | **none** for core | Fewer things to break against an endpoint we don't own |

---

## 6. Testing & reliability strategy

- **Fixture-driven parser tests** — `direct`, `elective/undistributed`, `no-match`, `batch5` (multi-mapping),
  `batch10` fixtures already captured in `tests/fixtures/`. Every new result shape becomes a fixture.
- **Golden-file assertions** — parser output snapshotted; layout changes fail loudly.
- **Contract tests** — `transfer-client` against a recorded fetch mock (no live calls in CI).
- **Error taxonomy** → `NONE` (no articulation), `UNKNOWN` (unrecognized layout — never guess),
  `NETWORK` (retryable), `THROTTLED`, `SNAPSHOT` (served offline). UI renders each distinctly.
- **Good-citizen guarantees** — cache-first, ≤1 req/s, single retry, no bulk scraping, visible "Unofficial".

---

## 7. Non-goals (scope discipline)

- Only **Purdue West Lafayette** as destination. Not a universal transfer tool.
- **No backend, no accounts, no payments** for MVP. A tiny caching proxy is allowed *only* if CORS ever
  forces it (it doesn't today) and must be documented.
- **No bulk scraping** or wholesale mirroring of Purdue data.
- **No AI/LLM in the correctness path** — transfer advice must be deterministic and traceable to Purdue's
  own output; an LLM guessing equivalencies is a disqualifying failure mode.

---

## 8. Build order

1. Spike + endpoint doc + fixtures ✅ (`purdue-endpoint.md`, `tests/fixtures/`).
2. `parser.ts` against fixtures ✅ (31 tests; multi-row grouping, verdict derivation, loud-UNKNOWN).
3. `transfer-client.ts` ✅ (5-row array binding, uppercase guard, retry, throttle; mocked-fetch tests).
4. Popup manual flow end-to-end (F2) ✅ — plus batch textarea.
5. Cache + throttle (F6) ✅, school registry (F4) ✅ (live p_ajax list + domain map).
6. Content script + Shadow-DOM card (F1) ✅, batch (F3) ✅, context menu (F14) ✅.
7. Trust surface (F5, F7) ✅; packaged zip ✅; store listing drafted (`docs/store-listing.md`).
   **Verified live 2026-07-13:** MATH 211→DIRECT, CHEM 105→PARTIAL(3 rows), CSCI 201→ELECTIVE
   via `scripts/live-smoke.mjs`. Remaining before submission: real icons, screenshots,
   manual in-Chrome QA on 5 college sites.
8. Stretch features as time allows, each behind the green core.
