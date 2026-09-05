import { useState } from 'preact/hooks';
import type { LoadedState, SnippetStore } from '../lib/storage';
import { exportToJson, importFromJson, type ImportMode } from '../lib/transfer';

export function TransferTab({ store, state, notify }: { store: SnippetStore; state: LoadedState; notify: (m: string, k?: 'ok' | 'warn') => void }) {
  const [mode, setMode] = useState<ImportMode>('merge');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const doExport = () => {
    const json = exportToJson(state.folders);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `command-drawer-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const applyImport = (json: string) => {
    try {
      const res = importFromJson(json, state.folders, mode);
      store.replaceFolders(res.folders);
      const parts = [`Imported ${res.added} folder${res.added === 1 ? '' : 's'}.`];
      if (res.skippedDepth) parts.push(`${res.skippedDepth} nested too deep and were skipped.`);
      notify(parts.join(' '), res.skippedDepth ? 'warn' : 'ok');
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'warn');
    }
    setPending(null);
    setConfirmReplace(false);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    if (mode === 'replace' && state.folders.length) {
      setPending(text);
      setConfirmReplace(true);
    } else applyImport(text);
  };

  return (
    <>
      <div class="card">
        <h2>Export</h2>
        <p class="hint" style={{ marginTop: 0 }}>
          Downloads a JSON file with every folder, sub-folder, URL pattern and snippet. This is your backup, and how you hand a set of commands to a colleague. Values are plaintext in the file, exactly as they are in the extension.
        </p>
        <button class="btn btn-primary" onClick={doExport} disabled={!state.folders.length}>
          Export {state.folders.length} folder{state.folders.length === 1 ? '' : 's'} as JSON
        </button>
      </div>
      <div class="card">
        <h2>Import</h2>
        <div class="setting">
          <div class="k">Mode</div>
          <div>
            <label style={{ display: 'block' }}>
              <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} /> Merge — add the file's folders alongside the existing ones
            </label>
            <label style={{ display: 'block' }}>
              <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace — delete everything first, then import
            </label>
          </div>
        </div>
        <div class="setting">
          <div class="k">File</div>
          <input type="file" accept="application/json,.json" onChange={(e) => void onFile((e.target as HTMLInputElement).files?.[0])} />
        </div>
        {confirmReplace && pending ? (
          <div class="notice notice-danger">
            This will delete your current {state.folders.length} folder{state.folders.length === 1 ? '' : 's'} before importing. Continue?
            <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
              <button class="btn btn-sm" onClick={() => (setConfirmReplace(false), setPending(null))}>
                Cancel
              </button>
              <button class="btn btn-sm btn-danger" onClick={() => applyImport(pending)}>
                Replace everything
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
