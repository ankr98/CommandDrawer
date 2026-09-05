/**
 * Storage layer. Plan §3 — everything about sync quotas lives here and nowhere else.
 *
 *  - one item per folder: `folder:<id>`; chunked as `folder:<id>:<n>` when large
 *  - meta in `meta`
 *  - byte + item accounting, refuse folder creation near MAX_ITEMS
 *  - debounced, coalesced writes
 *  - sync full → fall back to storage.local, mark folder "local only"
 *  - lenient read: missing chunk / orphan parent never throws
 */
import { defaultMeta, migrateMeta, parseFolder, type Folder, type Meta } from './schema';
import { recoverOrphans } from './tree';

/** Hard limits of chrome.storage.sync. */
export const SYNC_QUOTA_BYTES = 102_400;
export const SYNC_QUOTA_BYTES_PER_ITEM = 8_192;
export const SYNC_MAX_ITEMS = 512;
/** Stay under the per-item cap with headroom for key length and escaping. */
export const ITEM_BUDGET_BYTES = 7_500;
/** Refuse new folders at 90% of MAX_ITEMS. */
export const ITEM_COUNT_GUARD = Math.floor(SYNC_MAX_ITEMS * 0.9);
export const WRITE_DEBOUNCE_MS = 600;

export const META_KEY = 'meta';
export const FOLDER_PREFIX = 'folder:';

/** Minimal mockable subset of chrome.storage.StorageArea. */
export interface StorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  getBytesInUse?(keys?: string | string[] | null): Promise<number>;
}

const enc = new TextEncoder();
export function byteLength(s: string): number {
  return enc.encode(s).length;
}
/** Size the way chrome.storage.sync measures it: key length + JSON of value. */
export function measureItem(key: string, value: unknown): number {
  return byteLength(key) + byteLength(JSON.stringify(value));
}

export function folderKey(id: string): string {
  return `${FOLDER_PREFIX}${id}`;
}
export function chunkKey(id: string, n: number): string {
  return `${FOLDER_PREFIX}${id}:${n}`;
}

/** A chunk header stored under the plain folder key when the folder is split. */
interface ChunkHeader {
  __chunks: number;
}
function isChunkHeader(v: unknown): v is ChunkHeader {
  return typeof v === 'object' && v !== null && typeof (v as ChunkHeader).__chunks === 'number';
}

/**
 * Serialise a folder into one or more storage items, each within ITEM_BUDGET_BYTES.
 * Pieces are substrings of the JSON text, measured after JSON re-encoding so
 * that quote/backslash escaping is accounted for.
 */
export function chunkFolder(folder: Folder, budget = ITEM_BUDGET_BYTES): Record<string, unknown> {
  const key = folderKey(folder.id);
  if (measureItem(key, folder) <= budget) return { [key]: folder };
  const json = JSON.stringify(folder);
  const items: Record<string, unknown> = {};
  let pos = 0;
  let n = 0;
  while (pos < json.length) {
    const k = chunkKey(folder.id, n);
    let len = Math.min(json.length - pos, budget - k.length - 2);
    let piece = json.slice(pos, pos + len);
    while (len > 1 && measureItem(k, piece) > budget) {
      len = Math.max(1, Math.floor(len * 0.9));
      piece = json.slice(pos, pos + len);
    }
    items[k] = piece;
    pos += len;
    n++;
  }
  items[key] = { __chunks: n } satisfies ChunkHeader;
  return items;
}

/** Keys in `all` that belong to folder `id` (header + chunks). */
export function keysForFolder(all: Record<string, unknown>, id: string): string[] {
  const key = folderKey(id);
  const prefix = key + ':';
  return Object.keys(all).filter((k) => k === key || k.startsWith(prefix));
}

export type ReadFolderResult = { folder: Folder } | { error: string };

/** Reassemble a folder from a full key/value dump. Never throws. */
export function readFolder(all: Record<string, unknown>, id: string): ReadFolderResult | null {
  const head = all[folderKey(id)];
  if (head === undefined) return null;
  let raw: unknown = head;
  if (isChunkHeader(head)) {
    let json = '';
    for (let i = 0; i < head.__chunks; i++) {
      const piece = all[chunkKey(id, i)];
      if (typeof piece !== 'string') return { error: `Folder ${id} is missing chunk ${i} of ${head.__chunks}` };
      json += piece;
    }
    try {
      raw = JSON.parse(json);
    } catch {
      return { error: `Folder ${id} has corrupt chunk data` };
    }
  }
  const folder = parseFolder(raw);
  if (!folder) return { error: `Folder ${id} could not be parsed` };
  if (folder.id !== id) folder.id = id;
  return { folder };
}

