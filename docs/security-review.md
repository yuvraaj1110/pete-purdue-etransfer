# Security Review — Pete (Purdue e-Transfer)

**Date:** 2026-07-13 · **Version reviewed:** v0.3.0 · **Fixes shipped in:** v0.3.1
**Method:** adversarial code review of every trust boundary, plus empirical probes run against
the built extension in an isolated Chromium profile (hostile-page simulation, synthetic events,
message-boundary tests, ReDoS timing, injection fuzzing). No live systems were attacked.

## Threat model

Pete injects UI into every page, reads text selections, and queries a third-party public server.
The realistic adversaries are: **(a)** a malicious/compromised website the user visits,
**(b)** a hostile response from Purdue's endpoint, **(c)** a local attacker reading browser
storage, **(d)** someone abusing Pete (or a fork) to hammer Purdue. There is no login, no
credential, no payment, and no server of our own — so account takeover and server compromise are
out of scope by construction.

## Summary

No remote code execution, credential theft, or data-exfiltration path was found. The genuine
exposure was **privacy and impersonation at the content-script boundary**. Five findings were
fixed; the rest are accepted risks documented below.

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | Any page could fingerprint the extension | Medium | **Fixed** v0.3.1 |
| 2 | Any page could impersonate Pete's result card | Medium | **Fixed** v0.3.1 (partial) |
| 3 | Delegated trust to catalog SaaS hosts | Low–Med | Accepted, documented |
| 4 | Unbounded cache → quota exhaustion | Low | **Fixed** v0.3.1 |
| 5 | Page can delete our injected UI | Low | Accepted (inherent) |
| 6 | Message-port leak on unknown request kind | Low | **Fixed** v0.3.1 |
| 7 | Latent `innerHTML` sinks in the popup | Low | **Fixed** v0.3.1 |
| 8 | Lookups sent to Purdue as GET query params | Low | Accepted, disclosed |

## What held up under attack (verified, not assumed)

- **Pages cannot message the extension.** No `web_accessible_resources`, no
  `externally_connectable`; `chrome.runtime` is absent from the page world. Probe confirmed.
- **Result contents are unreadable by the host page** — closed shadow root; `host.shadowRoot`
  returns `null` from page context. Probe confirmed.
- **No XSS reachable.** Injected markup (`<img onerror>`, `<svg onload>`, `<script>`) is stripped
  by `parseCourseFromText`; only `[A-Z0-9]` reaches any DOM sink.
- **No ReDoS.** The course regex uses only bounded quantifiers (`{2,8}`, `{2,4}`, `{0,2}`) with no
  overlapping alternation; 8KB pathological inputs complete in ≤1ms.
- **No SSRF or URL injection** — fixed base URL, all parameters `encodeURIComponent`-encoded,
  host permission scoped to a single origin.
- **Purdue's HTML cannot execute.** `DOMParser` does not run scripts or fetch subresources, and we
  read only `textContent`.
- **No runtime dependencies** — no third-party code ships in the extension, so there is no
  npm supply-chain surface in the published artifact.

---

## Findings

### 1. Extension fingerprinting via synthetic events — Medium — FIXED

**Attack:** a page programmatically selects text that looks like a course, dispatches a synthetic
`mouseup`, waits, then checks for `document.getElementById("purdue-transfer-check-root")`.

**Impact:** silently identifies the visitor as a Pete user — i.e. very likely a prospective
Purdue transfer student. That is exactly the kind of inference ad-tech and data brokers monetize,
and the user never consented to disclosing it to arbitrary sites.

**Verified before fix:** `extensionDetected: true`.

**Fix:** the `mouseup` handler now requires `ev.isTrusted`. Synthetic events are `false`, so a page
cannot induce our UI at all. This also removes a CPU-abuse vector (a page firing `mouseup` in a
loop to force repeated parsing/DOM work).

**Verified after fix:** no host element is injected by synthetic events; real user gestures still
work.

### 2. UI impersonation / brand abuse — Medium — FIXED (partial)

**Attack:** the injected host element used a constant id, so any page could create its own element
with that id and style a convincing fake Pete card — e.g. "✅ Direct credit" for a course that does
not transfer (academic misinformation attributed to us), or a fake "Sign in to Purdue" prompt.

**Fix:** the host id is randomized per page load (`ptc-<random>`), so a page cannot reliably target
or pre-empt our element, and the fingerprint in finding 1 is gone even if a gesture occurs.

**Residual risk (accepted, inherent):** any page can always draw arbitrary pixels, so a
sufficiently determined site can still *paint* something resembling our card. Mitigating factors:
Pete never asks for credentials or any personal data, so there is no legitimate flow for a phishing
imitation to blend into; and the real card's contents stay unreadable behind the closed shadow root.

