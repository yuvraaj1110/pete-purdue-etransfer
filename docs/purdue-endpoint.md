# Purdue Transfer Equivalency Endpoint — Spike Findings

Captured 2026-07-11 against the live system. All requests verified **cold** (no cookies, no session, plain `curl`). This removes the biggest project risk: **no session state is required for any request.**

Base: `https://selfservice.mypurdue.purdue.edu/prod/`

## 1. Entry page

`GET bzwtxcrd.p_select_info` → HTTP 200. Sets only a BigIP load-balancer cookie (`BIGipServer~BAN~pool_ords_8080`) — affinity, not auth. Requests work without it.

Backend: Ellucian Banner on Oracle ORDS (`X-ORDS_DEBUG` header present). Server-rendered HTML; one `<form>` POSTing to `bzwtxcrd.p_display_report`.

## 2. Cascade AJAX endpoint (populates the dropdowns)

`GET bzwtxcrd.p_ajax` with query params:

| param | meaning |
|---|---|
| `request_type` | `states` \| `school` \| `subject` \| `course` |
| `request_value` | primary filter (see chains below) |
| `request_value2..4` | parent filter values; literal string `null` when unused |
| `load_into` | target select id — echoed back as line 1, value is irrelevant to the data |

Chains (as issued by the page's `ajaxLoad()`):

```
states:  request_value=US                       (or "Outside US")
school:  request_value=<state code e.g. IN>     request_value2=<location e.g. US>
subject: request_value=<school code>            request_value2=<state> request_value3=<location>
course:  request_value=<subject e.g. CSCI>      request_value2=<school code>
```

**Response format** (plain text, `text/html` content type):

```
<load_into id>\n
Display Text~VALUE\n
Display Text~VALUE\n
...
```

Examples verified:

- `states` for US → `Indiana~IN`, plus Canadian provinces (BC/ON/QC) mixed in.
- `school` for IN/US → `Ivy Tech Community College-IN~003825` (school code ≈ FICE code, 6 chars; oddballs exist e.g. `DD 214-Military Service~US1117`).
- `subject` for 003825 → `CSCI~CSCI`, `MATH~MATH`, … (text == value).
- `course` for CSCI@003825 → `101, 102, 105, 201, 202, 210, 279` (only articulated courses appear — the cascade itself is a partial "does it transfer" filter, but a missing course here ≠ NONE verdict; unlisted just means no articulation on file).

## 3. Report endpoint (the actual lookup)

`POST bzwtxcrd.p_display_report`, `Content-Type: application/x-www-form-urlencoded`.

Oracle mod_plsql array binding: **every param must be repeated exactly 5 times** (5 form rows), in row order. Both report sections share the form, so all 10 param names are sent — unused ones as empty strings:

```
row × 5: location_in, state_in, school_in, subject_in, course_in,
         purdue_subject_in, purdue_course_in, purdue_location_in,
         purdue_state_in, purdue_school_in
```

Fill row 1 of the transfer-school params (`location_in=US`, `state_in=IN`, `school_in=003825`, `subject_in=CSCI`, `course_in=201`), leave everything else `""`. No CSRF token, no hidden fields, no referer check observed.

Working curl reproduction:

```bash
D=""
for i in 1 2 3 4 5; do
  if [ $i = 1 ]; then
    D+="location_in=US&state_in=IN&school_in=003825&subject_in=CSCI&course_in=201&"
  else
    D+="location_in=&state_in=&school_in=&subject_in=&course_in=&"
  fi
  D+="purdue_subject_in=&purdue_course_in=&purdue_location_in=&purdue_state_in=&purdue_school_in=&"
done
curl -X POST "https://selfservice.mypurdue.purdue.edu/prod/bzwtxcrd.p_display_report" \
  -H "Content-Type: application/x-www-form-urlencoded" --data "${D%&}"
```

## 4. Result HTML — three shapes (fixtures in `tests/fixtures/`)

Anchor: `<table ... class="reportTable">` following the `<h2>Create a Report by Transfer School Course - Results</h2>` header. 9 columns:

`Transfer School | Transfer Subject | Transfer Course | Transfer Title | Transfer Credits | Purdue Subject | Purdue Course | Purdue Title | Purdue Credits`

Cells are `<td class="colN ">` (note trailing space in the class attr).

1. **DIRECT** (`direct.html`): Ivy Tech MATH 211 → `MA` / `16500` / "Anlytc Geomtry&Calc I" / 4 cr. Purdue Course is a real 5-digit number.
2. **ELECTIVE/UNDISTRIBUTED** (`undistributed.html`): Ivy Tech CSCI 201 → `CS` / `2XUND` / 3 cr. Pattern: `^\dXUND$` (level + "XUND"). Expect other elective patterns (e.g. `1XXXX`-style) — classify anything non-5-digit-numeric as ELECTIVE, and anything unrecognized as UNKNOWN.
3. **NONE** (`no-match.html`): no `reportTable` in the response at all (POST for CSCI 999). Detection: Results `<h2>` present but no report table → NONE.

**Caveat markers:** `&dagger;` (†) appended to the Transfer Course cell = part of the Transfer Indiana initiative (footnote text is on the page). Strip markers before parsing; surface as a caveat string. Page-level caveats worth always showing: regionally-accredited only, courses >10 years removed, subject to change.

## 5. Implications for the extension

- **No proxy needed.** Host permission for `selfservice.mypurdue.purdue.edu` + plain `fetch` from the MV3 service worker is sufficient. No cookies to carry.
- **School list can be pre-fetched** per state via `p_ajax` (cheap, cacheable ~30 days) instead of bundling a stale list.
- **Course dropdown as pre-check:** before POSTing the report, `p_ajax request_type=course` tells us instantly whether ANY articulation exists — a 1-request fast path for the NONE case.
- **Parsing:** anchor on `class="reportTable"`; assert the 9 expected `<th>` labels before trusting cell positions — if headers differ, return UNKNOWN (loud failure per CLAUDE.md §9).
- Responses are ~18KB; cache by `school|subject|course` in `chrome.storage.local`.

## 6. Stress-test findings (2026-07-11, second pass)

Breaking points discovered by probing — each is a parser/design requirement:

1. **One transfer course → multiple Purdue courses.** Ivy Tech CHEM 105 → `CHM 11510` + `CHM 11520` + `CHM 1XTRA` (3 rows). Continuation rows have `&nbsp;` in the first 5 cells. Parser must group rows: a row with an empty Transfer School cell belongs to the previous course. (`tests/fixtures/batch5.html`)
2. **Mixed verdicts.** CHEM 105 gets DIRECT (11510/11520) *and* ELECTIVE (1XTRA) credit simultaneously. The CLAUDE.md single-`purdueCourse` result shape is wrong — use `equivalencies: [{subject, number, title, credits, kind}]` with an overall verdict derived (any 5-digit → has direct; only X-codes → elective; etc.).
3. **Batch POST works — this is free batch mode.** Filling multiple rows returns all results in ONE request. 10 rows accepted (`tests/fixtures/batch10.html`). BUT results come back **sorted alphabetically by subject, not in request order** — match responses by (subject, course) columns, never by index.
4. **1-row POST silently fails** (returns the no-match page even for a known-good course; likely mod_plsql scalar-vs-array binding). 4, 5, and 10 rows all work. Rule: **always send ≥2 — mirror the real form's 5 unless batching.**
5. **Inputs are case-sensitive.** `csci` returns an empty course list with HTTP 200 — no error. Uppercase everything before querying.
6. **Course numbers are not numbers.** `111H`, `101AH`, `063` (leading zero) all exist. Treat as opaque strings end-to-end.
7. **Cascade presence ≠ articulation exists.** ENGL 111H appears in the `p_ajax` course list but the report returns no table. The fast-path is only trustworthy in the negative direction (absent from list → NONE). Present-but-no-table → show NONE with a "request an evaluation" link (transfercredit@purdue.edu).
8. **Invalid school code is indistinguishable from no-match** (same no-table page, same byte size). Validate school codes against the fetched list before querying.
9. **Raw unescaped `&` in titles** ("Anlytc Geomtry&Calc I"). Must parse with a lenient HTML parser (DOMParser/offscreen doc). Never XML parsing, never naive regex on entities.
10. **Elective code pattern generalizes:** `2XUND`, `1XSCI`, `1XUWC`, `1XTRA` → `^\d X [A-Z]{3}$` (level + X + 3-letter bucket). DIRECT = `^\d{5}$`. Anything else → UNKNOWN, loudly.
11. **No rate limiting observed** (8-request burst, all 200). Keep the 1 req/sec self-throttle anyway — being unthrottled is not permission.
12. **MV3 has no `DOMParser` in service workers.** Parse in an offscreen document (`chrome.offscreen`) or in the popup/content-script context.
13. `p_ajax` echoes `load_into` back into the response — sanitize before any DOM insertion.
14. BigIP fronted — transient 5xx/affinity flakiness possible; retry once with backoff.