export function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /quota|MAX_ITEMS|MAX_WRITE|QUOTA_BYTES|exceeded/i.test(msg);
}

export interface Usage {
  syncBytes: number;
  syncQuotaBytes: number;
  syncItems: number;
  syncMaxItems: number;
  localOnlyFolderIds: string[];
  /** percentage 0..100 of the more constrained resource */
  percent: number;
}

export interface LoadedState {
  meta: Meta;
  folders: Folder[];
  localOnly: Set<string>;
  warnings: string[];
}

export interface Areas {
  sync: StorageArea;
  local: StorageArea;
}

/** Load everything, recovering from partial data. Never throws on bad data. */
export async function loadAll(areas: Areas): Promise<LoadedState> {
  const warnings: string[] = [];
  const [syncAll, localAll] = await Promise.all([areas.sync.get(null), areas.local.get(null)]);
  const { meta, migrated } = migrateMeta(syncAll[META_KEY] ?? localAll[META_KEY]);
  if (migrated) warnings.push('Settings were migrated from an older or damaged format');

  const localOnly = new Set<string>();
  const folders: Folder[] = [];
  const idsFromKeys = (all: Record<string, unknown>) =>
    Object.keys(all)
      .filter((k) => k.startsWith(FOLDER_PREFIX) && !/:\d+$/.test(k.slice(FOLDER_PREFIX.length)))
      .map((k) => k.slice(FOLDER_PREFIX.length));
  // Union of meta.folderIds and what actually exists — meta can lag behind a sync.
  const ids = new Set<string>([...meta.folderIds, ...idsFromKeys(syncAll), ...idsFromKeys(localAll)]);

  for (const id of ids) {
    // local wins if present in both: it is the newer, overflowed copy.
    const fromLocal = readFolder(localAll, id);
    const fromSync = readFolder(syncAll, id);
    const pick = fromLocal ?? fromSync;
    if (!pick) {
      warnings.push(`Folder ${id} is listed but has no data; skipped`);
      continue;
    }
    if ('error' in pick) {
      const alt = pick === fromLocal ? fromSync : fromLocal;
      if (alt && 'folder' in alt) {
        folders.push(alt.folder);
        if (alt === fromLocal) localOnly.add(id);
      } else {
        warnings.push(pick.error);
      }
      continue;
    }
    folders.push(pick.folder);
    if (pick === fromLocal) localOnly.add(id);
  }
  const recovered = recoverOrphans(folders);
  warnings.push(...recovered.fixes);
  const finalMeta: Meta = { ...meta, folderIds: recovered.folders.map((f) => f.id) };
  return { meta: finalMeta, folders: recovered.folders, localOnly, warnings };
}

type Listener = (state: LoadedState) => void;

/**
 * In-memory state + persistence with debounced, coalesced writes.
 * UI code talks to this; nothing else touches chrome.storage.
 */
export class SnippetStore {
  private meta: Meta = defaultMeta();
  private folders = new Map<string, Folder>();
  private localOnly = new Set<string>();
  private warnings: string[] = [];
  private syncKeys = new Set<string>();
  private dirtyFolders = new Set<string>();
  private deletedFolders = new Set<string>();
  private metaDirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private listeners = new Set<Listener>();
  private loaded = false;

  constructor(
    private areas: Areas,
    private debounceMs = WRITE_DEBOUNCE_MS,
  ) {}

