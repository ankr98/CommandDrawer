/**
 * Service worker. Deliberately small: no `tabs` permission is needed for
 * tabs.onRemoved (it only delivers the tab id), and the popup does the rest.
 *
 * It also owns the page right-click menu ("Command Drawer ▸ …"): rebuilt from
 * storage whenever data or settings change, and delivering the clicked snippet
 * inside the tab the user right-clicked — pasted into the field under the
 * cursor when there is one, and copied to the clipboard (activeTab + scripting,
 * no host permissions). Menu contents are page-aware through documentUrlPatterns, so
 * no URL is ever read here.
 */
import { chromeSession, clearTab } from '../lib/session';
import { chromeAreas, loadAll, SnippetStore } from '../lib/storage';
import { buildMenu, MENU_CONTEXTS, resolveMenuClick, type MenuItem } from '../lib/contextMenu';

// Registered at top level so the worker wakes up for it. Plan §5.3 cleanup.
chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTab(chromeSession(), tabId).catch(() => undefined);
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // First run: nothing to seed. Empty state in the popup explains the next step.
    console.info('[command-drawer] installed');
  }
  scheduleRebuild(0);
});

chrome.runtime.onStartup.addListener(() => scheduleRebuild(0));

// Any write from the popup, the options page or a synced device changes the menu.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'sync' || area === 'local') scheduleRebuild(300);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void onMenuClick(info, tab).catch((err) => console.warn('[command-drawer] menu click failed', err));
});

// ---- menu rebuild --------------------------------------------------------------

let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
let rebuilding: Promise<void> = Promise.resolve();

function scheduleRebuild(delayMs: number) {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    rebuilding = rebuilding.then(rebuildMenu).catch((err) => console.warn('[command-drawer] menu rebuild failed', err));
  }, delayMs);
}

async function rebuildMenu() {
  const state = await loadAll(chromeAreas());
  const items = buildMenu(state.folders, state.meta.settings);
  await removeAllItems();
  for (const item of items) await createItem(item);
}

function createItem(item: MenuItem): Promise<void> {
  const props: chrome.contextMenus.CreateProperties = {
    id: item.id,
    contexts: [...MENU_CONTEXTS],
    ...(item.parentId ? { parentId: item.parentId } : {}),
    ...(item.type === 'separator' ? { type: 'separator' } : { title: item.title }),
    ...(item.enabled === false ? { enabled: false } : {}),
    ...(item.documentUrlPatterns ? { documentUrlPatterns: item.documentUrlPatterns } : {}),
  };
  return new Promise((resolve) => {
    chrome.contextMenus.create(props, () => {
      const err = chrome.runtime.lastError;
      if (err) console.warn(`[command-drawer] menu item ${item.id} skipped: ${err.message}`);
      resolve();
    });
  });
}

function removeAllItems(): Promise<void> {
  return new Promise((resolve) => chrome.contextMenus.removeAll(() => resolve()));
}

// ---- menu click ----------------------------------------------------------------

async function onMenuClick(info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab | undefined) {
  const state = await loadAll(chromeAreas());
  const hit = resolveMenuClick(buildMenu(state.folders, state.meta.settings), state.folders, String(info.menuItemId));
  if (!hit) return;
  const tabId = tab?.id;
  const insert = !!info.editable && state.meta.settings.contextMenuInsert;
  const result = tabId !== undefined && tabId >= 0 ? await deliverInTab(tabId, info.frameId ?? 0, hit.snippet.value, insert) : { inserted: false, copied: false };
  flashBadge(tabId, result);
  if (result.inserted || result.copied) await recordUse(hit.folder.id, hit.snippet.id);
}

interface Delivery {
  inserted: boolean;
  copied: boolean;
}

/**
 * Deliver the snippet inside the frame the user right-clicked. The click grants
 * activeTab for that tab, and Chrome focuses an editable element on right-click,
 * so `document.activeElement` is the field. Insertion goes through
 * execCommand('insertText') so it lands in the undo stack and fires the input
 * events frameworks listen for; the clipboard is written as well, always.
 * Everything false on pages the browser will not let us touch.
 */
