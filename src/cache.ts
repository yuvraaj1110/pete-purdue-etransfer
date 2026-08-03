/** Typed TTL cache over chrome.storage.local. Thin by design — logic stays pure elsewhere. */

const DAY = 24 * 60 * 60 * 1000;
export const RESULT_TTL = 30 * DAY;
export const SCHOOL_LIST_TTL = 30 * DAY;

/** Hard ceiling on cached lookups. ~1KB each, well inside the 10MB quota. */
export const MAX_RESULT_ENTRIES = 2000;

interface Entry<T> {
  v: T;
  exp: number; // epoch ms
  at?: number; // last access, for LRU eviction
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
  const now = Date.now();
  const entry: Entry<T> = { v: value, exp: now + ttlMs, at: now };
  try {
    await chrome.storage.local.set({ [key]: entry });
  } catch {
    // Quota exceeded (or transient): sweep, then try once more. Without this a
    // full cache turns every subsequent lookup into an error.
    await cacheSweep();
    await chrome.storage.local.set({ [key]: entry });
  }
}

/**
 * Evict expired entries, then enforce MAX_RESULT_ENTRIES by dropping the
 * least-recently-used results. Previously TTL-only and run just once at
 * install, so the cache could grow until it hit the quota and started
 * throwing (docs/security-review.md finding 4).
 */
export async function cacheSweep(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const dead: string[] = [];
  const live: { key: string; at: number }[] = [];

  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith("r:") && !k.startsWith("s:")) continue;
    const e = v as Entry<unknown>;
    if (e.exp < now) dead.push(k);
    else if (k.startsWith("r:")) live.push({ key: k, at: e.at ?? e.exp });
  }

  if (live.length > MAX_RESULT_ENTRIES) {
    live.sort((a, b) => a.at - b.at); // oldest access first
    for (const { key } of live.slice(0, live.length - MAX_RESULT_ENTRIES)) dead.push(key);
  }
  if (dead.length) await chrome.storage.local.remove(dead);
}
