/**
 * Per-tab, per-origin folder override memory in chrome.storage.session.
 * Plan §5.3. Also holds the §5.5 discovery counters. Pure over a mockable area.
 */
export interface SessionArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export const OVERRIDE_PREFIX = 'override:';
export const MAX_OVERRIDES = 200;

export type OverrideKey = `override:${number}:${string}`;
interface OverrideEntry {
  folderId: string;
  at: number;
}

export function overrideKey(tabId: number, origin: string): OverrideKey {
  return `${OVERRIDE_PREFIX}${tabId}:${origin}`;
}

function isEntry(v: unknown): v is OverrideEntry {
  return typeof v === 'object' && v !== null && typeof (v as OverrideEntry).folderId === 'string';
}

export async function getOverride(area: SessionArea, tabId: number, origin: string): Promise<string | null> {
  const key = overrideKey(tabId, origin);
  const res = await area.get(key);
  const v = res[key];
  if (isEntry(v)) {
    // touch for LRU; fire and forget
    void area.set({ [key]: { ...v, at: Date.now() } }).catch(() => undefined);
    return v.folderId;
  }
  return null;
}

export async function setOverride(area: SessionArea, tabId: number, origin: string, folderId: string): Promise<void> {
  const key = overrideKey(tabId, origin);
  await area.set({ [key]: { folderId, at: Date.now() } satisfies OverrideEntry });
  await evictIfNeeded(area);
}

export async function clearOverride(area: SessionArea, tabId: number, origin: string): Promise<void> {
  await area.remove(overrideKey(tabId, origin));
}

/** Remove every override for a closed tab. Called from tabs.onRemoved. */
export async function clearTab(area: SessionArea, tabId: number): Promise<number> {
  const all = await area.get(null);
  const prefix = `${OVERRIDE_PREFIX}${tabId}:`;
  const keys = Object.keys(all).filter((k) => k.startsWith(prefix));
  if (keys.length) await area.remove(keys);
  return keys.length;
}

/** Belt-and-braces LRU cap in case onRemoved was missed while the worker slept. */
export async function evictIfNeeded(area: SessionArea, max = MAX_OVERRIDES): Promise<number> {
  const all = await area.get(null);
  const entries = Object.entries(all)
    .filter(([k, v]) => k.startsWith(OVERRIDE_PREFIX) && isEntry(v))
    .map(([k, v]) => [k, (v as OverrideEntry).at] as const)
    .sort((a, b) => a[1] - b[1]);
  const excess = entries.length - max;
  if (excess <= 0) return 0;
  await area.remove(entries.slice(0, excess).map(([k]) => k));
  return excess;
}

// ---- §5.5 discovery: "Map this folder to <host>?" ----------------------------

const PICK_PREFIX = 'pick:';
const SUGGESTED_PREFIX = 'suggested:';
export const SUGGEST_AFTER_PICKS = 3;

/** Record a manual folder pick on a host that matched nothing. Returns the new count. */
export async function recordManualPick(area: SessionArea, host: string, folderId: string): Promise<number> {
  const key = `${PICK_PREFIX}${host}:${folderId}`;
  const cur = (await area.get(key))[key];
  const n = (typeof cur === 'number' ? cur : 0) + 1;
  await area.set({ [key]: n });
  return n;
}

export async function shouldSuggestMapping(area: SessionArea, host: string, folderId: string): Promise<boolean> {
  const pickKey = `${PICK_PREFIX}${host}:${folderId}`;
  const sugKey = `${SUGGESTED_PREFIX}${host}`;
  const res = await area.get([pickKey, sugKey]);
  if (res[sugKey]) return false;
  const n = res[pickKey];
  return typeof n === 'number' && n >= SUGGEST_AFTER_PICKS;
}

export async function markSuggested(area: SessionArea, host: string): Promise<void> {
  await area.set({ [`${SUGGESTED_PREFIX}${host}`]: true });
}

// ---- last active URL, handed from the popup to the options-page pattern tester --

const LAST_URL_KEY = 'lastActiveUrl';
export async function rememberLastUrl(area: SessionArea, url: string): Promise<void> {
  await area.set({ [LAST_URL_KEY]: url }).catch(() => undefined);
}
export async function getLastUrl(area: SessionArea): Promise<string | null> {
  const v = (await area.get(LAST_URL_KEY))[LAST_URL_KEY];
  return typeof v === 'string' ? v : null;
}

/** In-memory SessionArea for tests. */
export class MemorySession implements SessionArea {
  data = new Map<string, unknown>();
  async get(keys?: string | string[] | null) {
    const out: Record<string, unknown> = {};
    const wanted = keys == null ? [...this.data.keys()] : Array.isArray(keys) ? keys : [keys];
    for (const k of wanted) if (this.data.has(k)) out[k] = this.data.get(k);
    return out;
  }
  async set(items: Record<string, unknown>) {
    for (const [k, v] of Object.entries(items)) this.data.set(k, v);
  }
  async remove(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.data.delete(k);
  }
}

export function chromeSession(): SessionArea {
  return chrome.storage.session as unknown as SessionArea;
}
