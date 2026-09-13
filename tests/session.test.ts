import { describe, expect, it } from 'vitest';
import { newFolder } from '../src/lib/schema';
import { resolveFolder } from '../src/lib/matcher';
import {
  clearOverride,
  clearTab,
  evictIfNeeded,
  getOverride,
  MemorySession,
  overrideKey,
  setOverride,
} from '../src/lib/session';

const admin = newFolder({ id: 'admin', name: 'Admin', urlPatterns: ['https://admin.site.com/*'] });
const ps = newFolder({ id: 'ps', name: 'PowerShell' });
const folders = [admin, ps];
const ORIGIN = 'https://admin.site.com';

/** What the popup does on open: read override for (tab, origin) then resolve. */
async function openPopup(area: MemorySession, tabId: number, url: string) {
  const origin = new URL(url).origin;
  const ov = await getOverride(area, tabId, origin);
  return resolveFolder(folders, url, ov);
}

describe('override memory', () => {
  it('key shape', () => {
    expect(overrideKey(7, ORIGIN)).toBe('override:7:https://admin.site.com');
  });

  it('manual selection on tab 7 survives popup reopen on another path of the same origin', async () => {
    const s = new MemorySession();
    expect((await openPopup(s, 7, 'https://admin.site.com/')).folderId).toBe('admin');
    await setOverride(s, 7, ORIGIN, 'ps');
    expect(await openPopup(s, 7, 'https://admin.site.com/other')).toEqual({ kind: 'override', folderId: 'ps' });
  });

  it('navigating to github.com does not apply it; navigating back restores it', async () => {
    const s = new MemorySession();
    await setOverride(s, 7, ORIGIN, 'ps');
    expect((await openPopup(s, 7, 'https://github.com/x')).kind).toBe('none');
    expect((await openPopup(s, 7, 'https://admin.site.com/feature')).folderId).toBe('ps');
  });

  it('a second tab on the same site auto-matches normally', async () => {
    const s = new MemorySession();
    await setOverride(s, 7, ORIGIN, 'ps');
    expect(await openPopup(s, 8, 'https://admin.site.com/')).toMatchObject({ kind: 'match', folderId: 'admin' });
  });

  it('Auto clears the override and auto-match runs again', async () => {
    const s = new MemorySession();
    await setOverride(s, 7, ORIGIN, 'ps');
    await clearOverride(s, 7, ORIGIN);
    expect(await openPopup(s, 7, 'https://admin.site.com/')).toMatchObject({ kind: 'match', folderId: 'admin' });
  });

  it('closing tab 7 clears it; a new tab on the site auto-matches', async () => {
    const s = new MemorySession();
    await setOverride(s, 7, ORIGIN, 'ps');
    await setOverride(s, 7, 'https://other.example', 'ps');
    await setOverride(s, 9, ORIGIN, 'ps');
    expect(await clearTab(s, 7)).toBe(2);
    expect(await getOverride(s, 7, ORIGIN)).toBeNull();
    expect(await getOverride(s, 9, ORIGIN)).toBe('ps');
    expect(await openPopup(s, 10, 'https://admin.site.com/')).toMatchObject({ kind: 'match', folderId: 'admin' });
  });

  it('evicts least-recently-used entries past the cap', async () => {
    const s = new MemorySession();
    for (let i = 0; i < 205; i++) {
      await s.set({ [overrideKey(i, ORIGIN)]: { folderId: 'ps', at: i } });
    }
    expect(await evictIfNeeded(s)).toBe(5);
    expect(await getOverride(s, 0, ORIGIN)).toBeNull();
    expect(await getOverride(s, 204, ORIGIN)).toBe('ps');
    // setOverride evicts automatically
    await setOverride(s, 999, ORIGIN, 'ps');
    expect([...s.data.keys()].filter((k) => k.startsWith('override:')).length).toBe(200);
  });
});
