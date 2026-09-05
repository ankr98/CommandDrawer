/** Singleton SnippetStore for extension contexts + a Preact hook. */
import { useEffect, useState } from 'preact/hooks';
import { chromeAreas, SnippetStore, type LoadedState } from '../lib/storage';

let store: SnippetStore | null = null;
let loading: Promise<LoadedState> | null = null;

export function getStore(): SnippetStore {
  if (!store) {
    store = new SnippetStore(chromeAreas());
    // Re-read when another context (options page, popup, another synced device) writes.
    let timer: ReturnType<typeof setTimeout> | null = null;
    chrome.storage.onChanged.addListener((_changes, area) => {
      if (area !== 'sync' && area !== 'local') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void store?.load(), 250);
    });
    // Flush pending writes if the page is going away.
    window.addEventListener('pagehide', () => void store?.flush());
  }
  return store;
}

export function ensureLoaded(): Promise<LoadedState> {
  const s = getStore();
  if (s.isLoaded()) return Promise.resolve(s.snapshot());
  if (!loading) loading = s.load();
  return loading;
}

export function useStore(): { store: SnippetStore; state: LoadedState | null } {
  const s = getStore();
  const [state, setState] = useState<LoadedState | null>(s.isLoaded() ? s.snapshot() : null);
  useEffect(() => {
    const unsub = s.subscribe(setState);
    void ensureLoaded().then(setState);
    return unsub;
  }, [s]);
  return { store: s, state };
}
