# PurdueTransferCheck

Chrome (MV3) extension: highlight a course on any college site — e.g. `CSCI 240 – Data Structures`
on Ivy Tech's catalog — and instantly see whether it transfers to **Purdue West Lafayette**, as
which Purdue course, and what kind of credit. Batch mode: highlight a whole schedule, get a graded
transfer report card in **one** request.

> **Unofficial.** Always confirm with your advisor / the Purdue Registrar.

## How it works

No API exists. We reverse-engineered Purdue's public Banner self-service
[equivalency guide](https://selfservice.mypurdue.purdue.edu/prod/bzwtxcrd.p_select_info)
(full spike write-up: [`docs/purdue-endpoint.md`](docs/purdue-endpoint.md)) and consume it
directly from the extension — no backend, no keys, $0 infrastructure. Its Oracle form-array
binding turns out to support **10 courses per request**: a batch API the university never built.

```
content script ──▶ service worker ──▶ Purdue Banner (throttled fetch, 30-day cache)
 (highlight UI)     (orchestrator)        │
      ▲                                   ▼
  Shadow-DOM card ◀── offscreen document (DOMParser — MV3 workers don't have one)
```

Correctness lives in pure, fixture-tested modules (`src/parser.ts`, `src/transfer-client.ts`,
`src/school-map.ts`); anything impure is a thin shell. Unrecognized page layouts fail **loudly**
to `UNKNOWN` — wrong transfer advice delivered confidently is the one unacceptable failure.

## Dev

```bash
npm install
npm test               # 45 unit tests against captured HTML fixtures
npm run typecheck
npm run build          # -> dist/, load unpacked via chrome://extensions
node scripts/live-smoke.mjs   # optional: E2E against the live endpoint (not in CI)
```

## Verdicts

| Verdict | Meaning |
|---|---|
| ✅ `DIRECT` | Real Purdue course credit (e.g. MATH 211 → MA 16500) |
| 🟡 `ELECTIVE` | Undistributed/elective credit (e.g. CS 2XUND) |
| 🟡 `PARTIAL` | Mix of both (e.g. CHEM 105 → CHM 11510 + 11520 + 1XTRA) |
| ❌ `NONE` | No articulation on file — request evaluation via transfercredit@purdue.edu |
| ❓ `UNKNOWN` | Purdue's page changed or response unreadable — we link you to the source instead of guessing |

## Good-citizen policy

Cache-first (30-day TTL), token-bucket throttle (1 req/s), single retry, no bulk scraping,
no personal data collected, visible "Unofficial" disclaimer in every result state.
