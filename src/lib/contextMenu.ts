/**
 * The page right-click menu: "Command Drawer ▸ …". Pure model builder; the
 * service worker turns the returned list into chrome.contextMenus items.
 *
 * Chrome cannot ask us what to show at right-click time, so page awareness
 * comes from `documentUrlPatterns` — the same match-pattern syntax as folder
 * URL patterns. That keeps the extension free of the `tabs` permission.
 *
 *   off      → no items at all
 *   all      → Command Drawer ▸ <tree from the top>
 *   matched  → Command Drawer ▸ <folders whose patterns match the page>
 *                              ────────
 *                              All folders ▸ <tree from the top>
 *              (with no patterned folder anywhere it renders like `all`)
 *
 * Snippets show their label only. A snippet created before labels became
 * mandatory shows a trimmed value instead, so nothing silently disappears.
 */
import type { Folder, FolderSort, Settings, Snippet } from './schema';
import { childrenOf, rootFolders } from './tree';
import { isValidPattern } from './matcher';
import { sortSnippets } from './search';

export const MENU_ROOT_ID = 'cd:root';
export const MENU_ALL_ID = 'cd:all';
export const MENU_SEPARATOR_ID = 'cd:sep';
export const MENU_ROOT_TITLE = 'Command Drawer';
export const MENU_ALL_TITLE = 'All folders';

/** Where the menu appears at all. Pages the extension can copy on. */
export const MENU_PAGE_PATTERNS = ['http://*/*', 'https://*/*', 'file:///*'];

/** Contexts on a page; deliberately not 'action' (the toolbar icon menu). */
export const MENU_CONTEXTS = ['page', 'frame', 'selection', 'link', 'editable', 'image', 'video', 'audio'] as const;

/** Trimmed-value fallback length for snippets without a label. */
export const MENU_VALUE_FALLBACK_CHARS = 40;

export interface MenuItem {
  id: string;
  parentId?: string;
  title?: string;
  type?: 'normal' | 'separator';
  enabled?: boolean;
  documentUrlPatterns?: string[];
  /** Present on snippet items so a click can be resolved. */
  snippet?: { folderId: string; snippetId: string };
}

/**
 * Id namespace. The tree under "All folders" uses 'a'. Each matched entry uses
 * 'm:<folderId>' so a child that is matched on its own AND sits inside a
 * matched parent gets two distinct ids.
 */
type Section = string;

/** Windows treats `&` as a mnemonic marker in menu titles. */
export function escapeMenuTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().replace(/&/g, '&&');
}

/** What a snippet is called in the menu: its label, else a trimmed value. */
export function snippetMenuTitle(snippet: Snippet): string {
  if (snippet.label?.trim()) return escapeMenuTitle(snippet.label);
  const flat = snippet.value.replace(/\s+/g, ' ').trim();
  return escapeMenuTitle(flat.length > MENU_VALUE_FALLBACK_CHARS ? flat.slice(0, MENU_VALUE_FALLBACK_CHARS - 1) + '…' : flat);
}

export function validPatterns(folder: Folder): string[] {
  return [...new Set(folder.urlPatterns.map((p) => p.trim()).filter((p) => p && isValidPattern(p)))];
}

/** Roots in order, each followed by its children in order. */
function treeOrder(folders: readonly Folder[], sort: FolderSort): Folder[] {
  const out: Folder[] = [];
  const walk = (parentId: string | null) => {
    for (const f of childrenOf(folders, parentId, sort)) {
      out.push(f);
      walk(f.id);
    }
  };
  walk(null);
  return out;
}

type Sorts = Pick<Settings, 'sortMode' | 'folderSort'>;

function folderItems(folders: readonly Folder[], folder: Folder, section: Section, parentId: string, sorts: Sorts, patterns?: string[]): MenuItem[] {
  const id = `cd:${section}:f:${folder.id}`;
  const out: MenuItem[] = [{ id, parentId, title: escapeMenuTitle(folder.name), ...(patterns ? { documentUrlPatterns: patterns } : {}) }];
  const kids = childrenOf(folders, folder.id, sorts.folderSort);
  for (const kid of kids) out.push(...folderItems(folders, kid, section, id, sorts));
  const snippets = sortSnippets(folder.snippets, sorts.sortMode);
  for (const s of snippets) {
    out.push({ id: `cd:${section}:s:${folder.id}:${s.id}`, parentId: id, title: snippetMenuTitle(s), snippet: { folderId: folder.id, snippetId: s.id } });
  }
  if (!kids.length && !snippets.length) out.push({ id: `${id}:empty`, parentId: id, title: 'Empty folder', enabled: false });
  return out;
}

function tree(folders: readonly Folder[], parentId: string, sorts: Sorts): MenuItem[] {
  const out: MenuItem[] = [];
  for (const root of rootFolders(folders, sorts.folderSort)) out.push(...folderItems(folders, root, 'a', parentId, sorts));
  return out;
}

export function buildMenu(folders: readonly Folder[], settings: Pick<Settings, 'contextMenu' | 'sortMode' | 'folderSort'>): MenuItem[] {
  if (settings.contextMenu === 'off') return [];
  const root: MenuItem = { id: MENU_ROOT_ID, title: MENU_ROOT_TITLE, documentUrlPatterns: MENU_PAGE_PATTERNS };
  if (!folders.length) {
    return [root, { id: `${MENU_ROOT_ID}:empty`, parentId: MENU_ROOT_ID, title: 'No folders yet', enabled: false }];
  }
  const matched = settings.contextMenu === 'matched' ? treeOrder(folders, settings.folderSort).filter((f) => validPatterns(f).length) : [];
  if (!matched.length) return [root, ...tree(folders, MENU_ROOT_ID, settings)];

  const out: MenuItem[] = [root];
  const union = new Set<string>();
  for (const f of matched) {
    const patterns = validPatterns(f);
    for (const p of patterns) union.add(p);
    out.push(...folderItems(folders, f, `m:${f.id}`, MENU_ROOT_ID, settings, patterns));
  }
  out.push({ id: MENU_SEPARATOR_ID, parentId: MENU_ROOT_ID, type: 'separator', documentUrlPatterns: [...union] });
  out.push({ id: MENU_ALL_ID, parentId: MENU_ROOT_ID, title: MENU_ALL_TITLE });
  out.push(...tree(folders, MENU_ALL_ID, settings));
  return out;
}

export interface MenuHit {
  folder: Folder;
  snippet: Snippet;
}

/** The snippet behind a clicked menu id, or null for structural items and stale ids. */
export function resolveMenuClick(items: readonly MenuItem[], folders: readonly Folder[], menuItemId: string): MenuHit | null {
  const item = items.find((it) => it.id === menuItemId);
  if (!item?.snippet) return null;
  const folder = folders.find((f) => f.id === item.snippet!.folderId);
  const snippet = folder?.snippets.find((s) => s.id === item.snippet!.snippetId);
  return folder && snippet ? { folder, snippet } : null;
}
