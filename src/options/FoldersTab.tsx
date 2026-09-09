import { useEffect, useMemo, useState } from 'preact/hooks';
import { MAX_FOLDER_NAME_CHARS, MAX_PATTERNS_PER_FOLDER, newFolder, newSnippet, type Folder, type Snippet } from '../lib/schema';
import type { SnippetStore, LoadedState } from '../lib/storage';
import { canCreateUnder, canMove, childrenOf, deleteAndPromoteChildren, deleteCascade, moveFolder, nextOrder, rootFolders } from '../lib/tree';
import { allMatches, isValidPattern, matches, parseUrl, score, shadowedBy, type Match } from '../lib/matcher';
import { chromeSession, getLastUrl } from '../lib/session';
import { sortSnippets } from '../lib/search';
import { SnippetEditor } from '../shared/SnippetEditor';
import { IconAlert, IconArrowDown, IconArrowUp, IconCheck, IconFolder, IconGlobe, IconGrip, IconInfo, IconPencil, IconPlus, IconTrash, IconX } from '../shared/icons';

type DropMode = 'before' | 'after' | 'into';

export function FoldersTab({ store, state, selectedId, onSelect, notify }: { store: SnippetStore; state: LoadedState; selectedId: string | null; onSelect: (id: string | null) => void; notify: (msg: string, kind?: 'ok' | 'warn') => void }) {
  const folders = state.folders;
  const folderSort = state.meta.settings.folderSort;
  const manual = folderSort === 'manual';
  const selected = selectedId ? folders.find((f) => f.id === selectedId) ?? null : null;
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; mode: DropMode; ok: boolean } | null>(null);
  const [newName, setNewName] = useState('');

  const rows = useMemo(() => {
    const out: Array<{ folder: Folder; depth: number; last: boolean }> = [];
    for (const r of rootFolders(folders, folderSort)) {
      out.push({ folder: r, depth: 1, last: false });
      const kids = childrenOf(folders, r.id, folderSort);
      kids.forEach((c, i) => out.push({ folder: c, depth: 2, last: i === kids.length - 1 }));
    }
    return out;
  }, [folders, folderSort]);

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
    // Alphabetical: "before/after" would be a lie, so a drop only changes the level —
    // onto a top-level folder to nest, beside a sub-folder to move to that level.
    const mode: DropMode = manual ? (y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'into') : target.parentId === null ? 'into' : 'after';
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
          {manual ? 'Drag to reorder. Drop onto a top-level folder to make it a sub-folder.' : 'Sorted A-Z (change in Settings). Drop onto a top-level folder to make it a sub-folder.'} One level of nesting only.
        </p>
        <div class="tree" onDragLeave={() => setDrop(null)}>
          {rows.length === 0 ? <div class="empty">No folders yet.</div> : null}
          {rows.map(({ folder, depth, last }) => {
            const cls = [
              'tree-row',
              depth === 2 ? 'child' : '',
              last ? 'last' : '',
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
                  <IconGrip size={14} />
                </span>
                <span class="folder-badge sm">
                  <IconFolder size={13} />
                </span>
                <span class="name">{folder.name}</span>
                {state.localOnly.has(folder.id) ? <span class="badge badge-warn">local only</span> : null}
                {folder.urlPatterns.length ? (
                  <span class="badge" title={folder.urlPatterns.join('\n')}>
                    <IconGlobe size={11} /> {folder.urlPatterns.length}
                  </span>
                ) : null}
                <span class="count" title={`${folder.snippets.length} snippet${folder.snippets.length === 1 ? '' : 's'}`}>
                  {folder.snippets.length}
                </span>
              </div>
            );
          })}
        </div>
        <div class="tree-actions">
          <input class="input" style={{ flex: 1 }} placeholder="New top-level folder name" value={newName} maxLength={MAX_FOLDER_NAME_CHARS} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && addRoot()} />
          <button class="btn btn-primary" onClick={addRoot} disabled={!newName.trim()}>
            <IconPlus size={14} /> Add
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

// ---- URL tester --------------------------------------------------------------

type Verdict =
  | { state: 'empty' }
  | { state: 'invalid' }
  | { state: 'ok'; winner: Match }
  | { state: 'shadowed'; winner: Match; own: string }
  | { state: 'other'; winner: Match }
  | { state: 'none' };

