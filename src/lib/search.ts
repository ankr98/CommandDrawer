/** Tree-wide fuzzy search over snippets. Pure. */
import type { Folder, Snippet } from './schema';
import { pathLabel } from './tree';

export interface SearchHit {
  snippet: Snippet;
  folder: Folder;
  /** "PowerShell / Graph API" */
  path: string;
  score: number;
}

/**
 * Score a query against text: substring matches score highest (earlier is
 * better), then word-prefix matches, then ordered-subsequence matches.
 * Returns 0 for no match.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const t = text.toLowerCase();
  if (!t) return 0;
  const idx = t.indexOf(q);
  if (idx >= 0) return 1000 - Math.min(idx, 500) + (idx === 0 || /\W/.test(t[idx - 1] ?? '') ? 100 : 0);
  // all query words appear somewhere (any order)
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => t.includes(w))) return 500;
  // ordered subsequence with a gap penalty
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const next = t.indexOf(ch, ti);
    if (next < 0) return 0;
    gaps += next - ti;
    ti = next + 1;
  }
  return Math.max(1, 200 - Math.min(gaps, 199));
}

export function searchSnippets(folders: readonly Folder[], query: string, limit = 50): SearchHit[] {
  const q = query.trim();
  const hits: SearchHit[] = [];
  for (const folder of folders) {
    const path = pathLabel(folders, folder.id);
    for (const snippet of folder.snippets) {
      if (!q) {
        hits.push({ snippet, folder, path, score: 1 });
        continue;
      }
      const s = Math.max(
        fuzzyScore(q, snippet.label ?? '') * 2, // labels count double
        fuzzyScore(q, snippet.value),
        fuzzyScore(q, path) * 0.5,
      );
      if (s > 0) hits.push({ snippet, folder, path, score: s });
    }
  }
  hits.sort((a, b) => b.score - a.score || b.snippet.usedCount - a.snippet.usedCount);
  return hits.slice(0, limit);
}

export type SortMode = 'manual' | 'mostUsed' | 'recent';

export function sortSnippets(snippets: readonly Snippet[], mode: SortMode): Snippet[] {
  const arr = [...snippets];
  switch (mode) {
    case 'mostUsed':
      return arr.sort((a, b) => b.usedCount - a.usedCount || a.order - b.order);
    case 'recent':
      return arr.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.order - b.order);
    default:
      return arr.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }
}
