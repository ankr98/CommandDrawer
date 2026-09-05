/**
 * Data model, validation and constants. See plan §6 and §8.
 *
 * A snippet is a display name plus ONE value. There is deliberately no third
 * field. Do not add one.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;
export type SchemaVersion = typeof SCHEMA_VERSION;

/** Root + one child level. Enforced in tree.ts, not in the UI. */
export const MAX_DEPTH = 2;
export const MAX_SNIPPET_CHARS = 2000;
export const MAX_LABEL_CHARS = 60;
export const MAX_FOLDER_NAME_CHARS = 60;
export const MAX_PATTERNS_PER_FOLDER = 20;

export const SnippetSchema = z.object({
  id: z.string().min(1),
  label: z.string().max(MAX_LABEL_CHARS).optional(),
  value: z.string().max(MAX_SNIPPET_CHARS),
  order: z.number().int(),
  createdAt: z.number(),
  usedCount: z.number().int().nonnegative().default(0),
  lastUsedAt: z.number().optional(),
});
export type Snippet = z.infer<typeof SnippetSchema>;

export const FolderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(MAX_FOLDER_NAME_CHARS),
  parentId: z.string().nullable().default(null),
  order: z.number().int().default(0),
  urlPatterns: z.array(z.string()).max(MAX_PATTERNS_PER_FOLDER).default([]),
  snippets: z.array(SnippetSchema).default([]),
  rollUpDescendants: z.boolean().optional(),
  source: z.enum(['user', 'managed']).default('user'),
});
export type Folder = z.infer<typeof FolderSchema>;

export const SettingsSchema = z.object({
  sortMode: z.enum(['manual', 'mostUsed', 'recent']).default('manual'),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  warnOnSecretShapedValues: z.boolean().default(true),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const MetaSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  folderIds: z.array(z.string()).default([]),
  settings: SettingsSchema.default({
    sortMode: 'manual',
    theme: 'system',
    warnOnSecretShapedValues: true,
  }),
});
export type Meta = z.infer<typeof MetaSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

export function defaultMeta(): Meta {
  return { schemaVersion: SCHEMA_VERSION, folderIds: [], settings: { ...DEFAULT_SETTINGS } };
}

/** Export file format: hierarchy is expressed by nesting `children`. */
export const EXPORT_FORMAT = 'command-drawer-export' as const;

export type ExportFolder = Omit<Folder, 'parentId' | 'source'> & { children?: ExportFolder[] };

export const ExportFolderSchema: z.ZodType<ExportFolder> = z.lazy(() =>
  FolderSchema.omit({ parentId: true, source: true }).extend({
    children: z.array(ExportFolderSchema).optional(),
  }),
) as z.ZodType<ExportFolder>;

export const ExportFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  schemaVersion: z.literal(SCHEMA_VERSION),
  exportedAt: z.string(),
  folders: z.array(ExportFolderSchema),
});
export type ExportFile = z.infer<typeof ExportFileSchema>;

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Fallback for very old runtimes; not cryptographically meaningful here.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function newSnippet(partial: Partial<Snippet> & { value: string }): Snippet {
  return {
    id: partial.id ?? newId(),
    label: partial.label?.trim() ? partial.label.trim() : undefined,
    value: partial.value,
    order: partial.order ?? 0,
    createdAt: partial.createdAt ?? Date.now(),
    usedCount: partial.usedCount ?? 0,
    lastUsedAt: partial.lastUsedAt,
  };
}

export function newFolder(partial: Partial<Folder> & { name: string }): Folder {
  return {
    id: partial.id ?? newId(),
    name: partial.name.trim(),
    parentId: partial.parentId ?? null,
    order: partial.order ?? 0,
    urlPatterns: partial.urlPatterns ?? [],
    snippets: partial.snippets ?? [],
    rollUpDescendants: partial.rollUpDescendants,
    source: partial.source ?? 'user',
  };
}

/**
 * Migration hook. Currently a no-op at version 1; add cases as the schema
 * evolves. Unknown or missing meta falls back to a default.
 */
export function migrateMeta(raw: unknown): { meta: Meta; migrated: boolean } {
  if (raw === undefined || raw === null) return { meta: defaultMeta(), migrated: false };
  const parsed = MetaSchema.safeParse(raw);
  if (parsed.success) return { meta: parsed.data, migrated: false };
  // Future: switch on (raw as any).schemaVersion and upgrade step by step.
  const loose = raw as Partial<Meta>;
  const meta = defaultMeta();
  if (Array.isArray(loose.folderIds)) meta.folderIds = loose.folderIds.filter((x) => typeof x === 'string');
  const settings = SettingsSchema.safeParse(loose.settings ?? {});
  if (settings.success) meta.settings = settings.data;
  return { meta, migrated: true };
}

/** Lenient folder parse used on read paths: never throws, returns null if unrecoverable. */
export function parseFolder(raw: unknown): Folder | null {
  const res = FolderSchema.safeParse(raw);
  if (res.success) return res.data;
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  // Salvage what we can: drop invalid snippets rather than the whole folder.
  const snippets = Array.isArray(r.snippets)
    ? r.snippets.map((s) => SnippetSchema.safeParse(s)).filter((s) => s.success).map((s) => s.data)
    : [];
  return newFolder({
    id: r.id,
    name: r.name.slice(0, MAX_FOLDER_NAME_CHARS) || 'Recovered folder',
    parentId: typeof r.parentId === 'string' ? r.parentId : null,
    order: typeof r.order === 'number' ? r.order : 0,
    urlPatterns: Array.isArray(r.urlPatterns) ? r.urlPatterns.filter((p) => typeof p === 'string') : [],
    snippets,
    rollUpDescendants: typeof r.rollUpDescendants === 'boolean' ? r.rollUpDescendants : undefined,
  });
}
