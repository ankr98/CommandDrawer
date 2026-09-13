import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../shared/store';
import { assetUrl } from '../shared/browser';
import { FoldersTab } from './FoldersTab';
import { SettingsTab } from './SettingsTab';
import { TransferTab } from './TransferTab';
import { AboutTab } from './AboutTab';

type Tab = 'folders' | 'settings' | 'transfer' | 'about';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'folders', label: 'Folders & URL patterns' },
  { id: 'settings', label: 'Settings & storage' },
  { id: 'transfer', label: 'Import / export' },
  { id: 'about', label: 'About' },
];

function readHash(): { tab: Tab; folder: string | null } {
  const h = location.hash.replace(/^#/, '');
  const params = new URLSearchParams(h);
  if (params.has('folder')) return { tab: 'folders', folder: params.get('folder') };
  if (h === 'settings' || h === 'transfer' || h === 'about') return { tab: h, folder: null };
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
        <img class="logo" src={assetUrl('icons/icon-48.png')} alt="" width={38} height={38} />
        <div>
          <h1>Command Drawer</h1>
          <span class="tagline">Reusable commands for people who administer things.</span>
        </div>
      </div>
      <div class="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} class={tab === t.id ? 'active' : ''} onClick={() => go(t.id, t.id === 'folders' ? folder : null)}>
            {t.label}
          </button>
        ))}
      </div>
      {toast ? <div class={`notice ${toast.kind === 'ok' ? 'notice-info' : 'notice-warn'}`}>{toast.msg}</div> : null}
      {tab === 'about' ? (
        <AboutTab />
      ) : !state ? (
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
