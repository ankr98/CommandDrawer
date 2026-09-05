import { describe, expect, it } from 'vitest';
import { newFolder, newSnippet } from '../src/lib/schema';
import { fuzzyScore, searchSnippets, sortSnippets } from '../src/lib/search';
import { exportFolders, exportToJson, importFromJson } from '../src/lib/transfer';
import { childrenOf, depthOf } from '../src/lib/tree';

const ps = newFolder({ id: 'ps', name: 'PowerShell', order: 0, snippets: [newSnippet({ id: 's1', label: 'Connect Graph', value: 'Connect-MgGraph -Scopes User.Read.All', usedCount: 3 })] });
const graph = newFolder({
  id: 'graph',
  name: 'Graph API',
  parentId: 'ps',
  order: 0,
  urlPatterns: ['https://developer.microsoft.com/*graph*'],
  snippets: [newSnippet({ id: 's2', value: 'https://graph.microsoft.com/v1.0/me', usedCount: 10, lastUsedAt: 5 }), newSnippet({ id: 's3', label: 'List users', value: 'GET /users', order: 1, lastUsedAt: 9 })],
});
const folders = [ps, graph];

describe('search', () => {
  it('substring beats subsequence, labels count more', () => {
    expect(fuzzyScore('graph', 'Connect-MgGraph')).toBeGreaterThan(fuzzyScore('gph', 'Connect-MgGraph'));
    expect(fuzzyScore('zzz', 'Connect-MgGraph')).toBe(0);
    expect(fuzzyScore('', 'anything')).toBe(1);
  });
  it('spans the whole tree and reports the folder path', () => {
    const hits = searchSnippets(folders, 'users');
    expect(hits.map((h) => h.snippet.id)).toEqual(['s3']);
    expect(hits[0]!.path).toBe('PowerShell / Graph API');
    expect(searchSnippets(folders, 'graph').length).toBe(3);
  });
  it('sort modes', () => {
    expect(sortSnippets(graph.snippets, 'manual').map((s) => s.id)).toEqual(['s2', 's3']);
    expect(sortSnippets(graph.snippets, 'mostUsed').map((s) => s.id)).toEqual(['s2', 's3']);
    expect(sortSnippets(graph.snippets, 'recent').map((s) => s.id)).toEqual(['s3', 's2']);
  });
});

describe('export / import', () => {
  it('export nests children and round-trips through import (replace)', () => {
    const file = exportFolders(folders);
    expect(file.folders).toHaveLength(1);
    expect(file.folders[0]!.children![0]!.name).toBe('Graph API');
    const res = importFromJson(exportToJson(folders), [], 'replace');
    expect(res.added).toBe(2);
    expect(res.folders.find((f) => f.id === 'graph')!.parentId).toBe('ps');
    expect(res.folders.find((f) => f.id === 'graph')!.snippets).toHaveLength(2);
    expect(res.folders.find((f) => f.id === 'graph')!.urlPatterns).toEqual(['https://developer.microsoft.com/*graph*']);
  });
  it('merge keeps existing folders and re-ids collisions', () => {
    const res = importFromJson(exportToJson(folders), folders, 'merge');
    expect(res.folders).toHaveLength(4);
    expect(childrenOf(res.folders, null)).toHaveLength(2);
    const ids = res.folders.map((f) => f.id);
    expect(new Set(ids).size).toBe(4);
    for (const f of res.folders) expect(depthOf(res.folders, f.id)).toBeLessThanOrEqual(2);
  });
  it('rejects too-deep trees rather than flattening', () => {
    const json = JSON.stringify({
      format: 'command-drawer-export',
      schemaVersion: 1,
      exportedAt: 'x',
      folders: [{ id: 'a', name: 'A', order: 0, snippets: [], urlPatterns: [], children: [{ id: 'b', name: 'B', order: 0, snippets: [], urlPatterns: [], children: [{ id: 'c', name: 'C', order: 0, snippets: [], urlPatterns: [] }] }] }],
    });
    const res = importFromJson(json, [], 'replace');
    expect(res.folders.map((f) => f.id).sort()).toEqual(['a', 'b']);
    expect(res.skippedDepth).toBe(1);
    expect(res.warnings.length).toBeGreaterThan(0);
  });
  it('rejects garbage with a readable error', () => {
    expect(() => importFromJson('{', [], 'merge')).toThrow(/valid JSON/);
    expect(() => importFromJson('{"format":"nope"}', [], 'merge')).toThrow(/export file/);
  });
});
