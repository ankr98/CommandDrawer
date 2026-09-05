import { describe, expect, it } from 'vitest';
import { newFolder, MAX_DEPTH } from '../src/lib/schema';
import {
  canCreateUnder,
  canMove,
  childrenOf,
  deleteAndPromoteChildren,
  deleteCascade,
  depthOf,
  moveFolder,
  pathLabel,
  recoverOrphans,
  reorderFolder,
  rollUp,
} from '../src/lib/tree';

const ps = newFolder({ id: 'ps', name: 'PowerShell', order: 0 });
const graph = newFolder({ id: 'graph', name: 'Graph API', parentId: 'ps', order: 0 });
const exo = newFolder({ id: 'exo', name: 'Exchange Online', parentId: 'ps', order: 1 });
const kql = newFolder({ id: 'kql', name: 'KQL', order: 1 });
const tree = [ps, graph, exo, kql];

describe('tree depth', () => {
  it('MAX_DEPTH is 2', () => expect(MAX_DEPTH).toBe(2));
  it('computes depth', () => {
    expect(depthOf(tree, 'ps')).toBe(1);
    expect(depthOf(tree, 'graph')).toBe(2);
    expect(depthOf(tree, 'nope')).toBe(0);
  });
  it('rejects creating under a child', () => {
    expect(canCreateUnder(tree, null).ok).toBe(true);
    expect(canCreateUnder(tree, 'ps').ok).toBe(true);
    const r = canCreateUnder(tree, 'graph');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/nest/);
  });
  it('rejects moving a parent with children under another root (not flattened)', () => {
    const r = canMove(tree, 'ps', 'kql');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/child folders/);
    expect(() => moveFolder(tree, 'ps', 'kql')).toThrow();
  });
  it('rejects moving into own child and into itself', () => {
    expect(canMove(tree, 'ps', 'graph').ok).toBe(false);
    expect(canMove(tree, 'ps', 'ps').ok).toBe(false);
  });
  it('allows moving a leaf child under another root', () => {
    expect(canMove(tree, 'graph', 'kql').ok).toBe(true);
    const next = moveFolder(tree, 'graph', 'kql');
    expect(next.find((f) => f.id === 'graph')!.parentId).toBe('kql');
    // old siblings renumbered
    expect(next.find((f) => f.id === 'exo')!.order).toBe(0);
  });
  it('rejects moving a leaf under a child (depth 3)', () => {
    expect(canMove(tree, 'kql', 'graph').ok).toBe(false);
  });
  it('reorders siblings', () => {
    const next = reorderFolder(tree, 'exo', 0);
    expect(childrenOf(next, 'ps').map((f) => f.id)).toEqual(['exo', 'graph']);
    const back = moveFolder(tree, 'kql', null, 0);
    expect(childrenOf(back, null).map((f) => f.id)).toEqual(['kql', 'ps']);
  });
});

describe('tree delete', () => {
  it('cascades', () => {
    const { folders, removedIds } = deleteCascade(tree, 'ps');
    expect(removedIds.sort()).toEqual(['exo', 'graph', 'ps']);
    expect(folders.map((f) => f.id)).toEqual(['kql']);
    expect(folders[0]!.order).toBe(0);
  });
  it('promotes children to root', () => {
    const { folders, removedIds } = deleteAndPromoteChildren(tree, 'ps');
    expect(removedIds).toEqual(['ps']);
    const roots = childrenOf(folders, null).map((f) => f.id);
    expect(roots).toEqual(['kql', 'graph', 'exo']);
  });
});

describe('recoverOrphans', () => {
  it('reparents orphans to root and reports', () => {
    const orphan = newFolder({ id: 'o', name: 'Lost', parentId: 'ghost' });
    const { folders, fixes } = recoverOrphans([...tree, orphan]);
    expect(folders.find((f) => f.id === 'o')!.parentId).toBeNull();
    expect(fixes).toHaveLength(1);
  });
  it('fixes depth violations and cycles', () => {
    const deep = newFolder({ id: 'd', name: 'Deep', parentId: 'graph' });
    const a = newFolder({ id: 'a', name: 'A', parentId: 'b' });
    const b = newFolder({ id: 'b', name: 'B', parentId: 'a' });
    const { folders } = recoverOrphans([...tree, deep, a, b]);
    expect(depthOf(folders, 'd')).toBeLessThanOrEqual(MAX_DEPTH);
    for (const f of folders) expect(depthOf(folders, f.id)).toBeGreaterThan(0);
  });
  it('drops duplicates', () => {
    const { folders, fixes } = recoverOrphans([ps, ps]);
    expect(folders).toHaveLength(1);
    expect(fixes).toHaveLength(1);
  });
});

describe('paths and rollup', () => {
  it('builds path labels', () => {
    expect(pathLabel(tree, 'graph')).toBe('PowerShell / Graph API');
  });
  it('rolls up descendants grouped by folder', () => {
    const groups = rollUp(tree, 'ps');
    expect(groups.map((g) => g.folder.id)).toEqual(['ps', 'graph', 'exo']);
  });
});