  async load(): Promise<LoadedState> {
    const state = await loadAll(this.areas);
    // Keep unflushed local edits over whatever came from storage.
    const pendingFolders = new Map([...this.dirtyFolders].map((id) => [id, this.folders.get(id)]));
    const pendingMeta = this.metaDirty ? this.meta : null;
    this.meta = pendingMeta ?? state.meta;
    this.folders = new Map(state.folders.map((f) => [f.id, f]));
    for (const [id, f] of pendingFolders) {
      if (f) this.folders.set(id, f);
    }
    for (const id of this.deletedFolders) this.folders.delete(id);
    this.localOnly = state.localOnly;
    this.warnings = state.warnings;
    const syncAll = await this.areas.sync.get(null);
    this.syncKeys = new Set(Object.keys(syncAll));
    this.loaded = true;
    if (state.warnings.length) console.info('[command-drawer] storage recovery:', state.warnings);
    this.emit();
    return this.snapshot();
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  snapshot(): LoadedState {
    return {
      meta: { ...this.meta, folderIds: [...this.folders.keys()] },
      folders: [...this.folders.values()],
      localOnly: new Set(this.localOnly),
      warnings: [...this.warnings],
    };
  }

  getMeta(): Meta {
    return this.meta;
  }
  getFolders(): Folder[] {
    return [...this.folders.values()];
  }
  getFolder(id: string): Folder | undefined {
    return this.folders.get(id);
  }
  isLocalOnly(id: string): boolean {
    return this.localOnly.has(id);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  /** Estimated sync item count after pending writes. */
  syncItemCount(): number {
    return this.syncKeys.size;
  }

  /** Item-count guard (plan §3). */
  canCreateFolder(): { ok: true } | { ok: false; reason: string } {
    if (this.syncKeys.size >= ITEM_COUNT_GUARD) {
      return {
        ok: false,
        reason: `Sync storage is nearly full (${this.syncKeys.size} of ${SYNC_MAX_ITEMS} items). Delete or merge folders, or export a backup first.`,
      };
    }
    return { ok: true };
  }

  upsertFolder(folder: Folder): void {
    this.folders.set(folder.id, folder);
    this.deletedFolders.delete(folder.id);
    this.dirtyFolders.add(folder.id);
    this.metaDirty = true;
    this.schedule();
    this.emit();
  }

  /** Replace the whole folder set (used by tree operations and import). */
  replaceFolders(folders: Folder[]): void {
    const nextIds = new Set(folders.map((f) => f.id));
    for (const id of this.folders.keys()) {
      if (!nextIds.has(id)) {
        this.deletedFolders.add(id);
        this.dirtyFolders.delete(id);
      }
    }
    for (const f of folders) {
      const prev = this.folders.get(f.id);
      if (prev !== f) this.dirtyFolders.add(f.id);
      this.deletedFolders.delete(f.id);
    }
    this.folders = new Map(folders.map((f) => [f.id, f]));
    this.metaDirty = true;
    this.schedule();
    this.emit();
  }

  removeFolder(id: string): void {
    if (!this.folders.has(id)) return;
    this.folders.delete(id);
    this.dirtyFolders.delete(id);
    this.deletedFolders.add(id);
    this.localOnly.delete(id);
    this.metaDirty = true;
    this.schedule();
    this.emit();
  }

  updateSettings(patch: Partial<Meta['settings']>): void {
    this.meta = { ...this.meta, settings: { ...this.meta.settings, ...patch } };
    this.metaDirty = true;
    this.schedule();
    this.emit();
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  /** Write everything pending now. Safe to call repeatedly. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.flushing) return this.flushing.then(() => this.flush());
    if (!this.dirtyFolders.size && !this.deletedFolders.size && !this.metaDirty) return Promise.resolve();
    this.flushing = this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush() {
    const dirty = [...this.dirtyFolders];
    const deleted = [...this.deletedFolders];
    this.dirtyFolders.clear();
    this.deletedFolders.clear();
    const metaDirty = this.metaDirty;
    this.metaDirty = false;
    let localOnlyChanged = false;

    for (const id of deleted) {
      await this.removeKeys(this.areas.sync, id);
      await this.removeKeys(this.areas.local, id);
      this.localOnly.delete(id);
    }
    for (const id of dirty) {
      const folder = this.folders.get(id);
      if (!folder) continue;
      const items = chunkFolder(folder);
      const wroteSync = await this.writeFolderTo(this.areas.sync, id, items, true);
      if (wroteSync) {
        if (this.localOnly.has(id)) localOnlyChanged = true;
        this.localOnly.delete(id);
        await this.removeKeys(this.areas.local, id);
        for (const k of Object.keys(items)) this.syncKeys.add(k);
      } else {
        const ok = await this.writeFolderTo(this.areas.local, id, items, false);
        if (!ok) {
          // Give up quietly but keep it in memory and dirty for the next attempt.
          this.dirtyFolders.add(id);
          continue;
        }
        if (!this.localOnly.has(id)) localOnlyChanged = true;
        this.localOnly.add(id);
      }
    }
    if (metaDirty || deleted.length) {
      const meta: Meta = { ...this.meta, folderIds: [...this.folders.keys()] };
      this.meta = meta;
      try {
        await this.areas.sync.set({ [META_KEY]: meta });
        this.syncKeys.add(META_KEY);
        await this.areas.local.remove(META_KEY).catch(() => undefined);
      } catch (err) {
        if (!isQuotaError(err)) console.warn('[command-drawer] meta write failed', err);
        await this.areas.local.set({ [META_KEY]: meta }).catch(() => undefined);
      }
    }
    if (localOnlyChanged) this.emit();
  }

  /** Write a folder's items, removing stale chunk keys. Returns false on quota failure. */
  private async writeFolderTo(area: StorageArea, id: string, items: Record<string, unknown>, isSync: boolean): Promise<boolean> {
    try {
      const existing = await area.get(null);
      const stale = keysForFolder(existing, id).filter((k) => !(k in items));
      await area.set(items);
      if (stale.length) {
        await area.remove(stale);
        if (isSync) for (const k of stale) this.syncKeys.delete(k);
      }
      return true;
    } catch (err) {
      if (isSync && isQuotaError(err)) return false;
      if (isSync) {
        console.warn('[command-drawer] sync write failed, falling back to local', err);
        return false;
      }
      console.error('[command-drawer] local write failed', err);
      return false;
    }
  }

  private async removeKeys(area: StorageArea, id: string) {
    try {
      const all = await area.get(null);
      const keys = keysForFolder(all, id);
      if (keys.length) await area.remove(keys);
      if (area === this.areas.sync) for (const k of keys) this.syncKeys.delete(k);
    } catch (err) {
      console.warn('[command-drawer] remove failed', err);
    }
  }

  async usage(): Promise<Usage> {
    let syncBytes = 0;
    try {
      if (this.areas.sync.getBytesInUse) syncBytes = await this.areas.sync.getBytesInUse(null);
      else {
        const all = await this.areas.sync.get(null);
        syncBytes = Object.entries(all).reduce((n, [k, v]) => n + measureItem(k, v), 0);
      }
    } catch {
      syncBytes = 0;
    }
    const all = await this.areas.sync.get(null);
    const syncItems = Object.keys(all).length;
    this.syncKeys = new Set(Object.keys(all));
    const percent = Math.max((syncBytes / SYNC_QUOTA_BYTES) * 100, (syncItems / SYNC_MAX_ITEMS) * 100);
    return {
      syncBytes,
      syncQuotaBytes: SYNC_QUOTA_BYTES,
      syncItems,
      syncMaxItems: SYNC_MAX_ITEMS,
      localOnlyFolderIds: [...this.localOnly],
      percent: Math.min(100, Math.round(percent)),
    };
  }

  /** Retry pushing local-only folders back into sync (e.g. after the user freed space). */
  async retrySync(): Promise<number> {
    let moved = 0;
    for (const id of [...this.localOnly]) {
      const folder = this.folders.get(id);
      if (!folder) continue;
      const items = chunkFolder(folder);
      if (await this.writeFolderTo(this.areas.sync, id, items, true)) {
        this.localOnly.delete(id);
        await this.removeKeys(this.areas.local, id);
        for (const k of Object.keys(items)) this.syncKeys.add(k);
        moved++;
      }
    }
    if (moved) this.emit();
    return moved;
  }
}

/**
 * In-memory StorageArea with chrome.storage.sync-like quota enforcement.
 * Used by tests; also handy for a demo build without extension APIs.
 */
export class MemoryArea implements StorageArea {
  data = new Map<string, string>(); // stored as JSON text, like chrome does
  writes = 0;
  constructor(
    private quota: { bytes?: number; bytesPerItem?: number; maxItems?: number } = {},
  ) {}
  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    const wanted = keys == null ? [...this.data.keys()] : Array.isArray(keys) ? keys : [keys];
    for (const k of wanted) {
      const v = this.data.get(k);
      if (v !== undefined) out[k] = JSON.parse(v);
    }
    return out;
  }
  async set(items: Record<string, unknown>): Promise<void> {
    const next = new Map(this.data);
    for (const [k, v] of Object.entries(items)) {
      const json = JSON.stringify(v);
      if (this.quota.bytesPerItem && byteLength(k) + byteLength(json) > this.quota.bytesPerItem) {
        throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
      }
      next.set(k, json);
    }
    if (this.quota.maxItems && next.size > this.quota.maxItems) throw new Error('MAX_ITEMS quota exceeded');
    if (this.quota.bytes) {
      let total = 0;
      for (const [k, v] of next) total += byteLength(k) + byteLength(v);
      if (total > this.quota.bytes) throw new Error('QUOTA_BYTES quota exceeded');
    }
    this.writes++;
    this.data = next;
  }
  async remove(keys: string | string[]): Promise<void> {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.data.delete(k);
    this.writes++;
  }
  async getBytesInUse(): Promise<number> {
    let total = 0;
    for (const [k, v] of this.data) total += byteLength(k) + byteLength(v);
    return total;
  }
}

export function syncLikeMemoryArea(): MemoryArea {
  return new MemoryArea({ bytes: SYNC_QUOTA_BYTES, bytesPerItem: SYNC_QUOTA_BYTES_PER_ITEM, maxItems: SYNC_MAX_ITEMS });
}

/** Real chrome.storage areas, when running inside the extension. */
export function chromeAreas(): Areas {
  return { sync: chrome.storage.sync as unknown as StorageArea, local: chrome.storage.local as unknown as StorageArea };
}
