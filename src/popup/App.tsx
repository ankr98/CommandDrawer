import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { newFolder, newSnippet, type Folder, type Snippet, type SortMode } from '../lib/schema';
import { canCreateUnder, childrenOf, deleteAndPromoteChildren, deleteCascade, nextOrder, pathOf, rollUp, rootFolders } from '../lib/tree';
import { bestMatch, originOf, parseUrl, patternForHost, resolveFolder, ROOT_OVERRIDE } from '../lib/matcher';
import { chromeSession, clearOverride, getOverride, rememberLastUrl, setOverride } from '../lib/session';
import { searchSnippets, sortSnippets, type SearchHit } from '../lib/search';
import { copyText } from '../lib/clipboard';
import { FOOTER_DISCLOSURE } from '../lib/guards';
import { useStore } from '../shared/store';
import { getActiveTab, openOptions, type ActiveTab } from '../shared/browser';
import { SnippetEditor } from '../shared/SnippetEditor';
import { IconCheck, IconChevronLeft, IconChevronRight, IconFolder, IconLockOpen, IconMore, IconPencil, IconPlus, IconSearch, IconSettings, IconSort } from '../shared/icons';

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

const SORT_OPTIONS: Array<{ id: SortMode; label: string }> = [
  { id: 'manual', label: 'Manual order' },
  { id: 'mostUsed', label: 'Most used' },
  { id: 'recent', label: 'Recently used' },
];

const session = chromeSession();

