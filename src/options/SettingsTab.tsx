import { useEffect, useState } from 'preact/hooks';
import type { LoadedState, SnippetStore, Usage } from '../lib/storage';
import type { Settings } from '../lib/schema';
import { PLAINTEXT_DISCLOSURE } from '../lib/guards';
import { formatBytes, isEdge, openShortcutSettings, openSyncSettings } from '../shared/browser';
import { IconKeyboard, IconLockOpen } from '../shared/icons';

export function SettingsTab({ store, state, notify }: { store: SnippetStore; state: LoadedState; notify: (m: string, k?: 'ok' | 'warn') => void }) {
  const s = state.meta.settings;
  const set = (patch: Partial<Settings>) => store.updateSettings(patch);
  const [usage, setUsage] = useState<Usage | null>(null);
  const refresh = () => void store.usage().then(setUsage);
  useEffect(refresh, [state.folders, store]);

  return (
    <>
      <div class="card">
        <h2>Behaviour</h2>

        <div class="setting">
          <div class="k">
            Folder order<small>How folders are listed in the drawer, the options page and the right-click menu.</small>
          </div>
          <select class="input" style={{ width: 'auto' }} value={s.folderSort} onChange={(e) => set({ folderSort: (e.target as HTMLSelectElement).value as Settings['folderSort'] })}>
            <option value="alpha">Alphabetical (A-Z)</option>
            <option value="manual">Manual (drag to arrange)</option>
          </select>
        </div>

        <div class="setting">
          <div class="k">
            Snippet order<small>How snippets are ordered when a folder opens.</small>
          </div>
          <select class="input" style={{ width: 'auto' }} value={s.sortMode} onChange={(e) => set({ sortMode: (e.target as HTMLSelectElement).value as Settings['sortMode'] })}>
            <option value="manual">Manual order</option>
            <option value="mostUsed">Most used</option>
            <option value="recent">Recently used</option>
          </select>
        </div>

        <div class="setting">
          <div class="k">
            When I change the sort in the drawer<small>What happens after you pick a different order from the Sort menu.</small>
          </div>
          <div class="radio-group">
            <label>
              <input type="radio" name="sortPersist" checked={s.sortPersist} onChange={() => set({ sortPersist: true })} /> Keep it until I change it again
            </label>
            <label>
              <input type="radio" name="sortPersist" checked={!s.sortPersist} onChange={() => set({ sortPersist: false })} /> Go back to the default for the next folder
            </label>
          </div>
        </div>

        <div class="setting">
          <div class="k">
            Remember my folder per site<small>Keep showing the folder you picked for a site, in that tab. Off: always open the best match.</small>
          </div>
          <label class="check">
            <input type="checkbox" checked={s.rememberPerSite} onChange={(e) => set({ rememberPerSite: (e.target as HTMLInputElement).checked })} />
            Enabled
          </label>
        </div>

        <div class="setting">
          <div class="k">
            Right-click menu<small>Adds "Command Drawer" to the page's right-click menu. Snippets are listed by label.</small>
          </div>
          <select class="input" style={{ width: 'auto' }} value={s.contextMenu} onChange={(e) => set({ contextMenu: (e.target as HTMLSelectElement).value as Settings['contextMenu'] })}>
            <option value="matched">Folders matching the page first</option>
            <option value="all">All folders, from the top</option>
            <option value="off">Off</option>
          </select>
        </div>

        <div class="setting">
          <div class="k">
            Right-click in a text field<small>Paste the snippet where you right-clicked, and copy it too. Off: copy only.</small>
          </div>
          <label class="check">
            <input type="checkbox" checked={s.contextMenuInsert} disabled={s.contextMenu === 'off'} onChange={(e) => set({ contextMenuInsert: (e.target as HTMLInputElement).checked })} />
            Paste into the field
          </label>
        </div>

        <div class="setting">
          <div class="k">Theme</div>
          <select class="input" style={{ width: 'auto' }} value={s.theme} onChange={(e) => set({ theme: (e.target as HTMLSelectElement).value as Settings['theme'] })}>
            <option value="system">Follow system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>

        <div class="setting">
          <div class="k">
            Keyboard shortcut<small>Opens Command Drawer. Change it in the browser's shortcut settings.</small>
          </div>
          <div class="inline">
            <IconKeyboard size={15} />
            <span class="kbd">Ctrl+Shift+Y</span>
            <span class="hint">(Cmd+Shift+Y on macOS)</span>
            <button class="btn" onClick={openShortcutSettings}>
              Change…
            </button>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Storage and sync</h2>
        <div class="notice notice-warn" style={{ marginTop: 0, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <IconLockOpen size={15} />
          <span>{PLAINTEXT_DISCLOSURE}</span>
        </div>
        {usage ? (
          <>
            <div class={`meter ${usage.percent >= 85 ? 'warn' : ''}`}>
              <div style={{ width: `${usage.percent}%` }} />
            </div>
            <div class="hint">
              {usage.percent}% of sync storage used — {formatBytes(usage.syncBytes)} of {formatBytes(usage.syncQuotaBytes)}, {usage.syncItems} of {usage.syncMaxItems} items.
            </div>
          </>
        ) : null}
        {state.localOnly.size ? (
          <div class="notice notice-warn">
            Sync storage was full, so {state.localOnly.size === 1 ? 'this folder is' : 'these folders are'} saved on this device only: {[...state.localOnly].map((id) => state.folders.find((f) => f.id === id)?.name ?? id).join(', ')}. Free some space and retry.
            <div style={{ marginTop: 8 }}>
              <button
                class="btn"
                onClick={() =>
                  void store.retrySync().then((n) => {
                    notify(n ? `${n} folder${n === 1 ? '' : 's'} moved back into sync.` : 'Still not enough sync space.', n ? 'ok' : 'warn');
                    refresh();
                  })
                }
              >
                Retry sync
              </button>
            </div>
          </div>
        ) : null}
        <div class="setting">
          <div class="k">
            Sync status<small>Synced through your {isEdge() ? 'Edge' : 'Chrome'} profile when you are signed in and extension sync is on. Otherwise snippets stay on this device.</small>
          </div>
          <div>
            <button class="btn" onClick={openSyncSettings}>
              Open browser sync settings
            </button>
          </div>
        </div>
        {state.warnings.length ? (
          <div class="notice notice-info">
            <b>Recovery notes from the last load:</b>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {state.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </>
  );
}
