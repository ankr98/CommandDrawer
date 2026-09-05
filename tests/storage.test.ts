import { describe, expect, it } from 'vitest';
import { newFolder, newSnippet, MAX_SNIPPET_CHARS } from '../src/lib/schema';
import {
  chunkFolder,
  folderKey,
  ITEM_BUDGET_BYTES,
  loadAll,
  measureItem,
  MemoryArea,
  readFolder,
  SnippetStore,
  SYNC_MAX_ITEMS,
  syncLikeMemoryArea,
} from '../src/lib/storage';

const bigFolder = (id: string, n = 20) =>
  newFolder({
    id,
    name: 'Big',
    snippets: Array.from({ length: n }, (_, i) =>
      newSnippet({ id: `s${i}`, label: `Snippet "${i}"`, value: 'Get-MgUser -Filter "startsWith(displayName,\'x\')" '.repeat(20).slice(0, MAX_SNIPPET_CHARS) }),
    ),
  });

describe('chunking', () => {
  it('stores small folders as a single object item', () => {
    const f = newFolder({ id: 'a', name: 'A' });
    const items = chunkFolder(f);
    expect(Object.keys(items)).toEqual([folderKey('a')]);
    expect(items[folderKey('a')]).toEqual(f);
  });
  it('splits large folders and each chunk is under budget', () => {
    const f = bigFolder('big');
    const items = chunkFolder(f);
    const keys = Object.keys(items);
    expect(keys.length).toBeGreaterThan(2);
    for (const [k, v] of Object.entries(items)) expect(measureItem(k, v)).toBeLessThanOrEqual(ITEM_BUDGET_BYTES);
    const back = readFolder(items, 'big');
    expect(back && 'folder' in back && back.folder).toEqual(f);
  });
  it('reports a missing chunk instead of throwing', () => {
    const items = chunkFolder(bigFolder('big'));
    delete items['folder:big:1'];
    const res = readFolder(items, 'big');
    expect(res && 'error' in res && res.error).toMatch(/missing chunk 1/);
  });
  it('tolerates a corrupt item', () => {
    expect(readFolder({ 'folder:x': 42 }, 'x')).toEqual({ error: expect.stringMatching(/parsed/) });
    expect(readFolder({}, 'x')).toBeNull();
  });
});

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('SnippetStore', () => {
  it('round-trips folders and meta through storage', async () => {
    const sync = syncLikeMemoryArea();
    const local = new MemoryArea();
    const store = new SnippetStore({ sync, local }, 1);
    await store.load();
    store.upsertFolder(newFolder({ id: 'a', name: 'A', urlPatterns: ['https://portal.azure.com/*'] }));
    store.upsertFolder(bigFolder('big'));
    store.updateSettings({ sortMode: 'recent' });
    await store.flush();

    const store2 = new SnippetStore({ sync, local }, 1);
    const state = await store2.load();
    expect(state.folders.map((f) => f.id).sort()).toEqual(['a', 'big']);
    expect(state.meta.settings.sortMode).toBe('recent');
    expect(state.meta.folderIds.sort()).toEqual(['a', 'big']);
    expect(state.localOnly.size).toBe(0);
  });

  it('coalesces rapid edits into one write', async () => {
    const sync = syncLikeMemoryArea();
    const store = new SnippetStore({ sync, local: new MemoryArea() }, 20);
    await store.load();
    const writesBefore = sync.writes;
    for (let i = 0; i < 25; i++) store.upsertFolder(newFolder({ id: 'a', name: 'A'.repeat(i + 1) }));
    await tick(60);
    // one folder set + one meta set
    expect(sync.writes - writesBefore).toBeLessThanOrEqual(2);
    expect((await sync.get('folder:a'))['folder:a']).toMatchObject({ name: 'A'.repeat(25) });
  });

  it('removes stale chunks when a folder shrinks', async () => {
    const sync = syncLikeMemoryArea();
    const store = new SnippetStore({ sync, local: new MemoryArea() }, 1);
    await store.load();
    store.upsertFolder(bigFolder('big'));
    await store.flush();
    expect(Object.keys(await sync.get(null)).filter((k) => k.startsWith('folder:big:')).length).toBeGreaterThan(0);
    store.upsertFolder(newFolder({ id: 'big', name: 'Small now' }));
    await store.flush();
    const keys = Object.keys(await sync.get(null)).filter((k) => k.startsWith('folder:big'));
    expect(keys).toEqual(['folder:big']);
  });

  it('falls back to local when sync quota is exceeded and marks the folder local-only', async () => {
    const sync = new MemoryArea({ bytes: 3000, bytesPerItem: 8192, maxItems: 512 });
    const local = new MemoryArea();
    const store = new SnippetStore({ sync, local }, 1);
    await store.load();
    store.upsertFolder(newFolder({ id: 'small', name: 'Small' }));
    store.upsertFolder(bigFolder('big'));
    await store.flush();
    expect(store.isLocalOnly('small')).toBe(false);
    expect(store.isLocalOnly('big')).toBe(true);
    expect(Object.keys(await local.get(null)).some((k) => k.startsWith('folder:big'))).toBe(true);

    // Data survives a reload and is still marked local-only.
    const store2 = new SnippetStore({ sync, local }, 1);
    const state = await store2.load();
    expect(state.folders.map((f) => f.id).sort()).toEqual(['big', 'small']);
    expect(state.localOnly.has('big')).toBe(true);

    // Freeing quota lets retrySync move it back.
    (sync as unknown as { quota: { bytes: number } }).quota.bytes = 200_000;
    const moved = await store2.retrySync();
    expect(moved).toBe(1);
    expect(store2.isLocalOnly('big')).toBe(false);
    expect(Object.keys(await local.get(null)).some((k) => k.startsWith('folder:big'))).toBe(false);
  });

  it('deletes remove all chunks from both areas', async () => {
    const sync = syncLikeMemoryArea();
    const local = new MemoryArea();
    const store = new SnippetStore({ sync, local }, 1);
    await store.load();
    store.upsertFolder(bigFolder('big'));
    await store.flush();
    store.removeFolder('big');
    await store.flush();
    expect(Object.keys(await sync.get(null)).filter((k) => k.startsWith('folder:'))).toEqual([]);
    expect(store.getMeta().folderIds).toEqual([]);
  });

  it('guards the item count near MAX_ITEMS', async () => {
    const sync = new MemoryArea();
    const store = new SnippetStore({ sync, local: new MemoryArea() }, 1);
    await store.load();
    expect(store.canCreateFolder().ok).toBe(true);
    const items: Record<string, unknown> = {};
    for (let i = 0; i < Math.floor(SYNC_MAX_ITEMS * 0.9); i++) items[`folder:f${i}`] = newFolder({ id: `f${i}`, name: 'x' });
    await sync.set(items);
    await store.load();
    expect(store.canCreateFolder().ok).toBe(false);
  });
});

