/**
 * Store listing assets. Loads dist/ in Chrome for Testing, seeds a realistic
 * folder tree, and renders:
 *
 *   store/1-drawer.png          1280x800  popup on a matching site, with headline
 *   store/2-search.png          1280x800  tree-wide search in the popup
 *   store/3-folders.png         1280x800  options page: folders, patterns, tester
 *   store/4-settings.png        1280x800  options page: settings + sync meter
 *   store/promo-440x280.png     Chrome Web Store small promo tile
 *   store/edge-logo-300.png     Edge Add-ons store logo (via make-icons.py)
 *
 *   npm run build && npm run shots
 */
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = resolve(root, 'dist');
const out = resolve(root, 'store');
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const W = 1280;
const H = 800;

const snip = (id, label, value, usedCount = 0, order = 0) => ({ id, label, value, order, createdAt: 1, usedCount });
const seed = {
  meta: { schemaVersion: 1, folderIds: ['m365', 'exo', 'azure', 'github', 'servers'], settings: { theme: 'light' } },
  'folder:m365': {
    id: 'm365',
    name: 'Microsoft 365 admin',
    parentId: null,
    order: 0,
    urlPatterns: ['https://admin.microsoft.com/*', 'https://entra.microsoft.com/*'],
    source: 'user',
    snippets: [
      snip('m1', 'Connect to Graph', 'Connect-MgGraph -Scopes "User.Read.All","Group.Read.All","Directory.Read.All"', 14, 0),
      snip('m2', 'Guest users', "Get-MgUser -Filter \"userType eq 'Guest'\" -All | Select-Object DisplayName, Mail", 6, 1),
      snip('m3', 'Licensed users', 'Get-MgUser -All -Property AssignedLicenses | Where-Object { $_.AssignedLicenses }', 3, 2),
    ],
  },
  'folder:exo': {
    id: 'exo',
    name: 'Exchange Online',
    parentId: 'm365',
    order: 0,
    urlPatterns: ['https://admin.exchange.microsoft.com/*'],
    source: 'user',
    snippets: [
      snip('e1', 'Connect EXO', 'Connect-ExchangeOnline -UserPrincipalName admin@contoso.com', 9, 0),
      snip('e2', 'All shared mailboxes', 'Get-Mailbox -RecipientTypeDetails SharedMailbox -ResultSize Unlimited', 4, 1),
      snip('e3', 'Message trace, last 24h', 'Get-MessageTrace -StartDate (Get-Date).AddDays(-1) -EndDate (Get-Date)', 2, 2),
    ],
  },
  'folder:azure': {
    id: 'azure',
    name: 'Azure portal',
    parentId: null,
    order: 1,
    urlPatterns: ['https://portal.azure.com/*'],
    source: 'user',
    snippets: [
      snip('a1', 'Tenant ID', '72f988bf-86f1-41af-91ab-2d7cd011db47', 21, 0),
      snip('a2', 'Prod subscription', 'a1b2c3d4-0000-4e5f-8a9b-0c1d2e3f4a5b', 11, 1),
      snip('a3', 'Set subscription', 'az account set --subscription "Production"', 5, 2),
      snip('a4', 'List VMs', 'az vm list -d -o table', 4, 3),
      snip('a5', 'KQL: failed sign-ins', 'SigninLogs | where ResultType != 0 | summarize count() by UserPrincipalName', 3, 4),
    ],
  },
  'folder:github': {
    id: 'github',
    name: 'GitHub',
    parentId: null,
    order: 2,
    urlPatterns: ['https://github.com/*'],
    source: 'user',
    snippets: [snip('g1', 'Clone with SSH', 'git clone git@github.com:contoso/', 8, 0), snip('g2', 'Squash last 3', 'git rebase -i HEAD~3', 2, 1)],
  },
  'folder:servers': {
    id: 'servers',
    name: 'Servers',
    parentId: null,
    order: 3,
    urlPatterns: [],
    source: 'user',
    snippets: [snip('s1', 'Tail nginx log', 'sudo journalctl -f -u nginx', 7, 0), snip('s2', 'Disk usage', 'du -sh /var/log/* | sort -h', 3, 1)],
  },
};

