# PurdueTransferCheck — Portfolio / Resume / Interview Material

> Honesty note: as of writing, the reverse-engineering + design is done; the extension is not built.
> Lines marked **[BUILT]** should only be used once the extension actually ships. Everything else is true today.

## One-liner (LinkedIn headline / project title)
Chrome extension that turns Purdue's clunky transfer-credit lookup into a one-click "does my course transfer?" tool — by reverse-engineering the university's undocumented Banner endpoint.

## Tech stack
- **Manifest V3 Chrome extension** — service worker, content script, popup, `chrome.storage.local`, offscreen document (for HTML parsing, since MV3 workers lack `DOMParser`).
- **TypeScript**, built with **esbuild** (no framework — deliberate; the UI is small and framework-free = zero build fragility).
- **Vitest** for unit tests on pure parser/mapping functions, driven by saved HTML fixtures.
- **Reverse-engineered data layer**: Purdue's public Ellucian Banner / Oracle mod_plsql endpoint (`bzwtxcrd.p_display_report` + `p_ajax` cascade), consumed directly via `fetch` — no backend, no proxy, no API keys, $0 infra.
- ESLint + Prettier.

## LinkedIn "About / Projects" version (paragraph)
Built a Chrome extension that lets prospective Purdue transfer students highlight a course on any college's catalog and instantly see whether it transfers, as which Purdue course, and what kind of credit. The hard part wasn't the UI — it was that Purdue has no API. I reverse-engineered their 20-year-old Banner self-service system with browser DevTools, documented the exact request/response format, and discovered its Oracle form-array binding lets you look up **10 courses in a single request** — effectively a batch transfer API the university never built. Stack: TypeScript, Manifest V3, esbuild, Vitest, all client-side with zero backend cost.

## Resume bullets (pick 2–3)
- Reverse-engineered an undocumented university Banner/Oracle endpoint using browser DevTools; documented request format, cascade AJAX, and result HTML across direct/elective/no-match cases as versioned test fixtures.
- Designed a Manifest V3 Chrome extension (TypeScript, esbuild, Vitest) that resolves transfer-credit equivalencies client-side with **no backend, no API keys, and $0 infrastructure**.
- Discovered the endpoint's mod_plsql array binding enabled **batch lookups (10 courses / 1 request)**, turning a one-course tool into a full "semester transfer report card" at no extra server cost.
- **[BUILT]** Shipped to the Chrome Web Store; parses defensively with loud-fail `UNKNOWN` states and a caching layer to stay a good citizen against a public university endpoint.

## Interview talking points (the story, not the bullets)
- **Why it's real work, not a tutorial project:** no API existed. The whole project hinged on a reverse-engineering spike before any code — I treated "figure out the request" as task zero.
- **Best war story — the 1-row bug:** a single-course POST *silently returns "no credit"* for a course that genuinely transfers, because Oracle mod_plsql expects the form field as a 5-element array, not a scalar. Sending ≥2 rows fixes it. This is the kind of bug that ships to prod and generates furious "the tool is broken" tickets — I found it by stress-testing before building, not after.
- **Design judgment:** chose no framework and no backend on purpose. Every added dependency is a future break against an endpoint I don't control. Functionality first, "cool" second.
- **Correctness discipline:** transfer advice that's *confidently wrong* is worse than "I don't know." Parser asserts expected table headers and returns UNKNOWN + a link to the real page rather than guessing.
- **Edge cases found by probing:** one course → multiple Purdue courses (with mixed direct+elective verdicts); course "numbers" like `111H`/`063`; case-sensitive silent-empty responses; batch results returned alphabetized, not in request order.

## What to say about status (don't oversell)
"The data layer is fully reverse-engineered and documented, the design is locked, and I'm building the extension now." — true, specific, and stronger than a vague "I made an app."
