import { describe, expect, it } from 'vitest';
import { newFolder, newSnippet, type Folder } from '../src/lib/schema';
import {
  buildMenu,
  escapeMenuTitle,
  MENU_ALL_ID,
  MENU_PAGE_PATTERNS,
  MENU_ROOT_ID,
  MENU_SEPARATOR_ID,
  resolveMenuClick,
  snippetMenuTitle,
  validPatterns,
  type MenuItem,
} from '../src/lib/contextMenu';

const ps = newFolder({
  id: 'ps',
  name: 'PowerShell',
  order: 0,
  urlPatterns: ['https://*.microsoft.com/*'],
  snippets: [
    newSnippet({ id: 's1', label: 'Connect to Graph', value: 'Connect-MgGraph', order: 1, usedCount: 1 }),
    newSnippet({ id: 's2', label: 'Guest users', value: 'Get-MgUser -Filter guest', order: 0, usedCount: 5 }),
  ],
});
const exo = newFolder({
  id: 'exo',
  name: 'Exchange & Teams',
  parentId: 'ps',
  order: 0,
  urlPatterns: ['https://admin.exchange.microsoft.com/*', 'not a pattern'],
  snippets: [newSnippet({ id: 's3', label: 'Connect EXO', value: 'Connect-ExchangeOnline', order: 0 })],
});
const azure = newFolder({
  id: 'azure',
  name: 'Azure portal',
  order: 1,
  snippets: [newSnippet({ id: 's4', value: '72f988bf-86f1-41af-91ab-2d7cd011db47  and then some more text that runs long', order: 0 })],
});
const empty = newFolder({ id: 'empty', name: 'Empty', order: 2 });
const folders: Folder[] = [ps, exo, azure, empty];

const kids = (items: MenuItem[], parentId: string | undefined) => items.filter((i) => i.parentId === parentId);
const titles = (items: MenuItem[], parentId: string | undefined) => kids(items, parentId).map((i) => i.title ?? `<${i.type}>`);

describe('menu titles', () => {
  it('uses the label, escaping & for Windows mnemonics', () => {
    expect(snippetMenuTitle(ps.snippets[0]!)).toBe('Connect to Graph');
    expect(escapeMenuTitle('Exchange & Teams')).toBe('Exchange && Teams');
  });
  it('falls back to a trimmed value for legacy snippets without a label', () => {
    const t = snippetMenuTitle(azure.snippets[0]!);
    expect(t.length).toBeLessThanOrEqual(40);
    expect(t.endsWith('…')).toBe(true);
    expect(t.startsWith('72f988bf')).toBe(true);
  });
  it('collapses whitespace in the fallback', () => {
    expect(snippetMenuTitle(newSnippet({ value: 'a\n  b\tc' }))).toBe('a b c');
  });
});

describe('mode: off', () => {
  it('produces no items', () => {
    expect(buildMenu(folders, { contextMenu: 'off', sortMode: 'manual', folderSort: 'manual' })).toEqual([]);
  });
});

