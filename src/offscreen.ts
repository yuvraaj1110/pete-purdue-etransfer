import { parseReportHtml } from "./parser";

/**
 * Offscreen document: exists only because MV3 service workers lack DOMParser.
 * Receives raw HTML, returns the ParseOutcome. No network, no storage.
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === "PARSE_REPORT_HTML" && typeof msg.html === "string") {
    sendResponse(parseReportHtml(msg.html));
  }
  return false;
});
