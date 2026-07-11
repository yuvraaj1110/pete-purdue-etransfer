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

## 6. Risks / unknowns still open

- Elective patterns other than `\dXUND` (and how multi-row results render, e.g. one course → two Purdue courses) — handle defensively, collect fixtures as found.
- BigIP/WAF may rate-limit bursts — keep the 1 req/sec throttle.
- `p_ajax` values are echoed into the response (`load_into`) — never reflect them into extension DOM without sanitizing.
