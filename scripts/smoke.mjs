/**
 * Smoke test: load dist/ as an unpacked extension in Chrome for Testing, seed a
 * folder tree, and drive the options page and popup through the core loop.
 *
 *   npm run build && npm run smoke
 *
 * Screenshots land in scripts/smoke-out/.
 */
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');
const out = resolve(here, 'smoke-out');
mkdirSync(out, { recursive: true });

const failures = [];
const check = (cond, msg) => {
  if (cond) console.log('  ok   ', msg);
  else {
    console.log('  FAIL ', msg);
    failures.push(msg);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  enableExtensions: [dist],
  args: ['--no-sandbox', '--window-size=1200,900'],
});

try {
  // Find the extension id via its service worker.
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  console.log('extension id', extId);

  const seed = {
    meta: { schemaVersion: 1, folderIds: ['ps', 'exo', 'azure'], settings: { sortMode: 'manual', theme: 'light' } },
    'folder:ps': {
      id: 'ps', name: 'PowerShell', parentId: null, order: 0, urlPatterns: ['https://*.microsoft.com/*'], source: 'user',
      snippets: [
        { id: 's1', label: 'Connect to Graph', value: 'Connect-MgGraph -Scopes "User.Read.All","Group.Read.All"', order: 0, createdAt: 1, usedCount: 4 },
        { id: 's2', label: 'Guest users', value: "Get-MgUser -Filter \"userType eq 'Guest'\" -All | Select DisplayName,Mail", order: 1, createdAt: 2, usedCount: 1 },
      ],
    },
    'folder:exo': {
      id: 'exo', name: 'Exchange Online', parentId: 'ps', order: 0, urlPatterns: ['https://admin.exchange.microsoft.com/*'], source: 'user',
      snippets: [{ id: 's3', label: 'Connect EXO', value: 'Connect-ExchangeOnline -UserPrincipalName admin@contoso.com', order: 0, createdAt: 3, usedCount: 0 }],
    },
    'folder:azure': {
      id: 'azure', name: 'Azure portal', parentId: null, order: 1, urlPatterns: ['https://portal.azure.com/*'], source: 'user',
      snippets: [{ id: 's4', value: '72f988bf-86f1-41af-91ab-2d7cd011db47', order: 0, createdAt: 4, usedCount: 9 }],
    },
  };

  // ---- Options page --------------------------------------------------------
  const options = await browser.newPage();
  await options.setViewport({ width: 1200, height: 900 });
  const consoleErrors = [];
  options.on('pageerror', (e) => consoleErrors.push(String(e)));
  options.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  await options.goto(`chrome-extension://${extId}/src/options/index.html`, { waitUntil: 'load' });
  await options.evaluate((data) => chrome.storage.sync.set(data), seed);
  await options.reload({ waitUntil: 'load' });
  await options.waitForSelector('.tree-row');
  const treeNames = await options.$$eval('.tree-row .name', (els) => els.map((e) => e.textContent));
  check(JSON.stringify(treeNames) === JSON.stringify(['Azure portal', 'PowerShell', 'Exchange Online']), `options tree renders A-Z by default, child under its parent: ${treeNames.join(', ')}`);
  await options.click('.tree-row:nth-child(3)'); // Exchange Online, under PowerShell
  await options.waitForSelector('.pattern-row');
  const heading = await options.$eval('.two-col > div:nth-child(2) .card h2', (e) => e.textContent);
  check(/Sub-folder of PowerShell/.test(heading), `folder editor shows parent: "${heading.trim()}"`);
  // live pattern tester
  await options.$eval('.test-url .input', (el) => { el.value = ''; });
  await options.type('.test-url .input', 'https://admin.exchange.microsoft.com/#/mailboxes');
  await sleep(100);
  const status = await options.$eval('.pattern-row .status', (e) => e.textContent);
  check(/matches/.test(status), `pattern tester reports a match: "${status}"`);
  const line = await options.$eval('.status-line', (e) => e.textContent);
  check(/this folder/.test(line), `tester names the winning folder: "${line.trim()}"`);
  // secret warning in the editor (inline, non-blocking)
  await options.click('.card:nth-of-type(2) .btn-primary');
  await options.waitForSelector('.snippet-editor textarea');
  await options.type('.snippet-editor textarea', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij');
  await sleep(300);
  check((await options.$('.snippet-editor .warn-line')) !== null, 'credential-shaped value shows the inline warning');
  check(await options.$eval('.snippet-editor button[type=submit]', (b) => b.disabled), 'Save is disabled while the label is empty (labels are required)');
  await options.type('.snippet-editor input.input', 'All mailboxes');
  await sleep(200);
  check(await options.$eval('.snippet-editor button[type=submit]', (b) => !b.disabled), 'Save stays enabled despite the warning once a label is given');
  await options.$eval('.snippet-editor textarea', (el) => { el.value = ''; });
  await options.type('.snippet-editor textarea', 'Get-Mailbox -ResultSize Unlimited');
  await sleep(300);
  check((await options.$('.snippet-editor .warn-line')) === null, 'legitimate command shows no warning');
  await options.click('.snippet-editor button[type=submit]');
  await sleep(900); // debounce flush
  const exoSnips = await options.evaluate(async () => (await chrome.storage.sync.get('folder:exo'))['folder:exo'].snippets.length);
  check(exoSnips === 2, `snippet persisted to sync storage (folder now has ${exoSnips})`);
  await options.screenshot({ path: resolve(out, 'options.png') });
  // settings tab quota meter
  await options.evaluate(() => { location.hash = 'settings'; });
  await options.waitForSelector('.meter');
  const meterText = await options.$eval('.meter + .hint', (e) => e.textContent);
  check(/of sync storage used/.test(meterText), `quota meter: "${meterText.trim()}"`);
  await options.screenshot({ path: resolve(out, 'settings.png') });

  // ---- Popup, simulated on an Azure portal tab ------------------------------
  const popupFor = async (tabId, url, label) => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    await page.setViewport({ width: 400, height: 580 });
    await page.evaluateOnNewDocument((tabId, url) => {
      const orig = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = async (q) => (q && q.active ? [{ id: tabId, url, active: true }] : orig(q));
      window.close = () => { window.__closed = true; };
    }, tabId, url);
    await page.goto(`chrome-extension://${extId}/src/popup/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('.row, .empty');
    await page.screenshot({ path: resolve(out, `${label}.png`) });
    return page;
  };

  let p = await popupFor(7, 'https://portal.azure.com/#home', 'popup-azure-match');
  let crumb = await p.$eval('.crumbs .crumb.current', (e) => e.textContent);
  check(crumb === 'Azure portal', `auto-match opens the Azure folder (crumb: "${crumb}")`);
  check(await p.$eval('input[type=search]', (el) => document.activeElement === el), 'search field is focused on open');

  // Copy via click → clipboard write + "Copied" state + usedCount bump
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(`chrome-extension://${extId}`, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  await p.click('.row');
  await sleep(150);
  check((await p.$('.row .copied')) !== null, 'row shows inline "Copied"');
  const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  check(clip === '72f988bf-86f1-41af-91ab-2d7cd011db47', `clipboard holds the value (${clip})`);
  await sleep(900);
  const used = await p.evaluate(async () => (await chrome.storage.sync.get('folder:azure'))['folder:azure'].snippets[0].usedCount);
  check(used === 10, `usedCount incremented and persisted (${used})`);

  // Manual override: go to root, then PowerShell → pinned
  await p.click('.crumbs .crumb');
  await p.waitForSelector('.row');
  await p.click('.row:nth-child(2)'); // PowerShell (A-Z: Azure portal, PowerShell)
  await sleep(200);
  crumb = await p.$eval('.crumbs .crumb.current', (e) => e.textContent);
  check(crumb === 'PowerShell', `manual pick shows PowerShell (crumb: "${crumb}")`);
  const rows = await p.$$eval('.row .title', (els) => els.map((e) => e.textContent));
  check(rows[0] === 'Exchange Online', `child folder listed before snippets: ${rows.join(' | ')}`);
  const headers = await p.$$eval('.group-header', (els) => els.map((e) => e.textContent));
  check(headers.join('|') === 'Sub-folders|Snippets', `folder view groups sub-folders and snippets: ${headers.join(', ')}`);
  // Sort menu lists the three orders
  await p.click('.toolbar .menu > button');
  await p.waitForSelector('.menu-list');
  const sortOpts = await p.$$eval('.menu-list button', (els) => els.map((e) => e.textContent.trim()));
  check(sortOpts.join('|') === 'Manual order|Most used|Recently used', `sort menu offers the three orders: ${sortOpts.join(', ')}`);
  await p.keyboard.press('Escape');
  check((await p.$('.menu-list')) === null, 'Escape closes the sort menu');
  await p.screenshot({ path: resolve(out, 'popup-pinned.png') });
  await p.close();

  // Reopen on same tab, different path → override survives
  p = await popupFor(7, 'https://portal.azure.com/#view/other', 'popup-reopen');
  crumb = await p.$eval('.crumbs .crumb.current', (e) => e.textContent);
  check(crumb === 'PowerShell', `override survives reopen on same tab+origin (crumb: "${crumb}")`);
  await p.close();
  // With "remember my folder per site" off, the remembered pick is ignored
  const setRemember = (v) =>
    options.evaluate(async (v) => {
      const m = (await chrome.storage.sync.get('meta')).meta;
      m.settings.rememberPerSite = v;
      await chrome.storage.sync.set({ meta: m });
    }, v);
  await setRemember(false);
  p = await popupFor(7, 'https://portal.azure.com/#view/other', 'popup-no-remember');
  crumb = await p.$eval('.crumbs .crumb.current', (e) => e.textContent);
  check(crumb === 'Azure portal', `remember-per-site off ignores the pick and auto-matches (crumb: "${crumb}")`);
  await p.close();
  await setRemember(true);

  // Different tab, same origin → fresh auto-match (set an override on tab 7 first)
  p = await popupFor(7, 'https://portal.azure.com/', 'popup-tmp');
  await p.click('.crumbs .crumb');
  await p.waitForSelector('.row');
  await p.click('.row:nth-child(2)'); // PowerShell
  await sleep(200);
  await p.close();
  p = await popupFor(8, 'https://portal.azure.com/', 'popup-other-tab');
  crumb = await p.$eval('.crumbs .crumb.current', (e) => e.textContent);
  check(crumb === 'Azure portal', `second tab is unaffected by tab 7's override (crumb: "${crumb}")`);
  await p.close();

  // Child folder pattern wins depth-blind
  p = await popupFor(9, 'https://admin.exchange.microsoft.com/#/homepage', 'popup-child-match');
  const crumbs = await p.$$eval('.crumbs .crumb', (els) => els.map((e) => e.textContent.trim()));
  check(crumbs.join(' ') === 'All PowerShell Exchange Online', `child folder matched with full breadcrumb: ${crumbs.join(' / ')}`);
  await p.close();

  // No match → root view
  p = await popupFor(10, 'https://github.com/x', 'popup-root');
  const roots = await p.$$eval('.row .title', (els) => els.map((e) => e.textContent));
  check(roots.join(',') === 'Azure portal,PowerShell', `root view lists root folders A-Z: ${roots.join(', ')}`);

  // Creating a folder on an unmatched site offers to map it, once
  await p.click('.crumbs button.btn');
  await p.waitForSelector('.panel input');
  await p.type('.panel input', 'GitHub');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.notice.suggest');
  const offer = await p.$eval('.notice.suggest', (e) => e.textContent);
  check(/github\.com/.test(offer), `mapping offered right after creating a folder on an unmatched site: "${offer.trim()}"`);
  await p.click('.notice.suggest .btn-ghost');
  await sleep(100);
  check((await p.$('.notice.suggest')) === null, 'declining hides the offer');
  await p.screenshot({ path: resolve(out, 'popup-new-folder.png') });
  await p.click('.crumbs .crumb.back');
  await p.waitForSelector('.row');

  // Keyboard: search across tree, Enter copies and closes
  await p.type('input[type=search]', 'guest');
  await sleep(100);
  const hits = await p.$$eval('.row', (els) => els.map((e) => e.querySelector('.title')?.textContent));
  check(hits.length === 1 && hits[0] === 'Guest users', `tree-wide search finds the nested snippet: ${hits.join(', ')}`);
  const pathText = await p.$eval('.row .sub:last-child', (e) => e.textContent);
  check(pathText === 'PowerShell', `search result shows folder path: "${pathText}"`);
  await p.keyboard.press('Enter');
  await sleep(300);
  check(await p.evaluate(() => window.__closed === true), 'Enter copies and closes the popup');
  await p.close();

  // tabs.onRemoved cleanup, end to end: pin an override under a REAL tab id, close the tab.
  const worker = await swTarget.worker();
  const idsBefore = await worker.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id));
  const realTab = await browser.newPage();
  await realTab.goto('about:blank');
  const idsAfter = await worker.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id));
  const realId = idsAfter.find((id) => !idsBefore.includes(id));
  check(typeof realId === 'number', `found real tab id ${realId}`);
  p = await popupFor(realId, 'https://portal.azure.com/', 'popup-realtab');
  await p.click('.crumbs .crumb');
  await p.waitForSelector('.row');
  await p.click('.row');
  await sleep(200);
  await p.close();
  const before = await worker.evaluate(async (id) => Object.keys(await chrome.storage.session.get(null)).filter((k) => k.startsWith(`override:${id}:`)).length, realId);
  check(before === 1, `override for the real tab is in session storage (${before})`);
  await realTab.close();
  await sleep(500);
  const after = await worker.evaluate(async (id) => Object.keys(await chrome.storage.session.get(null)).filter((k) => k.startsWith(`override:${id}:`)).length, realId);
  check(after === 0, `tabs.onRemoved cleared it (${after} left)`);

  // Right-click menu: the worker registers items from storage. Chrome has no API to
  // list them, so probe by creating a duplicate: an existing id is refused.
  const menuHas = (id) =>
    worker.evaluate(
      (id) =>
        new Promise((res) => {
          chrome.contextMenus.create({ id, title: 'probe', contexts: ['page'] }, () => {
            const err = chrome.runtime.lastError?.message ?? '';
            if (!err) chrome.contextMenus.remove(id, () => void chrome.runtime.lastError);
            res(/duplicate/i.test(err));
          });
        }),
      id,
    );
  const setMenuMode = (mode) =>
    worker.evaluate(async (mode) => {
      const m = (await chrome.storage.sync.get('meta')).meta;
      m.settings.contextMenu = mode;
      await chrome.storage.sync.set({ meta: m });
    }, mode);
  await sleep(500);
  check(await menuHas('cd:root'), 'right-click menu: "Command Drawer" root is registered');
  check(await menuHas('cd:m:exo:f:exo'), 'default mode: Exchange Online is a page-restricted top entry');
  check(await menuHas('cd:all') && (await menuHas('cd:a:s:ps:s1')), 'default mode: "All folders" carries the whole tree');
  check(!(await menuHas('cd:nope')), 'probe sanity: unknown id reads as absent');
  await setMenuMode('all');
  await sleep(900);
  check((await menuHas('cd:a:f:ps')) && !(await menuHas('cd:all')), 'mode "all": tree sits directly under the root, no "All folders" entry');
  await setMenuMode('off');
  await sleep(900);
  check(!(await menuHas('cd:root')), 'mode "off": menu removed');
  await setMenuMode('matched');
  await sleep(900);
  check(await menuHas('cd:root'), 'back to default: menu rebuilt');

  check(consoleErrors.length === 0, `no page errors (${consoleErrors.length ? consoleErrors.join(' | ') : 'clean'})`);
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
