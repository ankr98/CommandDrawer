import { useEffect, useState } from 'preact/hooks';
import type { LoadedState, SnippetStore, Usage } from '../lib/storage';
import { PLAINTEXT_DISCLOSURE } from '../lib/guards';
import { formatBytes, isEdge, openShortcutSettings, openSyncSettings } from '../shared/browser';

export function SettingsTab({ store, state, notify }: { store: SnippetStore; state: LoadedState; notify: (m: string, k?: 'ok' | 'warn') => void }) {
  const s = state.meta.settings;
  const [usage, setUsage] = useState<Usage | null>(null);
  const refresh = () => void store.usage().then(setUsage);
  useEffect(refresh, [state.folders, store]);

  return (
    <>
      <div class="card">
        <h2>Behaviour</h2>
        <div class="setting">
          <div class="k">
            Sort snippets by<small>Manual order is the order you arrange in the folder editor.</small>
          </div>
          <select class="input" style={{ width: 'auto' }} value={s.sortMode} onChange={(e) => store.updateSettings({ sortMode: (e.target as HTMLSelectElement).value as typeof s.sortMode })}>
            <option value="manual">Manual order</option>
            <option value="mostUsed">Most used</option>
            <option value="recent">Recently used</option>
          </select>
        </div>
        <div class="setting">
          <div class="k">Theme</div>
          <select class="input" style={{ width: 'auto' }} value={s.theme} onChange={(e) => store.updateSettings({ theme: (e.target as HTMLSelectElement).value as typeof s.theme })}>
            <option value="system">Follow system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div class="setting">
          <div class="k">
            Warn about credential-shaped values<small>Flags known token formats (JWTs, GitHub/AWS/Slack keys, private-key blocks, connection-string passwords) while you type. Inline only; it never blocks saving. This is a nudge, not a security control.</small>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={s.warnOnSecretShapedValues} onChange={(e) => store.updateSettings({ warnOnSecretShapedValues: (e.target as HTMLInputElement).checked })} />
            Enabled
          </label>
        </div>
        <div class="setting">
          <div class="k">
            Keyboard shortcut<small>Opens the popup without the mouse. Rebind it in the browser's extension shortcut settings.</small>
          </div>
          <div>
            <span class="kbd">Ctrl+Shift+Y</span> <span class="hint">(Cmd+Shift+Y on macOS)</span>{' '}
            <button class="btn btn-sm" style={{ marginLeft: 8 }} onClick={openShortcutSettings}>
              Change…
            </button>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Storage and sync</h2>
        <p class="hint" style={{ marginTop: 0 }}>{PLAINTEXT_DISCLOSURE}</p>
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
            {state.localOnly.size} folder{state.localOnly.size === 1 ? ' is' : 's are'} saved on this device only because sync storage was full:{' '}
            {[...state.localOnly].map((id) => state.folders.find((f) => f.id === id)?.name ?? id).join(', ')}. Free some space (or export and trim) and retry.
            <div style={{ marginTop: 6 }}>
              <button
                class="btn btn-sm"
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
            Sync status<small>Data is synced by {isEdge() ? 'Edge' : 'Chrome'} profile sync when you are signed in and extension sync is on. The extension cannot see whether that is the case; if you are not signed in, snippets stay on this device. On a work profile this can also be controlled by your organisation's policy.</small>
          </div>
          <div>
            <button class="btn btn-sm" onClick={openSyncSettings}>
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