describe('mode: all', () => {
  const items = buildMenu(folders, { contextMenu: 'all', sortMode: 'manual', folderSort: 'manual' });

  it('has one root, shown only on http/https/file pages', () => {
    const root = items.find((i) => i.id === MENU_ROOT_ID)!;
    expect(root.parentId).toBeUndefined();
    expect(root.title).toBe('Command Drawer');
    expect(root.documentUrlPatterns).toEqual(MENU_PAGE_PATTERNS);
    expect(items.filter((i) => !i.parentId)).toHaveLength(1);
  });

  it('lists root folders in order directly under the root, with sub-folders before snippets', () => {
    expect(titles(items, MENU_ROOT_ID)).toEqual(['PowerShell', 'Azure portal', 'Empty']);
    expect(titles(items, 'cd:a:f:ps')).toEqual(['Exchange && Teams', 'Guest users', 'Connect to Graph']);
    expect(titles(items, 'cd:a:f:exo')).toEqual(['Connect EXO']);
  });

  it('never restricts folders by URL and never adds a separator or "All folders"', () => {
    expect(items.some((i) => i.id === MENU_ALL_ID || i.id === MENU_SEPARATOR_ID)).toBe(false);
    expect(items.filter((i) => i.documentUrlPatterns && i.id !== MENU_ROOT_ID)).toEqual([]);
  });

  it('gives an empty folder a disabled placeholder so the submenu still opens', () => {
    const [ph] = kids(items, 'cd:a:f:empty');
    expect(ph).toMatchObject({ title: 'Empty folder', enabled: false });
  });

  it('honours the default sort order', () => {
    const byUse = buildMenu(folders, { contextMenu: 'all', sortMode: 'mostUsed', folderSort: 'manual' });
    expect(titles(byUse, 'cd:a:f:ps')).toEqual(['Exchange && Teams', 'Guest users', 'Connect to Graph']);
    const manual = buildMenu(folders, { contextMenu: 'all', sortMode: 'manual', folderSort: 'manual' });
    expect(titles(manual, 'cd:a:f:ps').slice(1)).toEqual(['Guest users', 'Connect to Graph']);
  });

  it('uses unique ids', () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('lists folders A-Z when folderSort is alpha', () => {
    const alpha = buildMenu(folders, { contextMenu: 'all', sortMode: 'manual', folderSort: 'alpha' });
    expect(titles(alpha, MENU_ROOT_ID)).toEqual(['Azure portal', 'Empty', 'PowerShell']);
  });

  it('shows a disabled hint when there are no folders', () => {
    const none = buildMenu([], { contextMenu: 'all', sortMode: 'manual', folderSort: 'manual' });
    expect(none).toHaveLength(2);
    expect(none[1]).toMatchObject({ parentId: MENU_ROOT_ID, title: 'No folders yet', enabled: false });
  });
});

describe('mode: matched (default)', () => {
  const items = buildMenu(folders, { contextMenu: 'matched', sortMode: 'manual', folderSort: 'manual' });

  it('puts every folder with a valid pattern first, restricted to its own patterns', () => {
    expect(titles(items, MENU_ROOT_ID)).toEqual(['PowerShell', 'Exchange && Teams', '<separator>', 'All folders']);
    expect(items.find((i) => i.id === 'cd:m:ps:f:ps')!.documentUrlPatterns).toEqual(['https://*.microsoft.com/*']);
    expect(items.find((i) => i.id === 'cd:m:exo:f:exo')!.documentUrlPatterns).toEqual(['https://admin.exchange.microsoft.com/*']);
  });

  it('drops invalid patterns rather than the folder', () => {
    expect(validPatterns(exo)).toEqual(['https://admin.exchange.microsoft.com/*']);
  });

  it('a matched folder shows the same contents the drawer would open on', () => {
    expect(titles(items, 'cd:m:ps:f:ps')).toEqual(['Exchange && Teams', 'Guest users', 'Connect to Graph']);
    expect(titles(items, 'cd:m:exo:f:exo')).toEqual(['Connect EXO']);
    // the same child nested inside its matched parent is a separate item
    expect(titles(items, 'cd:m:ps:f:exo')).toEqual(['Connect EXO']);
    expect(resolveMenuClick(items, folders, 'cd:m:ps:s:exo:s3')?.snippet.id).toBe('s3');
  });

  it('hides the separator with the matched folders: it carries the union of their patterns', () => {
    const sep = items.find((i) => i.id === MENU_SEPARATOR_ID)!;
    expect(sep.type).toBe('separator');
    expect(sep.documentUrlPatterns).toEqual(['https://*.microsoft.com/*', 'https://admin.exchange.microsoft.com/*']);
  });

  it('keeps the whole tree under "All folders", unrestricted', () => {
    expect(titles(items, MENU_ALL_ID)).toEqual(['PowerShell', 'Azure portal', 'Empty']);
    const all = items.find((i) => i.id === MENU_ALL_ID)!;
    expect(all.documentUrlPatterns).toBeUndefined();
  });

  it('uses unique ids even though folders appear twice', () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('renders like "all" when no folder has a pattern', () => {
    const plain = folders.map((f) => ({ ...f, urlPatterns: [] }));
    expect(buildMenu(plain, { contextMenu: 'matched', sortMode: 'manual', folderSort: 'manual' })).toEqual(buildMenu(plain, { contextMenu: 'all', sortMode: 'manual', folderSort: 'manual' }));
  });
});

describe('resolveMenuClick', () => {
  const items = buildMenu(folders, { contextMenu: 'matched', sortMode: 'manual', folderSort: 'manual' });
  it('finds the snippet from either section', () => {
    expect(resolveMenuClick(items, folders, 'cd:m:ps:s:ps:s1')?.snippet.id).toBe('s1');
    expect(resolveMenuClick(items, folders, 'cd:a:s:exo:s3')).toMatchObject({ folder: { id: 'exo' }, snippet: { id: 's3' } });
  });
  it('returns null for structural items and stale ids', () => {
    expect(resolveMenuClick(items, folders, MENU_ROOT_ID)).toBeNull();
    expect(resolveMenuClick(items, folders, 'cd:m:ps:f:ps')).toBeNull();
    expect(resolveMenuClick(items, folders, 'cd:a:s:ps:gone')).toBeNull();
    expect(resolveMenuClick(items, folders.filter((f) => f.id !== 'ps'), 'cd:m:ps:s:ps:s1')).toBeNull();
  });
});
