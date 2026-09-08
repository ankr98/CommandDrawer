/** Thin wrappers over chrome.* so components stay testable in spirit. */

export interface ActiveTab {
  id: number | null;
  url: string | null;
}

/** Active tab in the current window. URL is available thanks to activeTab (granted on the click). */
export async function getActiveTab(): Promise<ActiveTab> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return { id: tab?.id ?? null, url: tab?.url ?? tab?.pendingUrl ?? null };
  } catch {
    return { id: null, url: null };
  }
}

export function openOptions(hash?: string): void {
  if (hash) {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`src/options/index.html${hash}`) });
  } else {
    void chrome.runtime.openOptionsPage();
  }
}

export function isEdge(): boolean {
  return /Edg\//.test(navigator.userAgent);
}

export function openSyncSettings(): void {
  void chrome.tabs.create({ url: isEdge() ? 'edge://settings/profiles/sync' : 'chrome://settings/syncSetup' });
}

export function openShortcutSettings(): void {
  void chrome.tabs.create({ url: isEdge() ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' });
}

/** URL of a packaged asset (icons/…). Falls back to a root-relative path outside an extension context. */
export function assetUrl(path: string): string {
  try {
    return chrome.runtime.getURL(path);
  } catch {
    return '/' + path;
  }
}

/** Version from the manifest, or '' when unavailable. */
export function appVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '';
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}
