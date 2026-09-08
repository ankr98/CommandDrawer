# Command Drawer

Context-aware command snippets for people who administer things. A Manifest V3
extension for Chrome and Edge.

Store the short strings you reuse all day — Graph Explorer queries, PowerShell
one-liners, KQL fragments, tenant IDs, portal deep-links — in folders, map each
folder to the sites where you need it, and the popup opens on the right folder
automatically. One click copies. Nothing else.

> **Working title.** "Command Drawer" is a placeholder; see §10 of the plan for the
> naming shortlist. The name lives in `public/manifest.json`, `package.json` and the
> two page titles.

## What it deliberately is not

- **Not a secret store.** A snippet is a label plus one value. There is no second
  field, no notes, no masking, no "reveal". Values are always shown in plaintext and
  stored unencrypted. If you can't hide a value, you're far less likely to put a
  password in it. A strict, local, non-blocking warning flags known credential
  formats (Entra client secrets and refresh tokens, JWTs, Azure Storage/SAS/service
  keys, Azure DevOps PATs, GitHub/AWS/Google/Slack keys, private-key blocks,
  passwords embedded in URLs and connection strings) and literal values sitting
  right after a password/secret/key keyword (`password=…`, `-ClientSecret …`,
  `ConvertTo-SecureString "…" -AsPlainText`). It is a nudge, not a control, and it
  can be turned off.
- **No backend.** No SaaS, no account, no telemetry. Sync rides on your browser
  profile sync (`chrome.storage.sync`), and JSON export/import is the backup and
  sharing story.
- **Minimal permissions.** `storage` and `activeTab`. No host permissions, no
  content scripts, no `tabs`, no `clipboardRead`.

## Features (v1)

- Folders one level deep (`PowerShell > Exchange Online`), each with its own
  snippets and URL patterns. Sub-folders do **not** inherit their parent's patterns.
- Chrome match-pattern URL mapping per folder with specificity scoring:
  `https://admin.site.com/feature/*` beats `https://admin.site.com/*`, exact hosts
  beat `*.` wildcards. Children compete with roots on equal terms. A live tester
  shows, per folder, whether a URL matches and which folder would win, and the
  pattern editor lists other folders whose more specific patterns take precedence.
- Per-tab, per-site memory (a setting, on by default): pick a folder manually and
  that tab keeps showing it for that site across reloads and in-tab navigation. New
  tabs start clean. Turn it off to always open the best match.
- Right after you create a folder on a site that matches nothing yet, the drawer
  offers to open that folder on this site from now on. *Map to host* also lives in
  the folder menu.
- Keyboard-first popup: search is focused on open, type to filter the whole tree,
  ↑/↓ to move, Enter to copy and close, Esc/Backspace to go up. Global shortcut
  `Ctrl+Shift+Y` (rebindable in the browser).
- Inline "Copied" confirmation on the row; usage counts with manual / most used /
  recently used sorting, with a default order and a choice of whether a sort picked
  in the drawer sticks or resets per folder; "Include sub-folder snippets" roll-up
  for parents.
- Options page with drag-and-drop tree management, a live pattern tester, quota
  meter, sync notes, dark mode, JSON import/export that preserves hierarchy, and
  an About page.
- Storage layer that chunks large folders under the 8 KB sync item cap, refuses
  new folders near the 512-item ceiling, debounces writes, and falls back to
  `storage.local` (with a visible "local only" badge) when sync is full — data is
  never dropped because a quota was hit.

## Develop

Requires Node 20+.

```sh
npm install
npm test          # vitest: storage, tree, matcher, session, guards, search, transfer
npm run build     # typecheck + vite build → dist/
npm run dev       # rebuild on change
```

Load `dist/` as an unpacked extension:

- Chrome: `chrome://extensions` → Developer mode → *Load unpacked* → pick `dist/`.
- Edge: `edge://extensions` → Developer mode → *Load unpacked* → pick `dist/`.

The same `dist/` folder, zipped, is what both stores accept.

## Layout

```
src/
  popup/        the entire user-facing surface
  options/      folder tree, URL patterns, settings, quota meter, import/export
  shared/       store hook, theme, browser helpers, the one snippet editor
  background/   service worker: tabs.onRemoved cleanup only
  lib/
    schema.ts   types, zod validation, constants (MAX_DEPTH, char caps), migration hook
    storage.ts  sync/local abstraction: chunking, quota + item accounting, debounce
    tree.ts     parentId graph: depth enforcement, move, delete cascade/promote, orphan repair
    matcher.ts  match-pattern parsing, specificity scoring, precedence resolution
    session.ts  tab+origin override map, LRU cap, last-seen URL for the tester
    guards.ts   credential-format allowlist (data) + detection
    search.ts   fuzzy tree-wide search, sort modes
    transfer.ts JSON export/import with hierarchy
tests/          one file per lib module; guards.test.ts holds the false-positive fixture set
```

`lib/` is pure and fully unit-tested. Everything that is miserable to debug through
a popup lives there.

## Sync caveats

- Sync data is **not encrypted by the extension**. Chrome/Edge apply their own
  transport and account protection; nothing is added on top. The UI says so.
- If you are not signed in or extension sync is off, `storage.sync` behaves like
  local storage. The extension cannot detect this; the settings page links to the
  browser's sync settings instead.
- On a work profile, whether extension data syncs depends on the tenant's Edge/Chrome
  sync policy.

## Adding a credential pattern

Patterns live in `src/lib/guards.ts` as data, in two tiers:

- **Format** patterns anchor on a fixed literal prefix or structural marker from a
  known issuer (`ghp_`, `AKIA`, the `8Q~` marker inside Entra client secrets, the
  `+ASt` signature inside Azure Storage keys). No entropy or length scoring, ever.
- **Context** patterns need a password-ish keyword (`password=`, `-ClientSecret`,
  `/pass:`) immediately followed by a *literal* value that carries a digit or a
  password-style symbol. Variables (`$cred`, `%PW%`), placeholders (`<your-secret>`,
  `{{ vault }}`, `***`), expressions (`(Read-Host)`) and cmdlet names never count.
  A label that names a password over a value that is one bare password-shaped token
  also counts.

A pattern ships only if it produces zero hits against the fixture set in
`tests/guards.test.ts` (100+ legitimate admin strings, many of which mention
passwords) and would read as obviously correct to the user every time it fires.
When a pattern produces a false positive it is removed, not tuned. Add the offending
legitimate string to the fixture set.

## Roadmap (v2, not started)

Placeholder tokens (`{{tenantId}}`), `chrome.storage.managed` policy folders pushed
by an administrator, optional "add snippet from selection" context menu.

## Support

Command Drawer is free of charge and built in spare time, so no support is provided.
If it saves you time and you would like to see more of it, you can
[buy me a coffee](https://buymeacoffee.com/ankr98). The same note lives on the
About page in the extension's settings.

## License

MIT — see `LICENSE`. Privacy policy in `PRIVACY.md`.