export function App() {
  const { store, state } = useStore();
  const [tab, setTab] = useState<ActiveTab | null>(null);
  const [ready, setReady] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [suggest, setSuggest] = useState<{ host: string; folderId: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [sessionSort, setSessionSort] = useState<SortMode | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const initialised = useRef(false);

  const folders = state?.folders ?? [];
  const settings = state?.meta.settings;
  const remember = settings?.rememberPerSite ?? true;
  const folderSort = settings?.folderSort ?? 'alpha';
  const origin = originOf(tab?.url);

  // Initial resolution: remembered pick (if enabled) → auto-match → root.
  useEffect(() => {
    if (!state || initialised.current) return;
    initialised.current = true;
    (async () => {
      const t = await getActiveTab();
      setTab(t);
      if (t.url) void rememberLastUrl(session, t.url);
      const o = originOf(t.url);
      const override = state.meta.settings.rememberPerSite && t.id !== null && o ? await getOverride(session, t.id, o) : null;
      setViewId(resolveFolder(state.folders, t.url, override).folderId);
      setReady(true);
    })();
  }, [state]);

  // Focus the search box as soon as the main view is mounted .
  useEffect(() => {
    if (ready) searchRef.current?.focus();
  }, [ready]);

  // If the folder being viewed disappears (deleted elsewhere), fall back to root.
  useEffect(() => {
    if (viewId && state && !state.folders.some((f) => f.id === viewId)) setViewId(null);
  }, [state, viewId]);

  // The mapping offer belongs to the folder it was made for.
  useEffect(() => {
    if (suggest && viewId !== suggest.folderId) setSuggest(null);
  }, [viewId, suggest]);

  // A session-only sort choice lasts until another folder opens.
  useEffect(() => setSessionSort(null), [viewId]);

  const current = viewId ? folders.find((f) => f.id === viewId) ?? null : null;
  const crumbs = current ? pathOf(folders, current.id) : [];

  const defaultSort: SortMode = settings?.sortMode ?? 'manual';
  const sortPersist = settings?.sortPersist ?? true;
  const sortMode: SortMode = sortPersist ? defaultSort : (sessionSort ?? defaultSort);
  const chooseSort = (m: SortMode) => {
    setSortOpen(false);
    if (sortPersist) store.updateSettings({ sortMode: m });
    else setSessionSort(m);
    searchRef.current?.focus();
  };

  const items: Item[] = useMemo(() => {
    const q = query.trim();
    if (q) {
      return searchSnippets(folders, q).map((h: SearchHit) => ({ kind: 'snippet', snippet: h.snippet, folder: h.folder, path: h.path, key: `s:${h.snippet.id}` }));
    }
    if (!current) return rootFolders(folders, folderSort).map((f) => ({ kind: 'folder', folder: f, key: `f:${f.id}` }));
    const kids = childrenOf(folders, current.id, folderSort);
    const roll = !!current.rollUpDescendants && kids.length > 0;
    const groups = roll ? rollUp(folders, current.id, folderSort).filter((g) => g.snippets.length) : [];
    const hasSnippets = roll ? groups.length > 0 : current.snippets.length > 0;
    const out: Item[] = [];
    // Headers only when both kinds are present, so folders and snippets read as two groups.
    if (kids.length && hasSnippets) out.push({ kind: 'header', label: 'Sub-folders', key: 'h:folders' });
    for (const f of kids) out.push({ kind: 'folder', folder: f, key: `f:${f.id}` });
    if (roll) {
      for (const g of groups) {
        out.push({ kind: 'header', label: g.folder.id === current.id ? current.name : g.path, key: `h:${g.folder.id}` });
        for (const s of sortSnippets(g.snippets, sortMode)) out.push({ kind: 'snippet', snippet: s, folder: g.folder, key: `s:${s.id}` });
      }
    } else {
      if (kids.length && hasSnippets) out.push({ kind: 'header', label: 'Snippets', key: 'h:snippets' });
      for (const s of sortSnippets(current.snippets, sortMode)) out.push({ kind: 'snippet', snippet: s, folder: current, key: `s:${s.id}` });
    }
    return out;
  }, [folders, current, query, sortMode, folderSort]);

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

  /** Remember the manual pick for this tab + site , when the setting allows. */
  const pin = useCallback(
    async (folderId: string | null) => {
      if (!remember || tab?.id === null || tab?.id === undefined || !origin) return;
      await setOverride(session, tab.id, origin, folderId ?? ROOT_OVERRIDE);
    },
    [tab, origin, remember],
  );

  const enterFolder = useCallback(
    async (id: string) => {
      setViewId(id);
      setQuery('');
      setMenuOpen(false);
      setSortOpen(false);
      searchRef.current?.focus();
      await pin(id);
    },
    [pin],
  );

  const goUp = useCallback(async () => {
    const parentId = current?.parentId ?? null;
    setViewId(parentId);
    setQuery('');
    searchRef.current?.focus();
    await pin(parentId);
  }, [current, pin]);

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
    // Offer to map the new folder to this site, once, when no folder matches it yet.
    const host = tab?.url ? parseUrl(tab.url)?.hostname : undefined;
    if (tab?.url && host && patternForHost(tab.url) && !/^(localhost|127\.)/.test(host) && !bestMatch(folders, tab.url)) {
      setSuggest({ host, folderId: f.id });
    }
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
    // The site now auto-matches this folder; drop the remembered pick so auto-matching reflects reality.
    if (tab?.id !== null && tab?.id !== undefined && origin) void clearOverride(session, tab.id, origin);
    showToast(`"${f.name}" now opens on ${parseUrl(tab?.url ?? '')?.hostname ?? 'this site'}`);
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
      else if (sortOpen) setSortOpen(false);
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

  if (!state || !ready) {
    return (
      <div class="popup">
        <div class="empty">Loading…</div>
      </div>
    );
  }

  const noFolders = folders.length === 0;

  return (
    <div class="popup" onKeyDown={onKeyDown}>
      <div class="header">
        <div class="search-wrap">
          <IconSearch size={15} />
          <input
            ref={searchRef}
            class="input"
            type="search"
            placeholder={current ? 'Search…  (Backspace goes up)' : 'Search all snippets…'}
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            aria-label="Search snippets"
            autoComplete="off"
            spellcheck={false}
          />
        </div>
        <button class="btn settings-btn" title="Settings: folders, URL patterns, import/export" onClick={() => openOptions()}>
          <IconSettings size={17} />
          <span>Settings</span>
        </button>
      </div>

      {!query ? (
        <div class="crumbs">
          <button class={`crumb ${!current ? 'current' : 'back'}`} onClick={() => (current ? void (setViewId(null), pin(null)) : undefined)} title={current ? 'Back to all folders' : undefined}>
            {current ? <IconChevronLeft size={14} /> : null}
            <span>{current ? 'All' : 'All folders'}</span>
          </button>
          {crumbs.map((c, i) => (
            <span key={c.id} style={{ display: 'contents' }}>
              <span class="sep">/</span>
              <button class={`crumb ${i === crumbs.length - 1 ? 'current' : ''}`} onClick={() => i < crumbs.length - 1 && void enterFolder(c.id)}>
                <span>{c.name}</span>
              </button>
            </span>
          ))}
          <span class="spacer" />
          {current && state.localOnly.has(current.id) ? (
            <span class="badge badge-warn local-badge" title="Sync storage is full; this folder is saved on this device only.">
              Local only
            </span>
          ) : null}
          {current ? (
            <div class="menu">
              <button class="btn btn-ghost icon-btn" onClick={() => setMenuOpen((m) => !m)} aria-label="Folder actions" title="Folder actions">
                <IconMore size={16} />
              </button>
              {menuOpen ? (
                <div class="menu-list" onMouseLeave={() => setMenuOpen(false)}>
                  <button onClick={() => (setMenuOpen(false), setPanel({ kind: 'newSnippet', folderId: current.id }))}>Add snippet</button>
                  {current.parentId === null ? <button onClick={() => (setMenuOpen(false), setPanel({ kind: 'newFolder', parentId: current.id }))}>Add sub-folder</button> : null}
                  <button onClick={() => (setMenuOpen(false), setPanel({ kind: 'renameFolder', folderId: current.id }))}>Rename</button>
                  {tab?.url && patternForHost(tab.url) ? <button onClick={() => mapToSite(current.id)}>Open here on {parseUrl(tab.url)?.hostname}</button> : null}
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
              <IconPlus size={13} /> Folder
            </button>
          )}
        </div>
      ) : null}

      {suggest && !query && viewId === suggest.folderId ? (
        <div class="notice notice-info suggest">
          <span class="txt">
            Open this folder whenever you are on <b>{suggest.host}</b>?
          </span>
          <button class="btn btn-sm btn-primary" onClick={() => mapToSite(suggest.folderId)}>
            Yes
          </button>
          <button class="btn btn-sm btn-ghost" onClick={() => setSuggest(null)}>
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
                <IconPlus size={13} /> Snippet
              </button>
              {childrenOf(folders, current.id).length ? (
                <label class="hint">
                  <input
                    type="checkbox"
                    checked={!!current.rollUpDescendants}
                    onChange={(e) => store.upsertFolder({ ...current, rollUpDescendants: (e.target as HTMLInputElement).checked })}
                  />
                  Include sub-folder snippets
                </label>
              ) : null}
              <span class="spacer" />
              <div class="menu">
                <button class="btn btn-sm btn-ghost" onClick={() => setSortOpen((o) => !o)} aria-haspopup="menu" aria-expanded={sortOpen} title="Sort snippets">
                  <IconSort size={14} /> Sort
                </button>
                {sortOpen ? (
                  <div class="menu-list" role="menu" onMouseLeave={() => setSortOpen(false)}>
                    {SORT_OPTIONS.map((o) => (
                      <button key={o.id} role="menuitemradio" aria-checked={sortMode === o.id} class={sortMode === o.id ? 'checked' : ''} onClick={() => chooseSort(o.id)}>
                        <IconCheck size={14} class={sortMode === o.id ? '' : 'blank'} />
                        {o.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div class="scroll list" ref={listRef} role="listbox">
            {noFolders ? (
              <div class="empty">
                <IconFolder size={30} />
                <strong>No folders yet</strong>
                Create a folder, add a few commands, then map the folder to the admin sites where you use them.
                <div style={{ marginTop: 10 }}>
                  <button class="btn btn-primary" onClick={() => setPanel({ kind: 'newFolder', parentId: null })}>
                    Create your first folder
                  </button>
                </div>
              </div>
            ) : items.length === 0 ? (
              <div class="empty">{query ? <>No snippets match “{query}”.</> : <>This folder is empty. Add one with the <b>+ Snippet</b> button.</>}</div>
            ) : (
              items.map((it, i) => {
                if (it.kind === 'header') return <div key={it.key} class="group-header">{it.label}</div>;
                const selIdx = selectable.indexOf(i);
                const isActive = selIdx === active;
                if (it.kind === 'folder') {
                  const kids = childrenOf(folders, it.folder.id).length;
                  return (
                    <div key={it.key} data-index={i} class={`row folder ${isActive ? 'active' : ''}`} role="option" aria-selected={isActive} onMouseEnter={() => setActive(selIdx)} onClick={() => void enterFolder(it.folder.id)}>
                      <span class="folder-badge">
                        <IconFolder size={15} />
                      </span>
                      <div class="main">
                        <div class="title">{it.folder.name}</div>
                        <div class="sub">
                          {it.folder.snippets.length} snippet{it.folder.snippets.length === 1 ? '' : 's'}
                          {kids ? ` · ${kids} sub-folder${kids === 1 ? '' : 's'}` : ''}
                          {it.folder.urlPatterns.length ? ` · ${it.folder.urlPatterns.length} URL pattern${it.folder.urlPatterns.length === 1 ? '' : 's'}` : ''}
                        </div>
                      </div>
                      {state.localOnly.has(it.folder.id) ? <span class="badge badge-warn local-badge">local</span> : null}
                      <IconChevronRight size={16} class="chev" />
                    </div>
                  );
                }
                const s = it.snippet;
                return (
                  <div
                    key={it.key}
                    data-index={i}
                    class={`row snippet ${isActive ? 'active' : ''} ${copiedId === s.id ? 'copied-flash' : ''}`}
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
                    {copiedId === s.id ? (
                      <span class="copied">
                        <IconCheck size={13} /> Copied
                      </span>
                    ) : null}
                    <div class="actions">
                      <button
                        class="btn btn-ghost icon-btn"
                        title="Edit"
                        aria-label="Edit snippet"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPanel({ kind: 'editSnippet', folderId: it.folder.id, snippetId: s.id });
                        }}
                      >
                        <IconPencil size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : null}

      <div class="footer" role="note">
        <IconLockOpen size={13} />
        <span class="disclosure">{FOOTER_DISCLOSURE}</span>
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