describe('loadAll recovery', () => {
  it('recovers orphans, missing meta and missing data without throwing', async () => {
    const sync = new MemoryArea();
    await sync.set({
      'folder:a': newFolder({ id: 'a', name: 'A', parentId: 'ghost' }),
      'folder:b': { id: 'b', name: 'B', snippets: [{ bad: true }, newSnippet({ id: 's', value: 'ok' })] },
      meta: { schemaVersion: 1, folderIds: ['a', 'b', 'missing'], settings: { sortMode: 'bogus' } },
    });
    const state = await loadAll({ sync, local: new MemoryArea() });
    expect(state.folders.map((f) => f.id).sort()).toEqual(['a', 'b']);
    expect(state.folders.find((f) => f.id === 'a')!.parentId).toBeNull();
    expect(state.folders.find((f) => f.id === 'b')!.snippets).toHaveLength(1);
    expect(state.meta.settings.sortMode).toBe('manual');
    expect(state.warnings.length).toBeGreaterThan(0);
  });
  it('prefers the local copy when a folder exists in both areas', async () => {
    const sync = new MemoryArea();
    const local = new MemoryArea();
    await sync.set({ 'folder:a': newFolder({ id: 'a', name: 'Old' }) });
    await local.set({ 'folder:a': newFolder({ id: 'a', name: 'New' }) });
    const state = await loadAll({ sync, local });
    expect(state.folders[0]!.name).toBe('New');
    expect(state.localOnly.has('a')).toBe(true);
  });
});
