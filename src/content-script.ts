import { sendBg } from "./messages";
import type { TransferReport } from "./types";

/**
 * Content script: selection -> floating "Check" chip -> Shadow-DOM result card.
 * All styles live inside a shadow root so host-page CSS can't leak in or out.
 */

let shadowHost: HTMLDivElement | null = null;
// Kept in a module var: element.shadowRoot is ALWAYS null for closed roots,
// so it cannot be re-read from the host (this broke every second UI render).
let shadowRootRef: ShadowRoot | null = null;

function ensureShadow(): ShadowRoot {
  if (shadowHost?.isConnected && shadowRootRef) return shadowRootRef;
  shadowHost = document.createElement("div");
  shadowHost.id = "purdue-transfer-check-root";
  shadowHost.style.cssText = "all: initial; position: fixed; z-index: 2147483647;";
  const shadow = shadowHost.attachShadow({ mode: "closed" });
  shadowRootRef = shadow;
  const style = document.createElement("style");
  style.textContent = `
    .chip { position: fixed; background: #cfb991; color: #000; border: 1px solid #9d8a5e;
      border-radius: 14px; padding: 4px 10px; font: 12px system-ui; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,.25); }
    .card { position: fixed; background: #fff; color: #111; border: 1px solid #bbb;
      border-radius: 8px; padding: 10px 12px; font: 13px/1.4 system-ui; max-width: 340px;
      box-shadow: 0 4px 16px rgba(0,0,0,.25); }
    .card h3 { margin: 0 0 6px; font-size: 13px; }
    .item { margin: 6px 0; padding-left: 8px; border-left: 3px solid #999; }
    .item.DIRECT { border-color: #2e7d32; } .item.PARTIAL, .item.ELECTIVE { border-color: #f9a825; }
    .item.NONE { border-color: #c62828; } .item.UNKNOWN { border-color: #757575; }
    .eq { margin: 2px 0 0 14px; padding: 0; }
    .close { float: right; cursor: pointer; border: 0; background: none; font-size: 14px; }
    .foot { margin-top: 8px; font-size: 10px; color: #a15c00; }
  `;
  shadow.append(style);
  document.documentElement.append(shadowHost);
  return shadow;
}

function clearUi(): void {
  shadowRootRef &&
    [...shadowRootRef.querySelectorAll(".chip, .card")].forEach((n) => n.remove());
}

function showChip(x: number, y: number, text: string): void {
  const shadow = ensureShadow();
  clearUi();
  const chip = document.createElement("button");
  chip.className = "chip";
  chip.textContent = "Purdue transfer? ▸";
  chip.style.left = `${Math.min(x, innerWidth - 160)}px`;
  chip.style.top = `${y + 8}px`;
  chip.addEventListener("click", () => void runCheck(text, x, y));
  shadow.append(chip);
}

const VERDICT_TEXT: Record<string, string> = {
  DIRECT: "✅ Direct credit", PARTIAL: "🟡 Partial credit", ELECTIVE: "🟡 Elective credit",
  NONE: "❌ No equivalency", UNKNOWN: "❓ Unknown — check official page",
};

function showCard(report: TransferReport, x: number, y: number): void {
  const shadow = ensureShadow();
  clearUi();
  const card = document.createElement("div");
  card.className = "card";
  card.style.left = `${Math.min(x, innerWidth - 360)}px`;
  card.style.top = `${y + 8}px`;

  const close = document.createElement("button");
  close.className = "close";
  close.textContent = "✕";
  close.addEventListener("click", clearUi);
  card.append(close);

  const h = document.createElement("h3");
  h.textContent = `Purdue transfer — ${report.school}`;
  card.append(h);

  for (const item of report.items) {
    const div = document.createElement("div");
    div.className = `item ${item.verdict}`;
    div.textContent = `${item.source.subject} ${item.source.number}: ${VERDICT_TEXT[item.verdict]}`;
    if (item.equivalencies.length) {
      const ul = document.createElement("ul");
      ul.className = "eq";
      for (const e of item.equivalencies) {
        const li = document.createElement("li");
        li.textContent = `${e.subject} ${e.number}${e.credits != null ? ` (${e.credits} cr)` : ""}`;
        ul.append(li);
      }
      div.append(ul);
    }
    card.append(div);
  }

  const foot = document.createElement("div");
  foot.className = "foot";
  foot.textContent = "Unofficial — confirm with your advisor / Purdue Registrar.";
  card.append(foot);
  shadow.append(card);
}

function showMsg(text: string, x: number, y: number): void {
  const shadow = ensureShadow();
  clearUi();
  const card = document.createElement("div");
  card.className = "card";
  card.style.left = `${Math.min(x, innerWidth - 360)}px`;
  card.style.top = `${y + 8}px`;
  card.textContent = text;
  shadow.append(card);
  setTimeout(clearUi, 4000);
}

async function runCheck(text: string, x: number, y: number): Promise<void> {
  const parsed = await sendBg({ kind: "PARSE_SELECTION", text });
  if (!("courses" in parsed) || !parsed.ok || parsed.courses.length === 0) {
    showMsg("Couldn't find a course like “CSCI 240” in the selection.", x, y);
    return;
  }
  const detected = await sendBg({ kind: "DETECT_SCHOOL", hostname: location.hostname });
  if (!("school" in detected) || !detected.ok || !detected.school) {
    showMsg("School not auto-detected for this site — use the extension popup to pick it.", x, y);
    return;
  }
  showMsg("Checking with Purdue…", x, y);
  const res = await sendBg({
    kind: "LOOKUP",
    location: detected.school.location,
    state: detected.school.state,
    schoolCode: detected.school.code,
    schoolName: detected.school.name,
    courses: parsed.courses.slice(0, 10).map((c) => ({ subject: c.subject, number: c.number })),
  });
  if ("report" in res && res.ok) showCard(res.report, x, y);
  else showMsg(`Lookup failed: ${"error" in res ? res.error : "unknown error"}`, x, y);
}

document.addEventListener("mouseup", (ev) => {
  // ignore clicks on our own UI
  if (ev.target instanceof Node && shadowHost?.contains(ev.target)) return;
  const sel = window.getSelection()?.toString() ?? "";
  if (sel.trim().length >= 5 && /\d/.test(sel)) showChip(ev.clientX, ev.clientY, sel);
  else clearUi();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.kind === "CHECK_SELECTION" && typeof msg.text === "string") {
    void runCheck(msg.text, innerWidth / 2 - 170, 40);
  }
});
