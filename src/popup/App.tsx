import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { newFolder, newSnippet, type Folder, type Snippet } from '../lib/schema';
import { canCreateUnder, childrenOf, deleteAndPromoteChildren, deleteCascade, nextOrder, pathOf, rollUp, rootFolders } from '../lib/tree';
import { originOf, parseUrl, patternForHost, resolveFolder, ROOT_OVERRIDE, type Resolution } from '../lib/matcher';
import { chromeSession, clearOverride, getOverride, markSuggested, recordManualPick, rememberLastUrl, setOverride, shouldSuggestMapping } from '../lib/session';
import { searchSnippets, sortSnippets, type SearchHit } from '../lib/search';
import { copyText } from '../lib/clipboard';
import { PLAINTEXT_DISCLOSURE } from '../lib/guards';
import { useStore } from '../shared/store';
import { getActiveTab, openOptions, type ActiveTab } from '../shared/browser';
import { SnippetEditor } from '../shared/SnippetEditor';

type Item =
  | { kind: 'folder'; folder: Folder; key: string }
  | { kind: 'snippet'; snippet: Snippet; folder: Folder; path?: string; key: string }
  | { kind: 'header'; label: string; key: string };

type Panel =
  | { kind: 'none' }
  | { kind: 'newSnippet'; folderId: string }
  | { kind: 'editSnippet'; folderId: string; snippetId: string }
  | { kind: 'newFolder'; parentId: string | null }
  | { kind: 'renameFolder'; folderId: string }
  | { kind: 'deleteFolder'; folderId: string };

const session = chromeSession();