/** What the popup would do for `url`, from the point of view of `folder`. */
function judge(folder: Folder, folders: readonly Folder[], url: string): Verdict {
  const u = url.trim();
  if (!u) return { state: 'empty' };
  if (!parseUrl(u)) return { state: 'invalid' };
  const winner = allMatches(folders, u)[0];
  let own: string | undefined;
  let best = -1;
  for (const p of folder.urlPatterns) {
    const s = score(p, u);
    if (s !== null && s > best) {
      best = s;
      own = p;
    }
  }
  if (winner && winner.folder.id === folder.id) return { state: 'ok', winner };
  if (own && winner) return { state: 'shadowed', winner, own };
  if (winner) return { state: 'other', winner };
  return { state: 'none' };
}

function UrlTester({ folder, folders, value, lastUrl, onChange }: { folder: Folder; folders: readonly Folder[]; value: string; lastUrl: string | null; onChange: (v: string) => void }) {
  const v = judge(folder, folders, value);
  const tone = v.state === 'ok' ? 'ok' : v.state === 'shadowed' ? 'warn' : v.state === 'other' || v.state === 'none' ? 'bad' : v.state === 'invalid' ? 'muted' : '';
  return (
    <div class={`tester ${tone}`}>
      <div class="tester-head">
        <span class="label">
          <IconGlobe size={15} /> Test a URL
        </span>
        <span class="spacer" />
        {lastUrl && lastUrl !== value ? (
          <button class="btn btn-ghost" onClick={() => onChange(lastUrl)} title={lastUrl}>
            Use last tab URL
          </button>
        ) : null}
        {value ? (
          <button class="btn btn-ghost" onClick={() => onChange('')}>
            <IconX size={13} /> Clear
          </button>
        ) : null}
      </div>
      <div class="test-url">
        <input class="input" value={value} spellcheck={false} placeholder="https://portal.azure.com/#home" aria-label="Test URL" onInput={(e) => onChange((e.target as HTMLInputElement).value)} />
      </div>
      {v.state === 'empty' ? (
        <div class="hint status-line">Paste a URL to check which folder opens for it.</div>
      ) : v.state === 'invalid' ? (
        <div class="verdict status-line">
          <IconInfo size={16} />
          <span>
            Not a full URL
            <span class="detail">Include the scheme, for example https://portal.azure.com/#home</span>
          </span>
        </div>
      ) : v.state === 'ok' ? (
        <div class="verdict status-line">
          <IconCheck size={16} />
          <span>
            Matches this folder
            <span class="detail">
              Command Drawer opens here via <code>{v.winner.pattern}</code>.
            </span>
          </span>
        </div>
      ) : v.state === 'shadowed' ? (
        <div class="verdict status-line">
          <IconAlert size={16} />
          <span>
            Matches here, but “{v.winner.folder.name}” wins
            <span class="detail">
              <code>{v.own}</code> matches, but “{v.winner.folder.name}” has the more specific <code>{v.winner.pattern}</code>, so it opens instead.
            </span>
          </span>
        </div>
      ) : v.state === 'other' ? (
        <div class="verdict status-line">
          <IconX size={16} />
          <span>
            No pattern in this folder matches
            <span class="detail">
              “{v.winner.folder.name}” opens instead, via <code>{v.winner.pattern}</code>.
            </span>
          </span>
        </div>
      ) : (
        <div class="verdict status-line">
          <IconX size={16} />
          <span>
            No pattern in this folder matches
            <span class="detail">No folder matches this URL, so the folder list is shown.</span>
          </span>
        </div>
      )}
    </div>
  );
}

// ---- folder editor -----------------------------------------------------------

