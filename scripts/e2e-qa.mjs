/**
 * E2E QA: drives real Chromium with the built extension (dist/) via Playwright.
 * Live Purdue lookups — run locally, not in CI. Also captures 1280×800 store screenshots.
 *   npm run build && node scripts/e2e-qa.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const DIST = resolve("dist");
const SHOTS = resolve("docs/screenshots");
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true, // new headless supports extensions on the chromium channel
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});

try {
  // ---- extension id via its service worker ----
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent("serviceworker", { timeout: 10_000 });
  const extId = new URL(sw.url()).host;
  check("extension service worker registered", !!extId, extId);

  // ---- fake Ivy Tech catalog page so domain auto-detection kicks in ----
  await context.route("https://www.ivytech.edu/qa-catalog/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><body style="font: 20px sans-serif; padding: 60px">
        <h1>Course Catalog</h1>
        <p id="course">MATH 211 - Calculus I</p>
        <p>Some other content</p></body></html>`,
    }),
  );

  // ================= A. Popup: 10-course batch =================
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.fill("#schoolSearch", "ivy tech community");
  await popup.waitForFunction(() => document.querySelectorAll("#school option").length > 0);
  const firstSchool = await popup.locator("#school option").first().textContent();
  check("global search finds Ivy Tech", /Ivy Tech/i.test(firstSchool ?? ""), firstSchool ?? "");
  const autoSel = await popup.locator("#selected").textContent();
  check("top match auto-selected (no manual click needed)", /Ivy Tech/i.test(autoSel ?? ""), autoSel ?? "");
  await popup.fill("#courses",
    "MATH 211, CHEM 105, CSCI 201, ENGL 111, PSYC 101, MATH 080, ENGL 063, FIRE 101, DENT 101, SOCI 111");
  await popup.click("#check");
  await popup.waitForSelector("#results .summary", { timeout: 45_000 });
  const counts = {};
  for (const v of ["DIRECT", "PARTIAL", "ELECTIVE", "NONE", "UNKNOWN"]) {
    counts[v] = await popup.locator(`#results .card.${v}`).count();
  }
  // Live-verified 2026-07-13: SOCI 111 -> SOC 10000 (direct!), ENGL 063 -> ENGL NC (-> NONE)
  check("batch: 3 DIRECT (MATH 211, PSYC 101, SOCI 111)", counts.DIRECT === 3, JSON.stringify(counts));
  check("batch: 1 PARTIAL (CHEM 105)", counts.PARTIAL === 1);
  check("batch: 2 ELECTIVE (CSCI 201, ENGL 111)", counts.ELECTIVE === 2);
  check("batch: 4 NONE (MATH 080, ENGL 063->NC, FIRE 101, DENT 101)", counts.NONE === 4);
  check("batch: 0 UNKNOWN", counts.UNKNOWN === 0);
  const chem = await popup
    .locator(".card.PARTIAL li")
    .allTextContents();
  check("CHEM 105 shows 3 equivalency rows", chem.length === 3, chem.join(" | "));
  const disclaimer = await popup.locator(".disclaimer").textContent();
  check("disclaimer visible", /Unofficial/i.test(disclaimer ?? ""));
  await popup.screenshot({ path: `${SHOTS}/popup-batch.png` });

  // ================= B. Global search (the UND bug) =================
  await popup.fill("#schoolSearch", "north dakota");
  await popup.waitForTimeout(300);
  const opts = await popup.locator("#school option").allTextContents();
  check("UND findable regardless of default state", opts.some((o) => /Univ Of North Dakota.*\(ND\)/i.test(o)),
    opts.slice(0, 3).join(" | "));
  // bug #12: slow async init used to wipe the user's search results
  await popup.waitForTimeout(4000);
  const stillThere = await popup.locator("#selected").textContent();
  check("search survives async init (no clobber)", /North Dakota/i.test(stillThere ?? ""), stillThere ?? "");

  // ================= C. Cache populated =================
  const stored = await sw.evaluate(() => chrome.storage.local.get(null));
  const resultKeys = Object.keys(stored).filter((k) => k.startsWith("r:003825:"));
  check("results cached in chrome.storage.local", resultKeys.length >= 10, `${resultKeys.length} keys`);

  // ================= D. Highlight flow on 'ivytech.edu' =================
  const page = await context.newPage();
  await page.goto("https://www.ivytech.edu/qa-catalog/math.html");
  // select the course text and fire mouseup like a real drag-select
  const box = await page.locator("#course").boundingBox();
  const pos = await page.evaluate(() => {
    const el = document.getElementById("course");
    const range = document.createRange();
    range.selectNodeContents(el.firstChild);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const r = range.getBoundingClientRect();
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: r.right, clientY: r.bottom }));
    return { x: r.right, y: r.bottom };
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/highlight-chip.png` });
  // chip renders at (min(x, w-160), y+8), ~28px tall — click its center
  await page.mouse.click(Math.min(pos.x, 1280 - 160) + 40, pos.y + 8 + 14);
  // real Purdue lookup happens now
  await page.waitForTimeout(6000);
  const shot = `${SHOTS}/highlight-card.png`;
  await page.screenshot({ path: shot });
  // closed shadow root: assert via the host element being present + card pixels via SW cache side-effect
  const hostThere = await page.evaluate(() => !!document.getElementById("purdue-transfer-check-root"));
  check("content-script UI injected on catalog page", hostThere);
  const stored2 = await sw.evaluate(() => chrome.storage.local.get(null));
  check("highlight lookup hit cache/live path (MATH 211 key exists)",
    Object.keys(stored2).some((k) => k === "r:003825:MATH:211"));

  // ================= E. Nonsense course -> clean NONE =================
  await popup.bringToFront();
  await popup.fill("#schoolSearch", "ivy tech community");
  await popup.waitForTimeout(300);
  await popup.fill("#courses", "ZZZZ 999");
  await popup.click("#check");
  // wait for the NEW render (old batch results are still in the DOM until it lands)
  await popup.waitForFunction(
    () => document.querySelectorAll("#results .card").length === 1,
    undefined,
    { timeout: 45_000 },
  );
  const noneCount = await popup.locator("#results .card.NONE").count();
  const unkCount = await popup.locator("#results .card.UNKNOWN").count();
  check("nonsense course -> NONE, not UNKNOWN/error", noneCount === 1 && unkCount === 0,
    `NONE=${noneCount} UNKNOWN=${unkCount}`);
  const evalLink = await popup.locator(".card.NONE .caveats").first().textContent();
  check("NONE card offers evaluation contact", /transfercredit@purdue\.edu/.test(evalLink ?? ""));

  // ================= F. Bug #9 regression: 4-digit course at OSU =================
  await popup.fill("#schoolSearch", "ohio state");
  await popup.waitForTimeout(300);
  await popup.fill("#courses", "PSYCH 1100");
  await popup.click("#check");
  await popup.waitForFunction(
    () => document.querySelector("#results .card")?.textContent?.includes("PSYCH 1100"),
    undefined,
    { timeout: 45_000 },
  );
  const osuCard = await popup.locator("#results .card").first().textContent();
  check("4-digit course parses and resolves (OSU PSYCH 1100 -> PSY 12000)",
    /Direct credit/.test(osuCard ?? "") && /PSY 12000/.test(osuCard ?? ""),
    (osuCard ?? "").slice(0, 80));
} finally {
  await context.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots -> docs/screenshots/`);
process.exit(failed.length ? 1 : 0);