const browser = await puppeteer.launch({ headless: true, enableExtensions: [dist], args: ['--no-sandbox', `--window-size=${W},${H + 100}`] });

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;

  // Seed through the options page (it has the storage API in scope).
  const options = await browser.newPage();
  await options.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await options.goto(`chrome-extension://${extId}/src/options/index.html`, { waitUntil: 'load' });
  await options.evaluate(async (data) => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set(data);
  }, seed);

  // ---- Popup shots: popup framed on a 1280x800 canvas with a headline -----
  const FRAME_CSS = `
    html { width: 100% !important; height: 100% !important; background: linear-gradient(135deg, #e3ecfd 0%, #f6f7fa 55%, #ffffff 100%) !important; }
    body { width: 100% !important; height: 100% !important; margin: 0; display: flex; align-items: center; justify-content: center; gap: 88px; overflow: hidden !important; }
    #app { width: 400px; height: 580px; max-height: 580px; flex: none; border-radius: 14px; overflow: hidden; background: var(--bg);
           box-shadow: 0 30px 70px rgba(16, 24, 40, 0.20), 0 0 0 1px #d5dae3; }
    .shot-copy { width: 430px; font-family: var(--sans); color: #16181d; }
    .shot-copy h1 { font-size: 40px; line-height: 1.1; margin: 0 0 18px; font-weight: 700; letter-spacing: -0.5px; }
    .shot-copy p { font-size: 19px; line-height: 1.5; color: #4a515c; margin: 0 0 14px; }
    .shot-copy .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 26px; font-weight: 600; font-size: 17px; color: #2f6fed; }
    .shot-copy .brand img { width: 36px; height: 36px; border-radius: 9px; }
  `;
  const iconData = 'data:image/png;base64,' + readFileSync(resolve(dist, 'icons/icon-128.png')).toString('base64');

  const popupShot = async ({ tabUrl, headline, body, file, before }) => {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(
      (tabId, url) => {
        const orig = chrome.tabs.query.bind(chrome.tabs);
        chrome.tabs.query = async (q) => (q && q.active ? [{ id: tabId, url, active: true }] : orig(q));
        window.close = () => {};
      },
      7,
      tabUrl,
    );
    await page.goto(`chrome-extension://${extId}/src/popup/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('.row, .empty');
    if (before) await before(page);
    await page.addStyleTag({ content: FRAME_CSS });
    await page.evaluate(
      ({ headline, body, iconData }) => {
        const copy = document.createElement('div');
        copy.className = 'shot-copy';
        const brand = document.createElement('div');
        brand.className = 'brand';
        const img = document.createElement('img');
        img.src = iconData;
        brand.append(img, 'Command Drawer');
        const h1 = document.createElement('h1');
        h1.textContent = headline;
        copy.append(brand, h1);
        for (const b of body) {
          const p = document.createElement('p');
          p.textContent = b;
          copy.append(p);
        }
        document.body.insertBefore(copy, document.getElementById('app'));
        document.querySelector('input[type=search]')?.blur();
      },
      { headline, body, iconData },
    );
    await sleep(250);
    await page.screenshot({ path: resolve(out, file), clip: { x: 0, y: 0, width: W, height: H } });
    await page.close();
    console.log('wrote', file);
  };

  await popupShot({
    tabUrl: 'https://portal.azure.com/#home',
    headline: 'Your commands, on the site that needs them.',
    body: [
      'Folders open automatically on the sites they belong to. Click a snippet to copy it, or press Enter.',
      'Tenant IDs, connect strings, KQL, shell one-liners. Whatever you keep retyping.',
    ],
    file: '1-drawer.png',
  });

  await popupShot({
    tabUrl: 'https://github.com/contoso/infra',
    headline: 'Search the whole tree from anywhere.',
    body: [
      'Start typing and every folder is searched at once. Arrow keys to move, Enter to copy and close.',
      'Nested folders, drag-to-arrange, most-used and recently-used sorting.',
    ],
    file: '2-search.png',
    before: async (page) => {
      await page.waitForSelector('input[type=search]');
      await page.type('input[type=search]', 'connect');
      await sleep(200);
    },
  });

  // ---- Options page shots --------------------------------------------------
  await options.reload({ waitUntil: 'load' });
  await options.waitForSelector('.tree-row');
  for (const r of await options.$$('.tree-row')) {
    const name = await r.$eval('.name', (e) => e.textContent);
    if (name === 'Exchange Online') {
      await r.click();
      break;
    }
  }
  await options.waitForSelector('.pattern-row');
  await options.$eval('.test-url .input', (el) => {
    el.value = '';
  });
  await options.type('.test-url .input', 'https://admin.exchange.microsoft.com/#/mailboxes');
  await sleep(200);
  await options.evaluate(() => {
    window.scrollTo(0, 0);
    document.activeElement?.blur();
  });
  await sleep(150);
  await options.screenshot({ path: resolve(out, '3-folders.png'), clip: { x: 0, y: 0, width: W, height: H } });
  console.log('wrote 3-folders.png');

  await options.evaluate(() => {
    location.hash = 'settings';
  });
  await options.waitForSelector('.meter');
  await options.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  await options.screenshot({ path: resolve(out, '4-settings.png'), clip: { x: 0, y: 0, width: W, height: H } });
  console.log('wrote 4-settings.png');

  // ---- Promo tile 440x280 ----------------------------------------------------
  const tile = await browser.newPage();
  await tile.setViewport({ width: 440, height: 280, deviceScaleFactor: 1 });
  await tile.setContent(`<!doctype html><html><head><style>
    html, body { margin: 0; width: 440px; height: 280px; overflow: hidden; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #2f6fed 0%, #1f4fb8 100%); color: #fff;
           display: flex; flex-direction: column; justify-content: center; padding: 0 36px; box-sizing: border-box; }
    .top { display: flex; align-items: center; gap: 16px; margin-bottom: 18px; }
    .top img { width: 64px; height: 64px; border-radius: 15px; box-shadow: 0 8px 20px rgba(0,0,0,.25); }
    h1 { font-size: 30px; margin: 0; font-weight: 700; letter-spacing: -0.4px; }
    p { margin: 0; font-size: 16px; line-height: 1.45; color: rgba(255,255,255,.88); }
  </style></head><body>
    <div class="top"><img src="${iconData}" alt="" /><h1>Command Drawer</h1></div>
    <p>Command snippets that open on the site that needs them. Plain text, synced with your browser profile.</p>
  </body></html>`);
  await sleep(200);
  await tile.screenshot({ path: resolve(out, 'promo-440x280.png') });
  console.log('wrote promo-440x280.png');
  await tile.close();
} finally {
  await browser.close();
}

execFileSync('python', [resolve(here, 'make-icons.py'), '300', resolve(out, 'edge-logo-300.png')], { stdio: 'inherit' });
