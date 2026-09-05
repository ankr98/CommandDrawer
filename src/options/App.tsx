import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../shared/store';
import { FoldersTab } from './FoldersTab';
import { SettingsTab } from './SettingsTab';
import { TransferTab } from './TransferTab';

type Tab = 'folders' | 'settings' | 'transfer';

function readHash(): { tab: Tab; folder: string | null } {
  const h = location.hash.replace(/^#/, '');
  const params = new URLSearchParams(h);
  if (params.has('folder')) return { tab: 'folders', folder: params.get('folder') };
  if (h === 'settings' || h === 'transfer') return { tab: h, folder: null };
  return { tab: 'folders', folder: null };
}

export function App() {
  const { store, state } = useStore();
  const [{ tab, folder }, setRoute] = useState(readHash);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'warn' } | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (t: Tab, f: string | null = null) => {
    location.hash = t === 'folders' ? (f ? `folder=${f}` : '') : t;
    setRoute({ tab: t, folder: f });
  };

  const notify = (msg: string, kind: 'ok' | 'warn' = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <div class="options">
      <div class="topbar">
        <h1>Command Drawer</h1>
        <span class="tagline">Reusable commands for people who administer things. Not a secret store.</span>
      </div>
      <div class="tabs">
        <button class={tab === 'folders' ? 'active' : ''} onClick={() => go('folders', folder)}>
          Folders &amp; URL patterns
        </button>
        <button class={tab === 'settings' ? 'active' : ''} onClick={() => go('settings')}>
          Settings &amp; storage
        </button>
        <button class={tab === 'transfer' ? 'active' : ''} onClick={() => go('transfer')}>
          Import / export
        </button>
      </div>
      {toast ? <div class={`notice ${toast.kind === 'ok' ? 'notice-info' : 'notice-warn'}`}>{toast.msg}</div> : null}
      {!state ? (
        <div class="empty">Loading…</div>
      ) : tab === 'folders' ? (
        <FoldersTab store={store} state={state} selectedId={folder} onSelect={(id) => go('folders', id)} notify={notify} />
      ) : tab === 'settings' ? (
        <SettingsTab store={store} state={state} notify={notify} />
      ) : (
        <TransferTab store={store} state={state} notify={notify} />
      )}
    </div>
  );
}
