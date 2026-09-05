# Privacy policy — Command Drawer

Command Drawer stores the folders and snippets you create in your browser's
extension storage (`chrome.storage.sync`, falling back to `chrome.storage.local`
when sync storage is full).

- **No data leaves your browser** except through your own browser profile sync
  (Chrome Sync or Microsoft Edge Sync), which you control in the browser's settings.
- The extension has **no backend**, no account, no analytics and no telemetry.
- It makes **no network requests** of its own.
- It reads the URL of the active tab only when you open the popup (the `activeTab`
  permission), to pick the folder to show. That URL is not stored beyond the
  current browser session and is never transmitted.
- It **writes** to the clipboard when you click a snippet. It never reads the clipboard.
- Credential-shape detection runs locally while you type and records nothing.

Snippet values are stored **unencrypted**. The extension adds no encryption layer
on top of what the browser provides. Do not store passwords, tokens or keys in it.
