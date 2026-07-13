# Chrome Web Store listing (draft)

**Name:** Pete — Purdue e-Transfer (Unofficial)
**Category:** Education · **Language:** English
**Privacy policy URL:** point to PRIVACY.md on the public GitHub repo

## Summary (132 chars max)
Highlight a course on any college site and instantly see if — and how — it transfers to Purdue West Lafayette. Unofficial.

## Description
Planning to transfer to Purdue, or taking summer classes elsewhere? Stop juggling tabs with
Purdue's transfer directory.

• Highlight a course like "CSCI 240 – Data Structures" on your college's catalog → one click →
  see the Purdue equivalency: ✅ direct credit, 🟡 elective credit, or ❌ no equivalency.
• Batch mode: highlight your whole schedule → get a full transfer report card with total
  transferable credits — in a single request.
• Auto-detects your school on common Indiana college sites (Ivy Tech, IU, Ball State, …),
  manual picker for everything else, including international institutions.
• Data comes live from Purdue's own public Transfer Credit Course Equivalency Guide.
  Results are cached to keep things fast and polite.

IMPORTANT: This extension is unofficial and not affiliated with Purdue University. Equivalencies
change; always confirm with your academic advisor or the Purdue Registrar. Transfer credit
generally requires a C- or better from a regionally accredited institution, and articulations
older than 10 years may need departmental review.

## Privacy note
No accounts, no analytics, no personal data collected or transmitted. Course lookups go directly
from your browser to Purdue's public equivalency page (selfservice.mypurdue.purdue.edu). Results
are cached locally in your browser only.

## Permissions justification (for review)
- `host_permissions: selfservice.mypurdue.purdue.edu` — perform the equivalency lookup.
- `storage` — local cache of results (30-day TTL) and school lists.
- `offscreen` — parse Purdue's HTML response (MV3 service workers lack DOMParser).
- `activeTab` — read the highlighted course text when you invoke the extension.
- `contextMenus` — right-click "Check Purdue transfer credit" on selected text.
- Content script on `<all_urls>` — show the highlight chip/result card on catalog sites.
  (Consider narrowing to a site list post-launch if reviewers push back.)

## Assets needed before submission
- [ ] 1280×800 screenshots: highlight→card on Ivy Tech; popup batch report; PARTIAL example
- [ ] 440×280 small promo tile
- [ ] Real icon (current one is a placeholder)
- [ ] $5 one-time developer registration
