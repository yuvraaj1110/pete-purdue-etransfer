import type { CourseRef, TransferReport } from "./types";

/** Typed RPC envelope between content script / popup and the service worker. */

export type BgRequest =
  | { kind: "LOOKUP"; location: string; state: string; schoolCode: string; schoolName: string;
      courses: { subject: string; number: string }[] }
  | { kind: "AJAX_LIST"; type: "states" | "school" | "subject" | "course";
      values: [string, string?, string?, string?] }
  | { kind: "DETECT_SCHOOL"; hostname: string }
  | { kind: "PARSE_SELECTION"; text: string };

export type BgResponse =
  | { ok: true; report: TransferReport }
  | { ok: true; list: { label: string; value: string }[] }
  | { ok: true; school: { code: string; name: string; location: string; state: string } | null }
  | { ok: true; courses: CourseRef[] }
  | { ok: false; error: string };

export function sendBg<T extends BgResponse>(req: BgRequest): Promise<T> {
  return chrome.runtime.sendMessage(req);
}