export function App() {
  const { store, state } = useStore();
  const [tab, setTab] = useState<ActiveTab | null>(null);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [chipHidden, setChipHidden] = useState(false);
  const [suggest, setSuggest] = useState<{ host: string; folderId: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const initialised = useRef(false);
  const initialKind = useRef<Resolution['kind']>('none');

  const folders = state?.folders ?? [];
  const settings = state?.meta.settings;
  const origin = originOf(tab?.url);

  // Initial resolution: override → auto-match → root.
  useEffect(() => {
    if (!state || initialised.current) return;
    initialised.current = true;
    (async () => {
      const t = await getActiveTab();
      setTab(t);
      if (t.url) void rememberLastUrl(session, t.url);
      const o = originOf(t.url);
      const override = t.id !== null && o ? await getOverride(session, t.id, o) : null;
      const res = resolveFolder(state.folders, t.url, override);
      initialKind.current = res.kind;
      setResolution(res);
      setViewId(res.folderId);
    })();
  }, [state]);

  // Focus the search box as soon as the main view is mounted (plan §7.1).
  useEffect(() => {
    if (resolution) searchRef.current?.focus();
  }, [resolution]);

  // If the folder being viewed disappears (deleted elsewhere), fall back to root.
  useEffect(() => {
    if (viewId && state && !state.folders.some((f) => f.id === viewId)) setViewId(null);
  }, [state, viewId]);

  const current = viewId ? folders.find((f) => f.id === viewId) ?? null : null;
  const crumbs = current ? pathOf(folders, current.id) : [];
  const sortMode = settings?.sortMode ?? 'manual';

  const items: Item[] = useMemo(() => {
    const q = query.trim();
    if (q) {
      return searchSnippets(folders, q).map((h: SearchHit) => ({ kind: 'snippet', snippet: h.snippet, folder: h.folder, path: h.path, key: `s:${h.snippet.id}` }));
    }
    if (!current) return rootFolders(folders).map((f) => ({ kind: 'folder', folder: f, key: `f:${f.id}` }));
    const kids = childrenOf(folders, current.id);
    const out: Item[] = kids.map((f) => ({ kind: 'folder', folder: f, key: `f:${f.id}` }));
    if (current.rollUpDescendants && kids.length) {
      for (const g of rollUp(folders, current.id)) {
        if (!g.snippets.length) continue;
        out.push({ kind: 'header', label: g.folder.id === current.id ? current.name : g.path, key: `h:${g.folder.id}` });
        for (const s of sortSnippets(g.snippets, sortMode)) out.push({ kind: 'snippet', snippet: s, folder: g.folder, key: `s:${s.id}` });
      }
    } else {
      for (const s of sortSnippets(current.snippets, sortMode)) out.push({ kind: 'snippet', snippet: s, folder: current, key: `s:${s.id}` });
    }
    return out;
  }, [folders, current, query, sortMode]);

  const selectable = useMemo(() => items.map((it, i) => (it.kind === 'header' ? -1 : i)).filter((i) => i >= 0), [items]);

  useEffect(() => setActive(0), [query, viewId]);

  useEffect(() => {
    const idx = selectable[active];
    if (idx === undefined) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${idx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, selectable]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // ---- navigation ------------------------------------------------------------

  const pin = useCallback(
    async (folderId: string | null) => {
      if (tab?.id === null || tab?.id === undefined || !origin) return;
      await setOverride(session, tab.id, origin, folderId ?? ROOT_OVERRIDE);
      setResolution({ kind: 'override', folderId });
      setChipHidden(false);
    },
    [tab, origin],
  );

  const enterFolder = useCallback(
    async (id: string) => {
      setViewId(id);
      setQuery('');
      setMenuOpen(false);
      searchRef.current?.focus();
      await pin(id);
      // §5.5 discovery: on a host that matched nothing, offer to map after repeated picks.
      const host = tab?.url ? parseUrl(tab.url)?.hostname : null;
      if (initialKind.current === 'none' && host && !/^(localhost|127\.)/.test(host)) {
        const n = await recordManualPick(session, host, id);
        if (n >= 3 && (await shouldSuggestMapping(session, host, id))) setSuggest({ host, folderId: id });
      }
    },
    [pin, tab],
  );

  const goUp = useCallback(async () => {
    const parentId = current?.parentId ?? null;
    setViewId(parentId);
    setQuery('');
    searchRef.current?.focus();
    await pin(parentId);
  }, [current, pin]);

  const resetAuto = useCallback(async () => {
    if (tab?.id !== null && tab?.id !== undefined && origin) await clearOverride(session, tab.id, origin);
    const res = resolveFolder(folders, tab?.url ?? null, null);
    setResolution(res);
    setViewId(res.folderId);
    setChipHidden(false);
    searchRef.current?.focus();
  }, [tab, origin, folders]);

  // ---- snippets --------------------------------------------------------------

  const copySnippet = useCallback(
    async (snippet: Snippet, folder: Folder, closeAfter: boolean) => {
      const ok = await copyText(snippet.value);
      if (!ok) {
        showToast('Could not access the clipboard.');
        return;
      }
      const updated: Folder = {
        ...folder,
        snippets: folder.snippets.map((s) => (s.id === snippet.id ? { ...s, usedCount: s.usedCount + 1, lastUsedAt: Date.now() } : s)),
      };
      store.upsertFolder(updated);
      setCopiedId(snippet.id);
      setTimeout(() => setCopiedId((c) => (c === snippet.id ? null : c)), 1200);
      if (closeAfter) {
        await store.flush();
        window.close();
      }
    },
    [store],
  );

  const saveSnippet = (folderId: string, data: { label: string; value: string }, snippetId?: string) => {
    const folder = store.getFolder(folderId);
    if (!folder) return;
    let snippets: Snippet[];
    if (snippetId) {
      snippets = folder.snippets.map((s) => (s.id === snippetId ? { ...s, label: data.label || undefined, value: data.value } : s));
    } else {
      const order = folder.snippets.length ? Math.max(...folder.snippets.map((s) => s.order)) + 1 : 0;
      snippets = [...folder.snippets, newSnippet({ label: data.label, value: data.value, order })];
    }
    store.upsertFolder({ ...folder, snippets });
    setPanel({ kind: 'none' });
    searchRef.current?.focus();
  };

  const deleteSnippet = (folderId: string, snippetId: string) => {
    const folder = store.getFolder(folderId);
    if (!folder) return;
    store.upsertFolder({ ...folder, snippets: folder.snippets.filter((s) => s.id !== snippetId) });
    setPanel({ kind: 'none' });
  };

  // ---- folders ---------------------------------------------------------------

  const createFolder = (parentId: string | null, name: string) => {
    const guard = store.canCreateFolder();
    if (!guard.ok) return showToast(guard.reason);
    const depth = canCreateUnder(folders, parentId);
    if (!depth.ok) return showToast(depth.reason);
    const f = newFolder({ name, parentId, order: nextOrder(folders, parentId) });
    store.upsertFolder(f);
    setPanel({ kind: 'none' });
    void enterFolder(f.id);
  };

  const renameFolder = (id: string, name: string) => {
    const f = store.getFolder(id);
    if (f) store.upsertFolder({ ...f, name });
    setPanel({ kind: 'none' });
  };

  const removeFolder = (id: string, promote: boolean) => {
    const res = promote ? deleteAndPromoteChildren(folders, id) : deleteCascade(folders, id);
    const parent = folders.find((f) => f.id === id)?.parentId ?? null;
    store.replaceFolders(res.folders);
    setPanel({ kind: 'none' });
    setViewId(parent);
  };

  const mapToSite = (folderId: string) => {
    const f = store.getFolder(folderId);
    const pat = tab?.url ? patternForHost(tab.url) : null;
    if (!f || !pat) return showToast('The current tab has no mappable URL.');
    if (!f.urlPatterns.includes(pat)) store.upsertFolder({ ...f, urlPatterns: [...f.urlPatterns, pat] });
    setSuggest(null);
    setMenuOpen(false);
    if (tab?.url) void markSuggested(session, parseUrl(tab.url)?.hostname ?? '');
    // The site now auto-matches this folder; drop the manual pin so Auto reflects reality.
    if (tab?.id !== null && tab?.id !== undefined && origin) void clearOverride(session, tab.id, origin);
    setResolution({ kind: 'match', folderId, host: parseUrl(tab?.url ?? '')?.hostname ?? '', pattern: pat });
    showToast(`Mapped "${f.name}" to ${pat}`);
  };

  // ---- keyboard --------------------------------------------------------------

  const activate = (i: number, viaKeyboard: boolean) => {
    const it = items[i];
    if (!it) return;
    if (it.kind === 'folder') void enterFolder(it.folder.id);
    else if (it.kind === 'snippet') void copySnippet(it.snippet, it.folder, viaKeyboard);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (panel.kind !== 'none') return; // editors handle their own keys
    const target = e.target as HTMLElement;
    const inSearch = target === searchRef.current;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(selectable.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && inSearch) {
      e.preventDefault();
      const idx = selectable[active];
      if (idx !== undefined) activate(idx, true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (menuOpen) setMenuOpen(false);
      else if (query) setQuery('');
      else if (current) void goUp();
      else window.close();
    } else if (e.key === 'Backspace' && inSearch && !query && current) {
      e.preventDefault();
      void goUp();
    } else if (e.key === 'ArrowLeft' && inSearch && !query && current) {
      e.preventDefault();
      void goUp();
    }
  };

  // ---- render ----------------------------------------------------------------

  if (!state || !resolution) {
    return (
      <div class="popup">
        <div class="empty">Loading…</div>
      </div>
    );
  }

  const chip =
    chipHidden || query ? null : resolution.kind === 'override' ? (
      <span class="chip">
        Pinned for this site
        <span>—</span>
        <button class="btn-link" onClick={resetAuto} title="Clear the manual choice and auto-match again">
          Auto
        </button>
        <button class="x" onClick={() => setChipHidden(true)} aria-label="Dismiss">
          ×
        </button>
      </span>
    ) : resolution.kind === 'match' && viewId === resolution.folderId ? (
      <span class="chip">
        Matched {resolution.host}
        <button class="x" onClick={() => setChipHidden(true)} aria-label="Dismiss">
          ×
        </button>
      </span>
    ) : null;

  const noFolders = folders.length === 0;

  return (
    <div class="popup" onKeyDown={onKeyDown}>
      <div class="header">
        <input
          ref={searchRef}
          class="input"
          type="search"
          placeholder={current ? `Search all snippets…  (Backspace to go up)` : 'Search all snippets…'}
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          aria-label="Search snippets"
          autoComplete="off"
          spellcheck={false}
        />
        <button class="btn btn-ghost icon-btn" title="Settings and folder management" onClick={() => openOptions()} aria-label="Settings">
          ⚙
        </button>
      </div>

      {!query ? (
        <div class="crumbs">
          <button class={`crumb ${!current ? 'current' : ''}`} onClick={() => (current ? void (setViewId(null), pin(null)) : undefined)}>
            {current ? '‹ All' : 'All folders'}
          </button>
          {crumbs.map((c, i) => (
            <span key={c.id} style={{ display: 'contents' }}>
              <span class="sep">/</span>
              <button class={`crumb ${i === crumbs.length - 1 ? 'current' : ''}`} onClick={() => i < crumbs.length - 1 && void enterFolder(c.id)}>
                {c.name}
              </button>
            </span>
          ))}
          <span class="spacer" />
          {current ? (
            <div class="menu">
              <button class="btn btn-ghost icon-btn" onClick={() => setMenuOpen((m) => !m)} aria-label="Folder actions" title="Folder actions">
                ⋯
              </button>
              {menuOpen ? (
                <div class="menu-list" onMouseLeave={() => setMenuOpen(false)}>
                  <button onClick={() => (setMenuOpen(false), setPanel({ kind: 'newSnippet', folderId: current.id }))}>Add snippet</button>
                  {current.parentId === null ? <button onClick={() => (setMenuOpen(false), setPanel({ kind: 'newFolder', parentId: current.id }))}>Add sub-folder</button> : null}
                  <button onClick={() => (setMenuOpen(false), setPanel({ kind: 'renameFolder', folderId: current.id }))}>Rename</button>
                  {tab?.url && patternForHost(tab.url) ? <button onClick={() => mapToSite(current.id)}>Map to {parseUrl(tab.url)?.hostname}</button> : null}
                  <button onClick={() => (setMenuOpen(false), openOptions(`#folder=${current.id}`))}>Edit URL patterns…</button>
                  <hr />
                  <button class="danger" onClick={() => (setMenuOpen(false), setPanel({ kind: 'deleteFolder', folderId: current.id }))}>
                    Delete folder…
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <button class="btn btn-sm" onClick={() => setPanel({ kind: 'newFolder', parentId: null })}>
              + Folder
            </button>
          )}
        </div>
      ) : null}

      {chip || (state.localOnly.size && !query) ? (
        <div class="chip-row">
          {chip}
          {current && state.localOnly.has(current.id) ? (
            <span class="badge badge-warn" title="Sync storage is full; this folder is saved on this device only.">
              Local only, not syncing
            </span>
          ) : null}
        </div>
      ) : null}

      {suggest && !query ? (
        <div class="notice notice-info suggest">
          <span class="txt">
            Map <b>{folders.find((f) => f.id === suggest.folderId)?.name}</b> to <code>{suggest.host}</code>?
          </span>
          <button class="btn btn-sm btn-primary" onClick={() => mapToSite(suggest.folderId)}>
            Map
          </button>
          <button
            class="btn btn-sm btn-ghost"
            onClick={() => {
              void markSuggested(session, suggest.host);
              setSuggest(null);
            }}
          >
            No
          </button>
        </div>
      ) : null}

      {toast ? <div class="notice notice-warn" style={{ margin: '0 10px 4px' }}>{toast}</div> : null}

      {panel.kind === 'newSnippet' || panel.kind === 'editSnippet' ? (
        <div class="panel">
          <h3>{panel.kind === 'newSnippet' ? 'New snippet' : 'Edit snippet'}</h3>
          <SnippetEditor
            compact
            warnOnSecrets={settings?.warnOnSecretShapedValues ?? true}
            initial={panel.kind === 'editSnippet' ? store.getFolder(panel.folderId)?.snippets.find((s) => s.id === panel.snippetId) : undefined}
            onSave={(d) => saveSnippet(panel.folderId, d, panel.kind === 'editSnippet' ? panel.snippetId : undefined)}
            onCancel={() => (setPanel({ kind: 'none' }), searchRef.current?.focus())}
            onDelete={panel.kind === 'editSnippet' ? () => deleteSnippet(panel.folderId, panel.snippetId) : undefined}
          />
        </div>
      ) : panel.kind === 'newFolder' || panel.kind === 'renameFolder' ? (
        <NamePanel
          title={panel.kind === 'newFolder' ? (panel.parentId ? `New sub-folder in ${folders.find((f) => f.id === panel.parentId)?.name}` : 'New folder') : 'Rename folder'}
          initial={panel.kind === 'renameFolder' ? store.getFolder(panel.folderId)?.name ?? '' : ''}
          onSave={(name) => (panel.kind === 'newFolder' ? createFolder(panel.parentId, name) : renameFolder(panel.folderId, name))}
          onCancel={() => (setPanel({ kind: 'none' }), searchRef.current?.focus())}
        />
      ) : panel.kind === 'deleteFolder' ? (
        <DeletePanel
          folder={store.getFolder(panel.folderId)!}
          childCount={childrenOf(folders, panel.folderId).length}
          onCascade={() => removeFolder(panel.folderId, false)}
          onPromote={() => removeFolder(panel.folderId, true)}
          onCancel={() => setPanel({ kind: 'none' })}
        />
      ) : null}

      {panel.kind === 'none' ? (
        <>
          {current && !query ? (
            <div class="toolbar">
              <button class="btn btn-sm" onClick={() => setPanel({ kind: 'newSnippet', folderId: current.id })}>
                + Snippet
              </button>
              {childrenOf(folders, current.id).length ? (
                <label class="hint" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={!!current.rollUpDescendants}
                    onChange={(e) => store.upsertFolder({ ...current, rollUpDescendants: (e.target as HTMLInputElement).checked })}
                  />
                  Show all in this folder
                </label>
              ) : null}
              <span class="spacer" />
              <select class="input" style={{ width: 'auto' }} value={sortMode} onChange={(e) => store.updateSettings({ sortMode: (e.target as HTMLSelectElement).value as typeof sortMode })} title="Sort order">
                <option value="manual">Manual order</option>
                <option value="mostUsed">Most used</option>
                <option value="recent">Recently used</option>
              </select>
            </div>
          ) : null}

          <div class="scroll list" ref={listRef} role="listbox">
            {noFolders ? (
              <div class="empty">
                <strong>No folders yet</strong>
                Create a folder, add a few commands, then map the folder to the admin sites where you use them.
                <div style={{ marginTop: 10 }}>
                  <button class="btn btn-primary" onClick={() => setPanel({ kind: 'newFolder', parentId: null })}>
                    Create your first folder
                  </button>
                </div>
              </div>
            ) : items.length === 0 ? (
              <div class="empty">{query ? <>No snippets match “{query}”.</> : <>This folder is empty. Add a snippet with <b>+ Snippet</b>.</>}</div>
            ) : (
              items.map((it, i) => {
                if (it.kind === 'header') return <div key={it.key} class="group-header">{it.label}</div>;
                const selIdx = selectable.indexOf(i);
                const isActive = selIdx === active;
                if (it.kind === 'folder') {
                  const kids = childrenOf(folders, it.folder.id).length;
                  return (
                    <div key={it.key} data-index={i} class={`row ${isActive ? 'active' : ''}`} role="option" aria-selected={isActive} onMouseEnter={() => setActive(selIdx)} onClick={() => void enterFolder(it.folder.id)}>
                      <span class="folder-icon">▸</span>
                      <div class="main">
                        <div class="title">{it.folder.name}</div>
                        <div class="sub">
                          {it.folder.snippets.length} snippet{it.folder.snippets.length === 1 ? '' : 's'}
                          {kids ? ` · ${kids} sub-folder${kids === 1 ? '' : 's'}` : ''}
                          {it.folder.urlPatterns.length ? ` · ${it.folder.urlPatterns.length} URL pattern${it.folder.urlPatterns.length === 1 ? '' : 's'}` : ''}
                        </div>
                      </div>
                      {state.localOnly.has(it.folder.id) ? <span class="badge badge-warn local-badge">local</span> : null}
                      <span class="chev">›</span>
                    </div>
                  );
                }
                const s = it.snippet;
                return (
                  <div
                    key={it.key}
                    data-index={i}
                    class={`row ${isActive ? 'active' : ''} ${copiedId === s.id ? 'copied-flash' : ''}`}
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setActive(selIdx)}
                    onClick={() => void copySnippet(s, it.folder, false)}
                    title={s.value}
                  >
                    <div class="main">
                      {s.label ? <div class="title">{s.label}</div> : null}
                      <div class={s.label ? 'sub value' : 'value'}>{s.value.replace(/\s+/g, ' ')}</div>
                      {it.path ? <div class="sub">{it.path}</div> : null}
                    </div>
                    {copiedId === s.id ? <span class="copied">Copied</span> : null}
                    <div class="actions">
                      <button
                        class="btn btn-ghost btn-sm"
                        title="Edit"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPanel({ kind: 'editSnippet', folderId: it.folder.id, snippetId: s.id });
                        }}
                      >
                        ✎
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : null}

      <div class="footer">
        <span class="disclosure">{PLAINTEXT_DISCLOSURE}</span>
      </div>
    </div>
  );
}

function NamePanel({ title, initial, onSave, onCancel }: { title: string; initial: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  return (
    <form
      class="panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name.trim());
      }}
      onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), onCancel())}
    >
      <h3>{title}</h3>
      <input class="input" value={name} maxLength={60} autoFocus placeholder="Folder name" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      <div class="row-actions">
        <button type="button" class="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" class="btn btn-primary" disabled={!name.trim()}>
          Save
        </button>
      </div>
    </form>
  );
}

function DeletePanel({ folder, childCount, onCascade, onPromote, onCancel }: { folder: Folder; childCount: number; onCascade: () => void; onPromote: () => void; onCancel: () => void }) {
  return (
    <div class="panel" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <h3>Delete “{folder.name}”?</h3>
      <p class="hint">
        {folder.snippets.length} snippet{folder.snippets.length === 1 ? '' : 's'}
        {childCount ? ` and ${childCount} sub-folder${childCount === 1 ? '' : 's'} with their snippets` : ''} will be removed. Export a backup first if unsure.
      </p>
      <div class="row-actions">
        <button class="btn" onClick={onCancel} autoFocus>
          Cancel
        </button>
        {childCount ? (
          <button class="btn" onClick={onPromote}>
            Delete, move sub-folders to top level
          </button>
        ) : null}
        <button class="btn btn-danger" onClick={onCascade}>
          Delete{childCount ? ' everything' : ''}
        </button>
      </div>
    </div>
  );
}