### 3. Delegated trust to third-party catalog hosts — Low–Medium — ACCEPTED

v0.3.0 maps `*.courseleaf.com`, `*.coursedog.com`, `*.smartcatalogiq.com`, `*.acalog.com` by
deriving a school slug from the leftmost label. This delegates identity to those SaaS platforms:
anyone controlling a subdomain there — including via subdomain takeover — could make Pete attribute
the wrong school.

**Impact is bounded:** the worst outcome is a lookup against the wrong institution (wrong answer),
never code execution or data access. Unknown slugs return `null` rather than guessing. Accepted
because the alternative is losing auto-detection on the pages students actually read, and every
result already carries an "Unofficial — confirm with your advisor" disclaimer.

### 4. Unbounded cache → quota exhaustion — Low — FIXED

The cache enforced a 30-day TTL but had **no size cap**, and `cacheSweep()` ran **only on install**
— so it never ran again for a long-lived installation. At ~1KB per result, sustained use fills the
10MB `storage.local` quota, after which `cacheSet` throws and lookups begin failing.
`docs/PROJECT_CONTEXT.md` claimed "LRU evict", which did not exist — a docs/code mismatch.

**Fix:** real LRU eviction with a `MAX_RESULT_ENTRIES` (2000) ceiling, an `at` (last-access)
timestamp per entry, a sweep on every lookup that hits the network, and a quota-failure fallback
that sweeps and retries once instead of surfacing an error.

### 5. A page can delete our injected UI — Low — ACCEPTED

The host element lives in the page DOM, so the page can remove it. Verified `canRemoveOurUI: true`.
This is inherent to content-script UI; impact is availability on that page only (the user can still
use the popup). Not worth the complexity of a MutationObserver arms race.

### 6. Message-port leak on unknown request kind — Low — FIXED

The background listener returned `true` (async response) but had no `default` branch, so an
unrecognized `kind` never called `sendResponse` and the caller's promise never settled.
**Fix:** a `default` case that always answers `{ ok: false, error: "unsupported request" }`.
Verified: previously would hang, now answers immediately.

### 7. Latent `innerHTML` sinks in the popup — Low — FIXED

Three sinks interpolated values into `innerHTML`: the course code line, and two error paths
(`res.error`, `e.message`). Not exploitable today — the parser constrains subject/number to
`[A-Z0-9]` — but the only thing preventing XSS was an invariant enforced in a different module.
**Fix:** all three now build nodes and assign `textContent`.

### 8. Lookups travel as GET query parameters — Low — ACCEPTED, DISCLOSED

We switched the report request from POST to GET to work around Oracle ORDS rejecting
`Origin: chrome-extension://…` (see `hardest-bugs.md` #7). Correct fix, but a security-relevant
tradeoff: course codes now appear in Purdue's web-server access logs alongside the user's IP, which
is more durable and more widely logged than a POST body. The data is low-sensitivity (public course
codes) and Purdue would receive it anyway from a manual lookup, but it should be stated plainly in
the privacy policy rather than left implicit.

---

## Abuse and policy risks (not code defects)

- **We published a scraping recipe.** `docs/purdue-endpoint.md` documents the endpoint *and* the
  10-courses-per-request array-binding trick. Our 1 req/sec throttle is client-side and trivially
  removed in a fork. This is a deliberate transparency/abuse tradeoff and should be a conscious
  decision, not an accident. Current stance: keep it public (it documents a public system, and the
  write-up is the project's main technical artifact), but do not add convenience tooling that
  lowers the effort to bulk-collect.
- **Content script runs on all URLs** (`http://*/*`, `https://*/*`) and inspects selections on
  every trusted `mouseup`. Nothing is transmitted without an explicit click, but this is the
  permission a Chrome Web Store reviewer will scrutinize hardest, and the honest justification is
  "highlight-anywhere is the product."
- **Local storage reveals an academic profile.** Cached lookups disclose which school the user
  attends and which courses they are considering, unencrypted in `storage.local`. Only reachable
  by an attacker with local machine access (other extensions cannot read it). Accepted.
- **Trademark.** The mascot likeness and "Purdue" naming carry takedown risk; the "(Unofficial)"
  naming, disclaimer, and PRIVACY.md affiliation statement are the mitigations.

## Re-test instructions

The probes used here are ad-hoc rather than committed (they simulate a hostile page and are not
meaningful CI assertions). To reproduce: load `dist/` in Chromium, serve a page that dispatches a
synthetic selection + `mouseup`, and confirm no element matching `div[id^="ptc-"]` is injected,
while a genuine mouse gesture does inject one.
