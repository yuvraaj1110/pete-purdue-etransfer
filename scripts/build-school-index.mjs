/**
 * One-time (re-runnable) scrape of Purdue's full institution list across every
 * state and country, via the same p_ajax cascade the page uses. Throttled.
 * Output: src/school-index.json  [{ n: name, c: code, s: state, l: location }]
 * Run: node scripts/build-school-index.mjs
 */
import { writeFileSync } from "node:fs";

const BASE = "https://selfservice.mypurdue.purdue.edu/prod/bzwtxcrd.p_ajax";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ajax(type, v1, v2, tries = 4) {
  const q = new URLSearchParams({
    request_type: type, request_value: v1, request_value2: v2 ?? "null",
    request_value3: "null", request_value4: "null", load_into: "x",
  });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${BASE}?${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return text.split("\n").slice(1).map((l) => l.trim()).filter((l) => l.includes("~"))
        .map((l) => {
          const i = l.lastIndexOf("~");
          return { label: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
        }).filter((e) => e.value !== "");
    } catch (e) {
      if (attempt >= tries) throw new Error(`${type} ${v1}: ${e.message} (after ${tries} tries)`);
      await sleep(1500 * attempt); // transient resets happen; back off and go again
    }
  }
}

const index = [];
for (const location of ["US", "Outside US"]) {
  const states = await ajax("states", location);
  console.error(`${location}: ${states.length} states/countries`);
  for (const st of states) {
    await sleep(400);
    const schools = await ajax("school", st.value, location);
    for (const s of schools) {
      index.push({ n: s.label, c: s.value, s: st.value, l: location });
    }
    console.error(`  ${st.label} (${st.value}): ${schools.length}`);
    // incremental save — a crash loses at most one state
    writeFileSync("src/school-index.json", JSON.stringify(index));
  }
}

// de-dup (some schools list under multiple regions with the same code+state)
const seen = new Set();
const deduped = index.filter((e) => {
  const k = `${e.c}|${e.s}|${e.l}`;
  return seen.has(k) ? false : (seen.add(k), true);
});

writeFileSync("src/school-index.json", JSON.stringify(deduped));
console.error(`TOTAL: ${deduped.length} institutions -> src/school-index.json`);
