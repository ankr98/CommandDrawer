/**
 * Folder hierarchy over a flat `Folder[]` with `parentId`. Pure functions.
 * Depth is enforced HERE — the options page, import and drag-and-drop
 * are three separate paths into the same invariant.
 */
import { MAX_DEPTH, type Folder, type FolderSort, type Snippet } from './schema';

export type MoveResult = { ok: true } | { ok: false; reason: string };

const byOrder = (a: Folder, b: Folder) => a.order - b.order || a.name.localeCompare(b.name);
const byName = (a: Folder, b: Folder) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.order - b.order;

/**
 * Display order for siblings. 'manual' is the stored `order` (drag-and-drop);
 * 'alpha' ignores it and sorts by name, case-insensitively, numbers in natural
 * order. Structural code (move, renumber, delete) always works on `order`.
 */
export function sortSiblings(folders: readonly Folder[], sort: FolderSort = 'manual'): Folder[] {
  return [...folders].sort(sort === 'alpha' ? byName : byOrder);
}

export function byId(folders: readonly Folder[]): Map<string, Folder> {
  return new Map(folders.map((f) => [f.id, f]));
}

export function childrenOf(folders: readonly Folder[], parentId: string | null, sort: FolderSort = 'manual'): Folder[] {
  return sortSiblings(folders.filter((f) => f.parentId === parentId), sort);
}

export function rootFolders(folders: readonly Folder[], sort: FolderSort = 'manual'): Folder[] {
  return childrenOf(folders, null, sort);
}

/** Root folders have depth 1. Returns 0 for an unknown id. Cycles are capped. */
export function depthOf(folders: readonly Folder[], id: string): number {
  const map = byId(folders);
  let depth = 0;
  let cur = map.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    depth++;
    cur = cur.parentId === null ? undefined : map.get(cur.parentId);
    if (depth > folders.length + 1) break;
  }
  return depth;
}

/** Path from the root ancestor down to (and including) `id`. */
export function pathOf(folders: readonly Folder[], id: string): Folder[] {
  const map = byId(folders);
  const path: Folder[] = [];
  const seen = new Set<string>();
  let cur = map.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId === null ? undefined : map.get(cur.parentId);
  }
  return path;
}

export function pathLabel(folders: readonly Folder[], id: string, sep = ' / '): string {
  return pathOf(folders, id)
    .map((f) => f.name)
    .join(sep);
}

export function descendants(folders: readonly Folder[], id: string, sort: FolderSort = 'manual'): Folder[] {
  const out: Folder[] = [];
  const queue = [id];
  const seen = new Set<string>();
  while (queue.length) {
    const cur = queue.shift()!;
    for (const child of childrenOf(folders, cur, sort)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      queue.push(child.id);
    }
  }
  return out;
}

/** Height of the subtree rooted at `id` (a leaf has height 1). */
export function subtreeHeight(folders: readonly Folder[], id: string): number {
  const kids = childrenOf(folders, id);
  if (kids.length === 0) return 1;
  return 1 + Math.max(...kids.map((k) => subtreeHeight(folders, k.id)));
}

/** Can a NEW folder be created under `parentId`? */
export function canCreateUnder(folders: readonly Folder[], parentId: string | null): MoveResult {
  if (parentId === null) return { ok: true };
  const parent = byId(folders).get(parentId);
  if (!parent) return { ok: false, reason: 'Parent folder does not exist.' };
  const parentDepth = depthOf(folders, parentId);
  if (parentDepth + 1 > MAX_DEPTH) {
    return { ok: false, reason: `Folders can only nest ${MAX_DEPTH - 1} level deep. "${parent.name}" is already a child folder.` };
  }
  return { ok: true };
}

/** Can `id` be moved under `newParentId` without breaking depth or creating a cycle? */
export function canMove(folders: readonly Folder[], id: string, newParentId: string | null): MoveResult {
  const map = byId(folders);
  const folder = map.get(id);
  if (!folder) return { ok: false, reason: 'Folder does not exist.' };
  if (newParentId === id) return { ok: false, reason: 'A folder cannot be moved into itself.' };
  if (newParentId === null) return { ok: true };
  const target = map.get(newParentId);
  if (!target) return { ok: false, reason: 'Target folder does not exist.' };
  if (descendants(folders, id).some((d) => d.id === newParentId)) {
    return { ok: false, reason: 'A folder cannot be moved into one of its own children.' };
  }
  const targetDepth = depthOf(folders, newParentId);
  const height = subtreeHeight(folders, id);
  if (targetDepth + height > MAX_DEPTH) {
    if (height > 1) {
      return {
        ok: false,
        reason: `"${folder.name}" has child folders, so it can only sit at the top level. Move its children out first.`,
      };
    }
    return { ok: false, reason: `Folders can only nest ${MAX_DEPTH - 1} level deep. "${target.name}" is already a child folder.` };
  }
  return { ok: true };
}

function renumber(folders: Folder[], parentId: string | null): Folder[] {
  const siblings = childrenOf(folders, parentId);
  const orders = new Map(siblings.map((s, i) => [s.id, i]));
  return folders.map((f) => (orders.has(f.id) && f.order !== orders.get(f.id) ? { ...f, order: orders.get(f.id)! } : f));
}