async function deliverInTab(tabId: number, frameId: number, text: string, insert: boolean): Promise<Delivery> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: async (value: string, wantInsert: boolean): Promise<Delivery> => {
        let inserted = false;
        if (wantInsert) {
          try {
            const el = document.activeElement as HTMLElement | null;
            const isTextInput = el instanceof HTMLInputElement && /^(?:text|search|url|tel|password|email|number)?$/i.test(el.type) && !el.readOnly && !el.disabled;
            const isTextArea = el instanceof HTMLTextAreaElement && !el.readOnly && !el.disabled;
            if (el && (isTextInput || isTextArea || el.isContentEditable)) {
              el.focus();
              // execCommand is legacy but still the only call that inserts through the
              // browser's real text pipeline, so React/Vue-controlled fields see it as a
              // genuine keystroke. Its own failure (return false, or — hypothetically, were
              // it ever removed — a thrown error) must not skip the plain-field fallback below.
              try {
                inserted = document.execCommand('insertText', false, value);
              } catch {
                inserted = false;
              }
              if (!inserted && (isTextInput || isTextArea)) {
                const field = el as HTMLInputElement | HTMLTextAreaElement;
                const start = field.selectionStart ?? field.value.length;
                const end = field.selectionEnd ?? start;
                field.setRangeText(value, start, end, 'end');
                field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
                inserted = true;
              }
            }
          } catch {
            inserted = false;
          }
        }
        let copied = false;
        try {
          await navigator.clipboard.writeText(value);
          copied = true;
        } catch {
          // fall through to the legacy path
        }
        if (!copied) {
          try {
            const active = document.activeElement as HTMLElement | null;
            const ta = document.createElement('textarea');
            ta.value = value;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            copied = document.execCommand('copy');
            ta.remove();
            active?.focus?.();
          } catch {
            copied = false;
          }
        }
        return { inserted, copied };
      },
      args: [text, insert],
    });
    const out: Delivery = { inserted: false, copied: false };
    for (const r of results) {
      const d = r.result as Delivery | undefined;
      if (d?.inserted) out.inserted = true;
      if (d?.copied) out.copied = true;
    }
    return out;
  } catch (err) {
    console.warn('[command-drawer] cannot reach this page', err);
    return { inserted: false, copied: false };
  }
}

/** Blue tick when delivered, red mark when the page refused. Tab-scoped, cleared shortly after. */
function flashBadge(tabId: number | undefined, result: Delivery) {
  if (tabId === undefined || tabId < 0) return;
  const ok = result.inserted || result.copied;
  const title = result.inserted ? 'Command Drawer — pasted and copied' : result.copied ? 'Command Drawer — copied' : 'Command Drawer — this page blocks the extension. Use the drawer instead.';
  void chrome.action.setBadgeBackgroundColor({ tabId, color: ok ? '#2f6fed' : '#d23b3b' });
  void chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
  void chrome.action.setBadgeText({ tabId, text: ok ? '✓' : '!' });
  void chrome.action.setTitle({ tabId, title });
  setTimeout(() => {
    void chrome.action.setBadgeText({ tabId, text: '' });
    void chrome.action.setTitle({ tabId, title: '' });
  }, 1500);
}

/** Same bookkeeping as a copy from the popup, so "Most used" and "Recently used" stay honest. */
async function recordUse(folderId: string, snippetId: string) {
  const store = new SnippetStore(chromeAreas(), 0);
  await store.load();
  const folder = store.getFolder(folderId);
  if (!folder) return;
  store.upsertFolder({
    ...folder,
    snippets: folder.snippets.map((s) => (s.id === snippetId ? { ...s, usedCount: s.usedCount + 1, lastUsedAt: Date.now() } : s)),
  });
  await store.flush();
}
