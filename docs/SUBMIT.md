# Chrome Web Store submission — paste-ready

**Artifact:** `pete-purdue-etransfer-v0.3.1.zip` (280 KB, 11 files)
**Dashboard:** https://chrome.google.com/webstore/devconsole
**One-time fee:** $5 (developer registration, required before first publish)

---

## Store listing fields

**Item name**
```
Pete — Purdue e-Transfer (Unofficial)
```

**Summary** (132 char max)
```
Highlight a course on any college site and instantly see if it transfers to Purdue West Lafayette. Unofficial.
```

**Description**
```
Planning to transfer to Purdue, or taking summer classes elsewhere? Stop juggling tabs with Purdue's transfer directory.

• Highlight a course like "CSCI 240 – Data Structures" on your college's catalog → one click → see the Purdue equivalency: direct credit, elective credit, or no equivalency.

• Batch mode: paste your whole schedule → get a full transfer report card with total transferable credits, in a single request.

• Auto-detects your school on 130+ college sites (Ivy Tech, IU, Ohio State, ASU, Penn State, UCF, and more), with a searchable picker covering 3,000+ institutions for everything else.

• Data comes live from Purdue's own public Transfer Credit Course Equivalency Guide. Results are cached locally to keep things fast and to be a good citizen toward Purdue's servers.

IMPORTANT: This extension is unofficial and is not affiliated with, endorsed by, or sponsored by Purdue University. Equivalencies change; always confirm with your academic advisor or the Purdue Registrar. Transfer credit generally requires a C- or better from a regionally accredited institution, and articulations older than 10 years may need departmental review.

No accounts. No analytics. No data collected.
```

**Category:** Education
**Language:** English

**Privacy policy URL**
```
https://github.com/yuvraaj1110/pete-purdue-etransfer/blob/main/PRIVACY.md
```

**Screenshots** (1280×800, already the right size — upload in this order)
1. `docs/screenshots/highlight-card.png` — the core moment: highlight → result card
2. `docs/screenshots/popup-batch.png` — batch report card
3. `docs/screenshots/highlight-chip.png` — the chip appearing on selection

---

## Privacy practices tab (this is where submissions usually stall)

**Single purpose**
```
Look up whether a college course transfers to Purdue University West Lafayette and show the result to the user.
```

**Permission justifications** — paste one per field:

| Permission | Justification |
|---|---|
| `storage` | Caches lookup results locally for 30 days so repeat checks are instant and Purdue's public server is not re-queried unnecessarily. |
| `offscreen` | Parses the HTML response from Purdue's page. Manifest V3 service workers have no DOMParser, so an offscreen document does the parsing. |
| `activeTab` | Reads the course text the user has highlighted on the current tab, only when the user invokes the extension. |
| `contextMenus` | Adds a right-click "Check Purdue transfer credit" item for selected text. |
| Host permission `selfservice.mypurdue.purdue.edu` | The extension queries Purdue's public Transfer Credit Course Equivalency Guide directly from the browser. This is the only network destination; there is no backend. |
| Content script on all sites | The core feature is highlighting a course on any college's catalog site. Course catalogs are spread across thousands of institutional domains and third-party platforms (CourseLeaf, Coursedog, Acalog), so the extension cannot enumerate them in advance. The script only reads the user's own text selection, only on a genuine user gesture, and transmits nothing unless the user clicks to check a course. |

**Data usage disclosures** — check **none** of the data-collection boxes, then affirm:
- Not being sold to third parties ✔
- Not being used for purposes unrelated to the item's core functionality ✔
- Not being used to determine creditworthiness or for lending ✔

---

## Before you click Publish

- [ ] Reload `dist/` locally once and do one real lookup (sanity check the exact build you're uploading)
- [ ] Confirm the zip is **v0.3.1** (`unzip -p ...zip manifest.json | grep version`)
- [ ] Decide: publish immediately on approval, or hold for manual release

## Expectations

- Review typically takes **1–3 days**; extensions requesting broad host access can take longer.
- If rejected, the usual cause is the all-sites content script — the justification above is the response. A fallback is narrowing `content_scripts.matches` to a domain list and shipping the popup-only flow everywhere else.
- After approval, the listing URL becomes the install link to share (r/Purdue, transfer advising, etc.).