/**
 * Move `id` under `newParentId`, optionally at a sibling index. Returns a new
 * array (untouched folders keep identity). Throws if `canMove` fails — callers
 * should check first and show the reason.
 */
export function moveFolder(folders: readonly Folder[], id: string, newParentId: string | null, index?: number): Folder[] {
  const check = canMove(folders, id, newParentId);
  if (!check.ok) throw new Error(check.reason);
  const folder = byId(folders).get(id)!;
  const oldParent = folder.parentId;
  let next: Folder[] = folders.map((f) => (f.id === id ? { ...f, parentId: newParentId, order: Number.MAX_SAFE_INTEGER } : f));
  const siblings = childrenOf(next, newParentId).filter((s) => s.id !== id);
  const at = index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length));
  siblings.splice(at, 0, { ...folder, parentId: newParentId });
  const orders = new Map(siblings.map((s, i) => [s.id, i]));
  next = next.map((f) => (orders.has(f.id) ? { ...f, order: orders.get(f.id)! } : f));
  if (oldParent !== newParentId) next = renumber(next, oldParent);
  return next;
}

/** Reorder among current siblings. */
export function reorderFolder(folders: readonly Folder[], id: string, newIndex: number): Folder[] {
  const folder = byId(folders).get(id);
  if (!folder) return [...folders];
  return moveFolder(folders, id, folder.parentId, newIndex);
}

/** Delete `id` and all descendants. */
export function deleteCascade(folders: readonly Folder[], id: string): { folders: Folder[]; removedIds: string[] } {
  const removed = new Set([id, ...descendants(folders, id).map((d) => d.id)]);
  const target = byId(folders).get(id);
  const remaining = folders.filter((f) => !removed.has(f.id));
  return { folders: target ? renumber(remaining, target.parentId) : remaining, removedIds: [...removed] };
}

/** Delete `id` only; its children become root folders (appended after existing roots). */
export function deleteAndPromoteChildren(folders: readonly Folder[], id: string): { folders: Folder[]; removedIds: string[] } {
  const target = byId(folders).get(id);
  if (!target) return { folders: [...folders], removedIds: [] };
  const roots = rootFolders(folders).filter((r) => r.id !== id);
  let nextOrder = roots.length ? Math.max(...roots.map((r) => r.order)) + 1 : 0;
  const kids = childrenOf(folders, id);
  const promoted = new Map(kids.map((k) => [k.id, nextOrder++]));
  const next = folders
    .filter((f) => f.id !== id)
    .map((f) => (promoted.has(f.id) ? { ...f, parentId: null, order: promoted.get(f.id)! } : f));
  return { folders: renumber(next, target.parentId), removedIds: [id] };
}

/**
 * Repair invariants on read: orphaned parentIds → root, self-parenting → root,
 * depth violations → root, duplicate ids → keep first. Never throws.
 */
export function recoverOrphans(folders: readonly Folder[]): { folders: Folder[]; fixes: string[] } {
  const fixes: string[] = [];
  const seen = new Set<string>();
  let out: Folder[] = [];
  for (const f of folders) {
    if (seen.has(f.id)) {
      fixes.push(`Dropped duplicate folder id ${f.id}`);
      continue;
    }
    seen.add(f.id);
    out.push(f);
  }
  const ids = new Set(out.map((f) => f.id));
  out = out.map((f) => {
    if (f.parentId !== null && (!ids.has(f.parentId) || f.parentId === f.id)) {
      fixes.push(`Folder "${f.name}" had a missing parent; moved to root`);
      return { ...f, parentId: null };
    }
    return f;
  });
  // Break cycles and depth violations: any folder whose depth is 0 (cycle) or > MAX_DEPTH goes to root.
  let changed = true;
  let guard = 0;
  while (changed && guard++ < out.length + 2) {
    changed = false;
    for (const f of out) {
      if (f.parentId === null) continue;
      const d = depthOf(out, f.id);
      const path = pathOf(out, f.id);
      const cyclic = path.length === 0 || path[0]!.parentId !== null;
      if (cyclic || d > MAX_DEPTH) {
        fixes.push(`Folder "${f.name}" exceeded the nesting limit; moved to root`);
        out = out.map((x) => (x.id === f.id ? { ...x, parentId: null } : x));
        changed = true;
        break;
      }
    }
  }
  return { folders: out, fixes };
}

export type RolledUpGroup = { folder: Folder; path: string; snippets: Snippet[] };

/** Snippets of `id` plus its descendants, grouped by folder with the folder path. */
export function rollUp(folders: readonly Folder[], id: string, sort: FolderSort = 'manual'): RolledUpGroup[] {
  const self = byId(folders).get(id);
  if (!self) return [];
  const groups: RolledUpGroup[] = [{ folder: self, path: self.name, snippets: self.snippets }];
  for (const d of descendants(folders, id, sort)) {
    groups.push({ folder: d, path: pathLabel(folders, d.id), snippets: d.snippets });
  }
  return groups;
}

/** Next `order` for a new folder under `parentId`. */
export function nextOrder(folders: readonly Folder[], parentId: string | null): number {
  const kids = childrenOf(folders, parentId);
  return kids.length ? Math.max(...kids.map((k) => k.order)) + 1 : 0;
}
