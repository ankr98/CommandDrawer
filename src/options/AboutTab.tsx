import { PLAINTEXT_DISCLOSURE } from '../lib/guards';
import { appVersion, assetUrl } from '../shared/browser';
import { IconCoffee, IconExternalLink, IconLockOpen } from '../shared/icons';

export const SUPPORT_URL = 'https://buymeacoffee.com/ankr98';

export function AboutTab() {
  const version = appVersion();
  return (
    <>
      <div class="card">
        <div class="about-hero">
          <img src={assetUrl('icons/icon-128.png')} alt="" width={60} height={60} />
          <div>
            <h2>
              Command Drawer
              {version ? <span class="version">v{version}</span> : null}
            </h2>
            <p class="hint">Context-aware command snippets for people who administer things. Free and open source, GPL-3.0 licensed.</p>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Free of charge, made in my free time</h2>
        <p>Command Drawer is free to use, and always will be. I build it in my spare time because I wanted it to exist, and I publish it in case it saves you time as well.</p>
        <p>
          That also means <b>no support is provided</b>: there is no help desk, no guaranteed fixes and no promised features. It is offered as is.
        </p>
        <p>If it earns a place in your toolbar and you feel like supporting it, buying me a coffee lets me spend more of my free time on passion projects like this one.</p>
        <a class="btn btn-coffee" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
          <IconCoffee size={18} />
          Buy me a coffee
          <IconExternalLink size={13} />
        </a>
      </div>

      <div class="card">
        <h2>
          <IconLockOpen size={16} /> Not a password manager
        </h2>
        <p class="hint">{PLAINTEXT_DISCLOSURE}</p>
      </div>

      <div class="card">
        <h2>Privacy and permissions</h2>
        <ul class="plain-list hint">
          <li>No backend, no account, no analytics, no network requests.</li>
          <li>Data stays in your browser and only moves through your own profile sync.</li>
          <li>
            Permissions: <code>storage</code>, <code>activeTab</code>, <code>contextMenus</code> and <code>scripting</code>. The current tab's URL is read only when you open the drawer, to pick the folder. The right-click menu is
            filtered by the browser itself; picking a snippet there runs a script in that one tab to paste and copy it, and nothing is read from the page.
          </li>
          <li>Credential detection runs locally and records nothing.</li>
        </ul>
      </div>

      <div class="card">
        <h2>Third-party components</h2>
        <p class="hint">
          Icons from <a href="https://lucide.dev" target="_blank" rel="noopener noreferrer">Lucide</a> (ISC). Built with <a href="https://preactjs.com" target="_blank" rel="noopener noreferrer">Preact</a> and{' '}
          <a href="https://zod.dev" target="_blank" rel="noopener noreferrer">Zod</a> (MIT).
        </p>
      </div>
    </>
  );
}
