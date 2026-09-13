/** JSON export / import preserving hierarchy. Pure. */
import {
  EXPORT_FORMAT,
  ExportFileSchema,
  MAX_DEPTH,
  newId,
  SCHEMA_VERSION,
  type ExportFile,
  type ExportFolder,
  type Folder,
} from './schema';
import { childrenOf, recoverOrphans } from './tree';

export function exportFolders(folders: readonly Folder[], now = new Date()): ExportFile {
  const build = (parentId: string | null): ExportFolder[] =>
    childrenOf(folders, parentId).map((f) => {
      const { parentId: _p, source: _s, ...rest } = f;
      const children = build(f.id);
      return children.length ? { ...rest, children } : rest;
    });
  return { format: EXPORT_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), folders: build(null) };
}

export function exportToJson(folders: readonly Folder[]): string {
  return JSON.stringify(exportFolders(folders), null, 2);
}

export type ImportMode = 'merge' | 'replace';

export interface ImportResult {
  folders: Folder[];
  added: number;
  skippedDepth: number;
  warnings: string[];
}

/**
 * Parse an export file. Throws with a readable message on invalid input.
 * `merge` appends the imported tree under fresh ids; `replace` discards the
 * existing tree. Anything deeper than MAX_DEPTH is rejected (counted), not flattened.
 */
export function importFromJson(json: string, existing: readonly Folder[], mode: ImportMode): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const parsed = ExportFileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Not a Command Drawer export file${first ? ` (${first.path.join('.') || 'root'}: ${first.message})` : ''}.`);
  }
  const base: Folder[] = mode === 'replace' ? [] : [...existing];
  const existingIds = new Set(base.map((f) => f.id));
  const out: Folder[] = [];
  const warnings: string[] = [];
  let skippedDepth = 0;
  const roots = childrenOf(base, null);
  let rootOrder = roots.length ? Math.max(...roots.map((r) => r.order)) + 1 : 0;

  const walk = (nodes: ExportFolder[], parentId: string | null, depth: number) => {
    nodes
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((node, i) => {
        if (depth > MAX_DEPTH) {
          skippedDepth++;
          return;
        }
        const { children, ...rest } = node;
        const id = existingIds.has(rest.id) || out.some((f) => f.id === rest.id) ? newId() : rest.id;
        const folder: Folder = {
          ...rest,
          id,
          parentId,
          order: parentId === null ? rootOrder++ : i,
          urlPatterns: rest.urlPatterns ?? [],
          snippets: (rest.snippets ?? []).map((s) => ({ ...s, id: s.id || newId() })),
          source: 'user',
        };
        out.push(folder);
        if (children?.length) {
          if (depth + 1 > MAX_DEPTH) {
            skippedDepth += countAll(children);
            warnings.push(`"${folder.name}" had sub-folders nested too deep; they were not imported.`);
          } else walk(children, id, depth + 1);
        }
      });
  };
  walk(parsed.data.folders, null, 1);
  const merged = recoverOrphans([...base, ...out]);
  warnings.push(...merged.fixes);
  return { folders: merged.folders, added: out.length, skippedDepth, warnings };
}

function countAll(nodes: ExportFolder[]): number {
  return nodes.reduce((n, c) => n + 1 + countAll(c.children ?? []), 0);
}