function FolderEditor({ folder, folders, store, settings, onAddChild, onDeleted, notify }: { folder: Folder; folders: Folder[]; store: SnippetStore; settings: LoadedState['meta']['settings']; onAddChild: () => void; onDeleted: () => void; notify: (m: string, k?: 'ok' | 'warn') => void }) {
  const [name, setName] = useState(folder.name);
  const [testUrl, setTestUrl] = useState('');
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const children = childrenOf(folders, folder.id, settings.folderSort);
  const isRoot = folder.parentId === null;

  useEffect(() => {
    void getLastUrl(chromeSession()).then((u) => {
      if (!u) return;
      setLastUrl(u);
      setTestUrl((t) => t || u);
    });
  }, []);

  useEffect(() => setName(folder.name), [folder.name]);

  const commitName = () => {
    const n = name.trim();
    if (n && n !== folder.name) store.upsertFolder({ ...folder, name: n });
    else setName(folder.name);
  };

  const setPatterns = (urlPatterns: string[]) => store.upsertFolder({ ...folder, urlPatterns });
  const patterns = folder.urlPatterns;
  const shadows = useMemo(() => shadowedBy(folders, folder.id), [folders, folder.id]);

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
          <span class="folder-badge sm">
            <IconFolder size={13} />
          </span>
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

        <h3>
          <IconGlobe size={13} /> URL patterns
        </h3>
        <p class="hint" style={{ marginTop: 0 }}>
          Command Drawer opens on the folder whose pattern best matches the site you are on. Syntax: <code>https://portal.azure.com/*</code> or <code>*://*.microsoft.com/*</code>. Sub-folders don't inherit their parent's patterns.
        </p>
        <div class="pattern-list">
          {patterns.map((p, i) => {
            const valid = isValidPattern(p);
            const hit = valid && testUrl ? matches(p, testUrl) : null;
            const tone = !p ? 'empty' : !valid ? 'bad' : hit === null ? 'muted' : hit ? 'ok' : 'muted';
            return (
              <div class="pattern-row" key={i}>
                <input
                  class={`input ${p && !valid ? 'invalid' : ''}`}
                  value={p}
                  spellcheck={false}
                  placeholder="https://example.com/*"
                  aria-label={`URL pattern ${i + 1}`}
                  onInput={(e) => setPatterns(patterns.map((x, j) => (j === i ? (e.target as HTMLInputElement).value : x)))}
                />
                <span class={`status ${tone}`}>
                  {!p ? '—' : !valid ? 'invalid' : hit === null ? 'valid' : hit ? <><IconCheck size={12} /> matches</> : 'no match'}
                </span>
                <button class="btn btn-ghost icon-btn" title="Remove pattern" aria-label="Remove pattern" onClick={() => setPatterns(patterns.filter((_, j) => j !== i))}>
                  <IconX size={14} />
                </button>
              </div>
            );
          })}
        </div>
        <div class="tree-actions">
          <button class="btn" onClick={() => patterns.length < MAX_PATTERNS_PER_FOLDER && setPatterns([...patterns, ''])} disabled={patterns.length >= MAX_PATTERNS_PER_FOLDER}>
            <IconPlus size={14} /> Add pattern
          </button>
        </div>
        {shadows.length ? (
          <div class="overlaps">
            {shadows.map((s) => (
              <div class={`overlap ${s.tie ? 'tie' : ''}`} key={`${s.by.id}\n${s.byPattern}`}>
                {s.tie ? <IconAlert size={14} /> : <IconInfo size={14} />}
                <span>
                  {s.tie ? (
                    <>
                      “{s.by.name}” has an equally specific pattern, <code>{s.byPattern}</code>, and is higher in the list, so it wins over <code>{s.pattern}</code>.
                    </>
                  ) : (
                    <>
                      “{s.by.name}” opens instead on sites matching its more specific <code>{s.byPattern}</code>.
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <UrlTester folder={folder} folders={folders} value={testUrl} lastUrl={lastUrl} onChange={setTestUrl} />
      </div>

      <div class="card">
        <h2>
          Snippets <span class="hint">({folder.snippets.length})</span>
        </h2>
        {editing === 'new' ? (
          <SnippetEditor warnOnSecrets={settings.warnOnSecretShapedValues} onSave={saveSnippet} onCancel={() => setEditing(null)} />
        ) : (
          <div class="tree-actions" style={{ marginTop: 0, marginBottom: 12 }}>
            <button class="btn btn-primary" onClick={() => setEditing('new')}>
              <IconPlus size={14} /> Add snippet
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
                  <button class="btn btn-ghost icon-btn" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => moveSnippet(s.id, -1)}>
                    <IconArrowUp size={14} />
                  </button>
                  <button class="btn btn-ghost icon-btn" title="Move down" aria-label="Move down" disabled={i === arr.length - 1} onClick={() => moveSnippet(s.id, 1)}>
                    <IconArrowDown size={14} />
                  </button>
                  <button class="btn btn-ghost icon-btn" title="Edit" aria-label="Edit" onClick={() => setEditing(s.id)}>
                    <IconPencil size={14} />
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
              <IconPlus size={14} /> Add sub-folder
            </button>
          ) : null}
          {!confirmDelete ? (
            <button class="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              <IconTrash size={14} /> Delete folder…
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
                <IconTrash size={14} /> Delete{children.length ? ' everything' : ''}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
