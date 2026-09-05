import { useEffect, useMemo, useState } from 'preact/hooks';
import { MAX_FOLDER_NAME_CHARS, MAX_PATTERNS_PER_FOLDER, newFolder, newSnippet, type Folder, type Snippet } from '../lib/schema';
import type { SnippetStore, LoadedState } from '../lib/storage';
import { canCreateUnder, canMove, childrenOf, deleteAndPromoteChildren, deleteCascade, moveFolder, nextOrder, rootFolders } from '../lib/tree';
import { allMatches, isValidPattern, matches, PRESETS } from '../lib/matcher';
import { chromeSession, getLastUrl } from '../lib/session';
import { sortSnippets } from '../lib/search';
import { SnippetEditor } from '../shared/SnippetEditor';

type DropMode = 'before' | 'after' | 'into';

export function FoldersTab({ store, state, selectedId, onSelect, notify }: { store: SnippetStore; state: LoadedState; selectedId: string | null; onSelect: (id: string | null) => void; notify: (msg: string, kind?: 'ok' | 'warn') => void }) {
  const folders = state.folders;
  const selected = selectedId ? folders.find((f) => f.id === selectedId) ?? null : null;
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; mode: DropMode; ok: boolean } | null>(null);
  const [newName, setNewName] = useState('');

  const rows = useMemo(() => {
    const out: Array<{ folder: Folder; depth: number }> = [];
    for (const r of rootFolders(folders)) {
      out.push({ folder: r, depth: 1 });
      for (const c of childrenOf(folders, r.id)) out.push({ folder: c, depth: 2 });
    }
    return out;
  }, [folders]);

  const addRoot = () => {
    const name = newName.trim();
    if (!name) return;
    const g = store.canCreateFolder();
    if (!g.ok) return notify(g.reason, 'warn');
    const f = newFolder({ name, order: nextOrder(folders, null) });
    store.upsertFolder(f);
    setNewName('');
    onSelect(f.id);
  };

  const addChild = (parentId: string) => {
    const g = store.canCreateFolder();
    if (!g.ok) return notify(g.reason, 'warn');
    const d = canCreateUnder(folders, parentId);
    if (!d.ok) return notify(d.reason, 'warn');
    const f = newFolder({ name: 'New sub-folder', parentId, order: nextOrder(folders, parentId) });
    store.upsertFolder(f);
    onSelect(f.id);
  };

  // ---- drag and drop -------------------------------------------------------
  const computeDrop = (e: DragEvent, target: Folder): { mode: DropMode; ok: boolean; reason?: string } => {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    const mode: DropMode = y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'into';
    if (!dragId || dragId === target.id) return { mode, ok: false };
    if (mode === 'into') {
      const r = canMove(folders, dragId, target.id);
      return { mode, ok: r.ok, reason: r.ok ? undefined : r.reason };
    }
    const r = canMove(folders, dragId, target.parentId);
    return { mode, ok: r.ok, reason: r.ok ? undefined : r.reason };
  };

  const onDrop = (e: DragEvent, target: Folder) => {
    e.preventDefault();
    const d = computeDrop(e, target);
    setDrop(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    if (!d.ok) return notify(d.reason ?? 'That move is not allowed.', 'warn');
    try {
      if (d.mode === 'into') {
        store.replaceFolders(moveFolder(folders, id, target.id));
      } else {
        const siblings = childrenOf(folders, target.parentId).filter((s) => s.id !== id);
        let idx = siblings.findIndex((s) => s.id === target.id);
        if (d.mode === 'after') idx += 1;
        store.replaceFolders(moveFolder(folders, id, target.parentId, idx));
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'warn');
    }
  };

  return (
    <div class="two-col">
      <div class="card">
        <h2>Folders</h2>
        <p class="hint" style={{ marginTop: 0 }}>
          Drag to reorder. Drop onto a top-level folder to make it a sub-folder. One level of nesting only.
        </p>
        <div class="tree" onDragLeave={() => setDrop(null)}>
          {rows.length === 0 ? <div class="empty">No folders yet.</div> : null}
          {rows.map(({ folder, depth }) => {
            const cls = [
              'tree-row',
              depth === 2 ? 'child' : '',
              folder.id === selectedId ? 'selected' : '',
              dragId === folder.id ? 'dragging' : '',
              drop?.id === folder.id ? (drop.ok ? `drop-${drop.mode}` : 'drop-forbidden') : '',
            ].join(' ');
            return (
              <div
                key={folder.id}
                class={cls}
                draggable
                onClick={() => onSelect(folder.id)}
                onDragStart={(e) => {
                  setDragId(folder.id);
                  e.dataTransfer?.setData('text/plain', folder.id);
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => (setDragId(null), setDrop(null))}
                onDragOver={(e) => {
                  e.preventDefault();
                  const d = computeDrop(e, folder);
                  setDrop({ id: folder.id, mode: d.mode, ok: d.ok });
                }}
                onDrop={(e) => onDrop(e, folder)}
              >
                <span class="grip" title="Drag to move">
                  ⠿
                </span>
                <span class="name">{folder.name}</span>
                {state.localOnly.has(folder.id) ? <span class="badge badge-warn">local only</span> : null}
                {folder.urlPatterns.length ? <span class="badge" title={folder.urlPatterns.join('\n')}>{folder.urlPatterns.length} URL</span> : null}
                <span class="count">{folder.snippets.length}</span>
              </div>
            );
          })}
        </div>
        <div class="tree-actions">
          <input class="input" style={{ flex: 1 }} placeholder="New top-level folder name" value={newName} maxLength={MAX_FOLDER_NAME_CHARS} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && addRoot()} />
          <button class="btn btn-primary" onClick={addRoot} disabled={!newName.trim()}>
            Add
          </button>
        </div>
      </div>

      <div>
        {selected ? (
          <FolderEditor key={selected.id} folder={selected} folders={folders} store={store} settings={state.meta.settings} onAddChild={() => addChild(selected.id)} onDeleted={() => onSelect(null)} notify={notify} />
        ) : (
          <div class="card">
            <h2>Select a folder</h2>
            <p class="hint">Pick a folder on the left to edit its name, URL patterns and snippets.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FolderEditor({ folder, folders, store, settings, onAddChild, onDeleted, notify }: { folder: Folder; folders: Folder[]; store: SnippetStore; settings: LoadedState['meta']['settings']; onAddChild: () => void; onDeleted: () => void; notify: (m: string, k?: 'ok' | 'warn') => void }) {
  const [name, setName] = useState(folder.name);
  const [testUrl, setTestUrl] = useState('');
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const children = childrenOf(folders, folder.id);
  const isRoot = folder.parentId === null;

  useEffect(() => {
    void getLastUrl(chromeSession()).then((u) => u && setTestUrl((t) => t || u));
  }, []);

  useEffect(() => setName(folder.name), [folder.name]);

  const commitName = () => {
    const n = name.trim();
    if (n && n !== folder.name) store.upsertFolder({ ...folder, name: n });
    else setName(folder.name);
  };

  const setPatterns = (urlPatterns: string[]) => store.upsertFolder({ ...folder, urlPatterns });
  const patterns = folder.urlPatterns;

  const addPreset = (ps: string[]) => {
    const next = [...patterns];
    for (const p of ps) if (!next.includes(p)) next.push(p);
    if (next.length > MAX_PATTERNS_PER_FOLDER) return notify(`A folder can have at most ${MAX_PATTERNS_PER_FOLDER} patterns.`, 'warn');
    setPatterns(next);
  };

  const winner = testUrl ? allMatches(folders, testUrl)[0] : undefined;

  const saveSnippet = (data: { label: string; value: string }) => {
    let snippets: Snippet[];
    if (editing === 'new') {
      const order = folder.snippets.length ? Math.max(...folder.snippets.map((s) => s.order)) + 1 : 0;
      snippets = [...folder.snippets, newSnippet({ label: data.label, value: data.value, order })];
    } else {
      snippets = folder.snippets.map((s) => (s.id === editing ? { ...s, label: data.label || undefined, value: data.value } : s));
    }
    store.upsertFolder({ ...folder, snippets });
    setEditing(null);
  };

  const moveSnippet = (id: string, dir: -1 | 1) => {
    const sorted = sortSnippets(folder.snippets, 'manual');
    const i = sorted.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j]!, sorted[i]!];
    store.upsertFolder({ ...folder, snippets: sorted.map((s, k) => ({ ...s, order: k })) });
  };

  return (
    <>
      <div class="card">
        <h2>
          {isRoot ? 'Folder' : `Sub-folder of ${folders.find((f) => f.id === folder.parentId)?.name ?? '?'}`}
          {store.isLocalOnly(folder.id) ? (
            <span class="badge badge-warn" style={{ marginLeft: 8 }}>
              Local only, not syncing
            </span>
          ) : null}
        </h2>
        <label class="field">
          <span>Name</span>
          <input class="input" value={name} maxLength={MAX_FOLDER_NAME_CHARS} onInput={(e) => setName((e.target as HTMLInputElement).value)} onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </label>

        <h3>URL patterns</h3>
        <p class="hint" style={{ marginTop: 0 }}>
          When the active tab matches one of these, the popup opens on this folder. Chrome match-pattern syntax: <code>https://portal.azure.com/*</code>, <code>*://*.microsoft.com/*</code>. The most specific match wins. Sub-folders do not inherit their parent's patterns.
        </p>
        <div class="pattern-list">
          {patterns.map((p, i) => {
            const valid = isValidPattern(p);
            const hit = valid && testUrl ? matches(p, testUrl) : null;
            return (
              <div class="pattern-row" key={i}>
                <input
                  class={`input ${p && !valid ? 'invalid' : ''}`}
                  value={p}
                  spellcheck={false}
                  placeholder="https://example.com/*"
                  onInput={(e) => setPatterns(patterns.map((x, j) => (j === i ? (e.target as HTMLInputElement).value : x)))}
                />
                <span class={`status ${!p ? 'muted' : !valid ? 'bad' : hit === null ? 'muted' : hit ? 'ok' : 'muted'}`}>
                  {!p ? '' : !valid ? 'invalid' : hit === null ? 'valid' : hit ? '✓ matches' : 'no match'}
                </span>
                <button class="btn btn-ghost btn-sm" title="Remove" onClick={() => setPatterns(patterns.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <div class="tree-actions">
          <button class="btn btn-sm" onClick={() => patterns.length < MAX_PATTERNS_PER_FOLDER && setPatterns([...patterns, ''])} disabled={patterns.length >= MAX_PATTERNS_PER_FOLDER}>
            + Add pattern
          </button>
        </div>
        <div class="presets" style={{ marginTop: 10 }}>
          <span class="hint" style={{ alignSelf: 'center' }}>Presets:</span>
          {PRESETS.map((p) => (
            <button key={p.name} class="btn btn-sm" onClick={() => addPreset(p.patterns)} title={p.patterns.join('\n')}>
              {p.name}
            </button>
          ))}
        </div>
        <div class="test-url">
          <span class="hint" style={{ whiteSpace: 'nowrap' }}>Test URL:</span>
          <input class="input" value={testUrl} spellcheck={false} placeholder="Paste a URL to test the patterns above (pre-filled with the last tab the popup saw)" onInput={(e) => setTestUrl((e.target as HTMLInputElement).value)} />
        </div>
        {testUrl ? (
          <div class="hint status-line">
            {winner ? (
              <>
                For this URL the popup would open <b>{winner.folder.id === folder.id ? 'this folder' : `“${winner.folder.name}”`}</b> via <code>{winner.pattern}</code>.
              </>
            ) : (
              <>No folder matches this URL; the popup would show the root view.</>
            )}
          </div>
        ) : null}
      </div>

      <div class="card">
        <h2>
          Snippets <span class="hint">({folder.snippets.length})</span>
        </h2>
        {editing === 'new' ? (
          <SnippetEditor warnOnSecrets={settings.warnOnSecretShapedValues} onSave={saveSnippet} onCancel={() => setEditing(null)} />
        ) : (
          <div class="tree-actions" style={{ marginTop: 0, marginBottom: 10 }}>
            <button class="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
              + Add snippet
            </button>
          </div>
        )}
        <div class="snip-list">
          {sortSnippets(folder.snippets, 'manual').map((s, i, arr) =>
            editing === s.id ? (
              <div class="snip-row" key={s.id} style={{ display: 'block' }}>
                <SnippetEditor
                  initial={s}
                  warnOnSecrets={settings.warnOnSecretShapedValues}
                  onSave={saveSnippet}
                  onCancel={() => setEditing(null)}
                  onDelete={() => {
                    store.upsertFolder({ ...folder, snippets: folder.snippets.filter((x) => x.id !== s.id) });
                    setEditing(null);
                  }}
                />
              </div>
            ) : (
              <div class="snip-row" key={s.id}>
                <div class="main">
                  {s.label ? <div class="label">{s.label}</div> : null}
                  <div class="value">{s.value}</div>
                  <div class="meta">
                    Used {s.usedCount}× {s.lastUsedAt ? `· last ${new Date(s.lastUsedAt).toLocaleDateString()}` : ''}
                  </div>
                </div>
                <div class="actions">
                  <button class="btn btn-ghost btn-sm" title="Move up" disabled={i === 0} onClick={() => moveSnippet(s.id, -1)}>
                    ↑
                  </button>
                  <button class="btn btn-ghost btn-sm" title="Move down" disabled={i === arr.length - 1} onClick={() => moveSnippet(s.id, 1)}>
                    ↓
                  </button>
                  <button class="btn btn-ghost btn-sm" title="Edit" onClick={() => setEditing(s.id)}>
                    ✎
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      <div class="card">
        <h2>Folder actions</h2>
        <div class="tree-actions" style={{ marginTop: 0 }}>
          {isRoot ? (
            <button class="btn" onClick={onAddChild}>
              Add sub-folder
            </button>
          ) : null}
          {!confirmDelete ? (
            <button class="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              Delete folder…
            </button>
          ) : (
            <>
              <span class="hint" style={{ alignSelf: 'center' }}>
                Delete “{folder.name}” with {folder.snippets.length} snippet{folder.snippets.length === 1 ? '' : 's'}
                {children.length ? ` and ${children.length} sub-folder${children.length === 1 ? '' : 's'}` : ''}?
              </span>
              <button class="btn" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              {children.length ? (
                <button
                  class="btn"
                  onClick={() => {
                    store.replaceFolders(deleteAndPromoteChildren(folders, folder.id).folders);
                    onDeleted();
                  }}
                >
                  Delete, move sub-folders to top level
                </button>
              ) : null}
              <button
                class="btn btn-danger"
                onClick={() => {
                  store.replaceFolders(deleteCascade(folders, folder.id).folders);
                  onDeleted();
                }}
              >
                Delete{children.length ? ' everything' : ''}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
