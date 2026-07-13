/** Typed TTL cache over chrome.storage.local. Thin by design — logic stays pure elsewhere. */

const DAY = 24 * 60 * 60 * 1000;
export const RESULT_TTL = 30 * DAY;
export const SCHOOL_LIST_TTL = 30 * DAY;

interface Entry<T> {
  v: T;
  exp: number; // epoch ms
}

export function resultKey(schoolCode: string, subject: string, number: string): string {
  return `r:${schoolCode}:${subject.toUpperCase()}:${number.toUpperCase()}`;
}

export function schoolListKey(location: string, state: string): string {
  return `s:${location}:${state}`;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const obj = await chrome.storage.local.get(key);
  const entry = obj[key] as Entry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.exp) {
    void chrome.storage.local.remove(key);
    return null;
  }
  return entry.v;
}

export async function cacheSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  const entry: Entry<T> = { v: value, exp: Date.now() + ttlMs };
  await chrome.storage.local.set({ [key]: entry });
}

/** Evict expired entries; keep storage well under the 10MB quota. */
export async function cacheSweep(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const dead = Object.entries(all)
    .filter(([k, v]) => (k.startsWith("r:") || k.startsWith("s:")) && (v as Entry<unknown>).exp < now)
    .map(([k]) => k);
  if (dead.length) await chrome.storage.local.remove(dead);
}
