# Project Plan — Context-Aware Command Snippet Extension (MV3, Chrome + Edge)

Working title: **TBD** (see §10). Author: Andreas Kristiansen.
Status: pre-implementation brief, intended as a handoff document for Claude Code.
Revision 3 — nested folders, session-override semantics, inline secret warnings. All three
decisions below are settled; §11 holds only what remains genuinely open.

---

## 1. Goal and intent (do not drift from this)

A browser extension that stores short, frequently-reused **commands and strings** — Graph
Explorer queries, PowerShell one-liners, KQL fragments, tenant IDs, portal deep-links — and
surfaces the *right ones* automatically based on the site you're currently looking at.

Three non-negotiable principles. Every design decision downstream should be checked against
these:

1. **It is not a secret store, and the design should make that obvious.** A snippet is a
   display name plus one value. There is no second field, no notes, no masking, no
   "reveal". If a user cannot hide a value, they are far less likely to put a password in
   it. Structural discouragement beats a warning banner.
2. **No backend.** No SaaS, no account, no server to run or pay for. Sync rides on the
   user's existing browser profile sync.
3. **Speed of retrieval is the product.** Open popup → the relevant folder is already
   showing → one click → it's on the clipboard. Anything that adds a step is suspect.

Non-goals for v1: clipboard history / auto-capture, text expansion into page fields,
sharing between users, snippet execution, rich text, code syntax highlighting.

---

## 2. Prior art — what already exists

Researched September 2026. The category is not empty, but the specific combination isn't
well served.

**Clipboard history managers** (Clipboard History Pro, Super Clipboard Manager, ClipGate,
Paste Mate, and many more). These capture everything you copy and let you retrieve it
later. Different problem entirely — they are about *recovering* things you copied, not
*curating* things you want to reuse. Several also auto-capture every Ctrl+C on every page,
which is precisely the privacy posture this project should reject.

**Plain snippet managers** (Text Snippet Saver, Snippets Manager, Code Snippet Manager).
Save a named string, click to copy, group into collections, search. This is roughly the
baseline of your idea minus the context awareness. Well trodden, mostly simple, mostly
free.

**The closest competitors — context-aware snippet tools:**

- **Snipman** (Chrome Web Store, ~4.2★, "Featured"). Domain-specific snippets that are
  auto-suggested based on the detected domain, plus dynamic values (date, time, domain,
  clipboard) and a `//` trigger inside input fields. This is the nearest commercial
  equivalent. Its matching is *per snippet, by domain* — not per folder, by URL pattern,
  and it has no folder hierarchy at all.
- **QuickFill / Quick Copy** (open source, github.com/KPandya1903/Extension). Floating
  menu, command palette on Ctrl+Shift+K, smart field detection, JSON import/export, and
  "context-aware snippets — define domains to only show specific snippets where they are
  relevant."
- **Text expanders** (Text Blaze, Magical). Insertion-first, template-heavy, account-based
  SaaS. Overlapping but much heavier, and they violate principle 2.

**Where the gap actually is.** Be honest with yourself: "snippet manager with URL
awareness" is not a novel category. The differentiation is in specifics:

| Your angle | Why it's not already covered |
|---|---|
| **Folder-level** URL mapping, not snippet-level | Competitors tag individual snippets by domain. Mapping a whole folder to `https://developer.microsoft.com/*graph*` and having the popup open on that folder is a different, faster interaction. |
| Wildcard **path** patterns, not just domain | Entra, Intune, Azure and M365 admin all live under a handful of hosts with meaningful paths. Domain-only matching is useless for `portal.azure.com`. |
| **Nested folders** with independent matching | Competitors are flat or single-level. `PowerShell > Exchange Online` where the child carries its own URL pattern is genuinely absent from the market. |
| Real **per-tab, per-site override memory** | Everyone else either always auto-matches or never does. The stateful middle ground is the whole ergonomic argument. |
| Deliberate **anti-credential** shape | Every competitor drifts toward "store your details and autofill them". Being loudly not-that is a positioning asset, and matters for corporate approval. |
| Audience: **tenant / infrastructure admins** | The existing tools target developers and writers. Nobody has shipped a curated ops-focused one. |
| **`storage.managed` policy folders** (see §7) | Not seen in any competitor. Potentially the strongest differentiator. |

Recommendation: build it. The market check says you won't be first, so lean hard into the
ergonomics and the admin-tooling angle rather than feature breadth.

---

## 3. The sync question — answered

**Yes, you can latch onto browser profile sync. Use `chrome.storage.sync`.** Data written
there is synchronised by Chrome Sync / Edge Sync to every browser where the user is signed
in with the same profile. No backend, no account of your own.

Edge supports this — Edge has synced extensions and extension data since v83, controlled
by Settings → Profiles → Sync → Extensions.

**Hard quotas you must design around:**

| Limit | Value |
|---|---|
| `QUOTA_BYTES` (total) | 102,400 bytes |
| `QUOTA_BYTES_PER_ITEM` | 8,192 bytes |
| `MAX_ITEMS` | 512 |
| `MAX_WRITE_OPERATIONS_PER_HOUR` | 1,800 |
| `MAX_WRITE_OPERATIONS_PER_MINUTE` | 120 |

Exceeding any of these rejects the write with `runtime.lastError` — it does not fail
silently, but it also does not degrade gracefully unless you build for it.

**Design consequences (these are requirements, not suggestions):**

- **One sync item per folder**, not one blob and not one per snippet. A single blob blows
  the 8KB item cap quickly; per-snippet items burn the 512-item budget and cause write
  storms. Key scheme: `meta`, `folder:<uuid>`. Note that nesting (§5) increases the folder
  count — budget for it, and see the item-count guard below.
- **Transparent chunking** in the storage layer: if a serialised folder exceeds ~7.5KB,
  split into `folder:<uuid>:0`, `:1`, … and reassemble on read. Do this once, in one
  module, and never think about it again.
- **Item-count guard.** With chunking plus nesting, `MAX_ITEMS` (512) becomes a real
  ceiling rather than a theoretical one. Track item count alongside byte usage and refuse
  new folder creation with a clear message at ~90%.
- **Debounce writes** (500–1000ms) and coalesce. Editing a snippet character-by-character
  must not produce one write per keystroke.
- **Quota meter in the UI.** Show both "12% of sync storage used" and item count in
  settings. `getBytesInUse()` gives you the bytes.
- **Overflow strategy:** when sync is full, write to `storage.local` and mark the folder
  "local only, not syncing" with a visible badge. Never lose the user's data because a
  quota was hit.
- **Export/import JSON** is not a nice-to-have. It is the backup story, the migration
  story, and the escape hatch for the quota ceiling.

**Caveats to document in the README:**

- Sync data is **not encrypted at rest** by the extension. Chrome/Edge sync applies its own
  transport and account-level protection, but you are not adding a layer. Say this plainly
  in the UI and the store listing — it reinforces principle 1.
- If the user has sync disabled or isn't signed in, `storage.sync` transparently behaves
  like `storage.local`. Detect and surface this ("Not syncing — you're not signed in").
- On a **work profile** signed in with Entra ID, whether extension data syncs at all
  depends on the tenant's Edge sync policy. Worth verifying in the Yinson tenant before
  you rely on it personally.

---

## 4. Folder hierarchy

Folders nest **one level deep**: a root folder may contain child folders, and children
contain only snippets. `PowerShell > Graph API`, `PowerShell > Exchange Online`.

> **Settled.** `MAX_DEPTH = 2`. One level of nesting, two levels total. A root folder and
> its children may both hold snippets directly. `PowerShell > Graph API > Users` is out of
> scope and should be rejected by validation, not silently flattened. Keep depth as a
> single exported constant and enforce it in `tree.ts` rather than relying on the UI to
> prevent it — the options page, import, and drag-and-drop are three separate paths into
> the same invariant.

**Model.** Folders are stored flat with a `parentId`, not physically nested. This keeps the
storage-chunking scheme from §3 intact — each folder record carries only its own snippets,
so a large parent doesn't drag its children into the same 8KB item.

**Rules:**

- A root folder may hold both snippets of its own and child folders. Mixed content is
  allowed and expected — `PowerShell` can hold general one-liners plus specialised children.
- Depth is enforced at create/move time. Moving a folder that has children under another
  root must be rejected with an explanatory message, not silently flattened.
- Deleting a parent prompts once, then deletes descendants. Offer "move children to root"
  as the alternative action in the same prompt.
- Drag-and-drop reordering and reparenting in the options page. In the popup, structure is
  read-only.

**Navigation in the popup.** The popup is at most 800×600, so a permanent tree rail is
cramped. Use single-column drill-down with a breadcrumb:

- Root view lists root folders. Folders with children show a chevron and a child count.
- Clicking a root folder opens it: breadcrumb (`‹ All / PowerShell`), then its child
  folders as rows, then its own snippets below them.
- Clicking a child opens it: breadcrumb (`‹ PowerShell / Graph API`), then its snippets.
- A **"Show all in this folder"** toggle on a parent rolls the descendants' snippets up
  into one flat list, grouped by child with subtle headers. Off by default; remember the
  last state per folder.
- **Search always spans the entire tree** regardless of where you are, with the folder path
  shown in small text on each result row. This matters — with nesting, keyboard search
  becomes the primary path for anyone with more than a handful of folders, and navigation
  becomes the fallback.

---

## 5. URL matching and folder selection

This is the most behaviour-sensitive part of the product. Specify it precisely so it
doesn't get built by vibes.

### 5.1 Patterns and scoring

**Folder shape:** any folder at any depth carries `urlPatterns: string[]`. Support Chrome
[match pattern](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
syntax — `https://portal.azure.com/*`, `*://*.microsoft.com/*` — because it's familiar to
the target audience and there are existing parsers to lean on. Provide a live "test this
pattern against the current tab" affordance in the folder editor, and a small library of
one-click presets (Entra admin center, Intune, Azure portal, Graph Explorer, Exchange
admin, Purview, GitHub).

**Matching is depth-blind.** A child folder competes on equal terms with root folders. If
`PowerShell > Exchange Online` matches `admin.exchange.microsoft.com/*` and no root folder
matches more specifically, the popup opens directly on that child with its breadcrumb
populated.

**Children do not inherit parent patterns.** A child with no patterns of its own never
auto-matches independently; its parent may match and the child is then reachable one click
away. Inheritance sounds helpful and produces baffling results in practice.

**Match scoring.** More than one folder can match. Rank by specificity, most specific wins:

1. Exact host + longest matching path prefix — `admin.site.com/feature` beats
   `admin.site.com/*`, which is the case explicitly called for
2. Exact host + `/*`
3. Wildcard subdomain (`*.contoso.com`) + path prefix
4. Wildcard subdomain + `/*`
5. Scheme-wildcard / everything else

Within a tier, longer literal path segment count wins. Ties break on the folder's manual
sort order, then on depth (shallower first). Scoring must be a pure function
`score(pattern, url) → number | null` with an exhaustive fixture table of test cases —
this is where subtle bugs will live.

### 5.2 Selection precedence

In order, on every popup open:

1. **Session override.** If the user manually selected a folder for this tab + this site,
   show that folder.
2. **Auto-match.** Otherwise, show the highest-scoring folder matching the active tab's URL.
3. **Fallback.** Otherwise, show the root view.

### 5.3 Override memory — the exact semantics

> **Revision 4 (September 2026).** The *Pinned for this site — Auto* chip was removed from
> the popup; the override logic below is unchanged but now sits behind a settings toggle
> ("Remember my folder per site", default on). Off means every open resolves by auto-match.

The requested behaviour is achievable within browser constraints. The mechanism:

**Store:** `chrome.storage.session`. It is in-memory, never synced, cleared on browser
restart, and by default readable only from trusted contexts (the popup and the service
worker) — which is all that's needed, since no content scripts are involved. Its 10MB quota
is irrelevant at this scale.

**Key:** `override:<tabId>:<origin>`, value `<folderId>`.

Keying on tab **and** origin is what delivers the requested "come back to the page and it
remembers" behaviour. Tab-only keying would carry a PowerShell override onto an unrelated
site in the same tab; origin-only keying would leak the override into every other tab.

**Resulting behaviour:**

| Event | Override survives? |
|---|---|
| Close and reopen the popup, same tab, same site | Yes |
| Navigate within the same origin (different path) | Yes |
| Reload the page (F5 / Ctrl+R) | Yes |
| Navigate away to another site, then back to the original | Yes — this is the "amazing" case, and it falls out of the key design for free |
| Switch to another tab and back | Yes |
| Open a **new** tab (new `tabId`) | No — fresh auto-match, as requested |
| Same site opened in a *different existing* tab | No — each tab has its own memory |
| Close the tab | Cleared |
| Browser restart | Cleared (session storage) |
| User clicks the "Auto" reset control | Cleared for that tab + origin |

> **Settled.** A reload does **not** clear the override. Within a tab, the manual choice is
> sticky: it survives refreshes, in-tab navigation, and leaving and returning to the site.
> It is deliberately *not* shared across tabs — opening the same page in a different tab
> starts clean, on the reasoning that a manual override is often a one-off and shouldn't
> follow the user into a new working context.
>
> This also keeps the permission surface minimal. Distinguishing a reload from an ordinary
> navigation would require the `tabs` permission plus a background `onUpdated` listener
> holding per-tab state, which is a meaningful cost for a behaviour users would likely
> read as a bug ("why did my folder jump back when I hit F5?").
>
> The only ways an override ends are: the user clicks **Auto**, the tab closes, or the
> browser restarts. All three are unambiguous user actions, which is what makes the
> stateful behaviour explainable.

**Cleanup.** Register `chrome.tabs.onRemoved` at the service-worker top level and delete
all `override:<tabId>:*` keys for that tab. This listener needs no `tabs` permission,
because it only receives the tab ID and not any sensitive tab fields. As a belt-and-braces
measure against a service worker that was asleep at the wrong moment, cap the override map
at ~200 entries with LRU eviction.

**Surfacing state to the user.** Silent stateful behaviour is confusing behaviour. When an
override is active, show a small chip under the breadcrumb: *"Pinned for this site — Auto"*
where "Auto" is the reset control. When auto-match placed you somewhere, show
*"Matched admin.site.com"* instead. Both chips are one line and dismissible.

### 5.4 Acceptance criteria

Write these as tests. The first six are unit-testable against the matcher and a mocked
session store; the rest need a Playwright or manual pass.

- Two folders match, `https://admin.site.com/*` and `https://admin.site.com/feature/*`,
  and the tab is on `/feature/x` → the `/feature/*` folder wins.
- A child folder's pattern outscores every root folder's → the popup opens on that child
  with its breadcrumb showing the parent.
- A child with no patterns never auto-matches, even when its parent's pattern matches.
- No folder matches → root view, no chip, no error state.
- Manual selection on tab 7 at `admin.site.com` → reopening the popup on tab 7 at
  `admin.site.com/other` shows the override.
- Same tab navigates to `github.com`, override does not apply; navigating back to
  `admin.site.com` restores it.
- A second tab on `admin.site.com` auto-matches normally and is unaffected.
- Clicking "Auto" on the chip clears the override and immediately re-runs auto-match.
- Closing tab 7 and opening a new tab on `admin.site.com` auto-matches.

### 5.5 Discovery affordance

> **Revision 4 (September 2026).** The three-picks counter proved opaque in use ("I didn't
> catch when it was offered"). Replaced by a single, predictable offer: right after a folder
> is created from the popup while the current site matches no folder, the popup asks
> whether to open that folder on this site. Declining hides it; *Map to host* stays in the
> folder menu. The session counters were removed.

When the user is on a URL that matches no folder, and the folder they manually pick is used
more than twice on that host, offer once: *"Map this folder to `intune.microsoft.com`?"*
One click to accept. This is how the mapping feature actually gets adopted rather than
sitting unused in settings.

---

## 6. Making it structurally anti-credential

This deserves its own section because it's the part most likely to erode during
implementation.

**Schema-level:**
- A snippet has exactly two user-editable fields: `label` (optional, single line, ≤60
  chars) and `value` (single field, ≤2,000 chars). There is no third field. Ever.
- No `notes`, no `username`, no paired fields, no key-value rows, no attachments.
- 2,000 chars comfortably fits a long Graph query or a chunky PowerShell one-liner, and
  comfortably excludes a PEM block or a certificate.

**UI-level:**
- Values are **always rendered in plaintext**. No dots, no masking, no reveal toggle, no
  "hidden" state. This is an intentional anti-feature.
- A persistent, low-key line in the footer or settings: *"Snippets are stored unencrypted
  and synced with your browser profile. Don't store passwords, tokens or keys here."*
- No autofill, no field detection, no "log me in" affordances anywhere in the product.

**Permission-level:**
- Do **not** request `clipboardRead`. You only ever write.
- Do **not** request broad host permissions or inject content scripts in v1.
- Use `activeTab` to read the current tab's URL. It's granted on the user gesture of
  clicking the extension icon, which is exactly when the popup needs it. This keeps the
  permission prompt to almost nothing and makes both store reviews and corporate approval
  far easier.

### 6.1 Inline secret detection

**Presentation: inline only.** No modal, no confirm dialog, no toast, nothing blocking.
When a suspected secret is detected in the value field:

- the field gets a red border
- a short line appears beneath it: *"This looks like a credential. Snippets are stored in
  plaintext — don't save secrets here."*
- **the Save button stays enabled.** The warning informs; it never gates. A blocking rule
  would be worked around within a week and would poison the extension's reputation for the
  legitimate case.

Detection runs on `input` and on `paste`, debounced ~150ms, entirely locally. Nothing is
transmitted, logged, or stored about the match.

**Strict patterns only.** Minimising false positives has a specific, important consequence
for this audience: **all entropy-based and length-based heuristics must be dropped.** The
intended snippet library is full of high-entropy strings that are completely legitimate and
must never trigger a warning —

- GUIDs: tenant IDs, app IDs, object IDs, policy IDs
- Certificate thumbprints (40 hex characters)
- Base64 payloads from `powershell -EncodedCommand`
- Long Graph URLs with `$filter` expressions and encoded parameters
- KQL queries containing hashes
- Device IDs, Autopilot hardware hashes

A generic "long high-entropy base64 string" rule would fire on most of that. So detection
is a fixed allowlist of **known credential formats with distinctive prefixes or
structure**, and nothing else:

| Secret type | Pattern (verify each against current issuer format at build time) |
|---|---|
| PEM key block | `-----BEGIN [A-Z ]*PRIVATE KEY-----` |
| JWT | `\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b` |
| GitHub token | `\bgh[pousr]_[A-Za-z0-9]{36}\b` and `\bgithub_pat_[A-Za-z0-9_]{22,}\b` |
| AWS access key | `\b(?:AKIA\|ASIA)[0-9A-Z]{16}\b` |
| Slack token | `\bxox[baprs]-[A-Za-z0-9-]{10,}\b` |
| OpenAI / Anthropic key | `\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b` |
| Google API key | `\bAIza[0-9A-Za-z_-]{35}\b` |
| Azure Storage key | `AccountKey=[A-Za-z0-9+/=]{40,}` |
| SQL connection string | `(?:Password\|Pwd)\s*=\s*[^;\s]+` **only when** the value also contains `Server=` or `Data Source=` |

Entra/Azure AD client secrets have a recognisable shape but the format has changed across
generations; research the current one and only add it if it meets the admission criteria
below.

**Decision rule for admitting a pattern.** A pattern ships only if it satisfies all three:

1. It anchors on a **fixed literal prefix or structural marker** issued by a known
   provider (`eyJ`, `ghp_`, `AKIA`, `AIza`, `-----BEGIN`, `AccountKey=`). No pattern may
   match on shape alone.
2. It produces **zero hits** against the false-positive fixture set.
3. A false positive would be **obviously wrong to the user**, not merely arguable — the
   warning has to read as correct every time it appears, or people stop reading it.

When a pattern fails on false positives, it is **removed, not tuned**. Loosening a regex to
keep marginal coverage is how this feature degrades into noise. Missing a credential type
costs almost nothing here, because the warning was never a security control — it's a nudge,
and §6's structural constraints are doing the actual work.

Ship the pattern list as data, not inline regex literals, so it can be extended without
touching logic. Add a settings toggle to disable warnings entirely (default on), and state
in the README that this is a nudge rather than a control.

**Deliberately excluded**, despite being tempting:

- Entropy or length scoring of any kind (fires on encoded commands and hardware hashes)
- Bare `password=` / `secret=` without connection-string context (fires on
  `-Password $cred`, `New-MgUser -PasswordProfile`, and half of every credential-rotation
  one-liner)
- Keyword matching on the **label** field. "Prod admin password" is a real signal, but so
  are "reset user password" and "rotate app secret" — legitimate labels for legitimate
  command snippets. Fails criterion 3.

> **Revision 4 (September 2026).** At the owner's request the exclusion on bare
> `password=` was relaxed into a second, *context* tier: a password/secret/key/token
> keyword immediately followed by a **literal** value that carries a digit or a
> password-style symbol. Variables, placeholders, expressions and cmdlet names never
> count, so `-Password $cred`, `password=<your-password>` and `New-MgUser
> -PasswordProfile` stay quiet while `password=Hunter2!` and `-ClientSecret "…"`
> fire. Label keywords are still never matched alone; combined with a value that is
> one bare password-shaped token they now count. Entropy and length scoring remain
> banned. The fixture set grew past 100 strings to defend this.

**Test both directions.** The false-positive fixture set matters more than the
true-positive one and is a required P3 artifact: a table of at least 30 legitimate admin
strings — GUIDs, tenant and app IDs, 40-char certificate thumbprints, `-EncodedCommand`
base64, Graph URLs with `$filter` and encoded parameters, KQL containing hashes, Autopilot
hardware hashes — all asserted to produce zero warnings in CI. Add to it whenever a real
snippet trips a warning it shouldn't.

---

## 7. Suggested additions (beyond the original list)

Ordered by value-to-effort. Everything marked **v2** stays out of the first release.

**High value, build in v1:**

1. **Keyboard-first popup.** Search field auto-focused on open; type to fuzzy-filter across
   the whole tree; ↑/↓ to move; Enter to copy and close; Esc to dismiss. With nesting this
   moves from "nice" to "essential" — it is the fastest path once the tree has depth.
2. **A global keyboard shortcut** via `chrome.commands` (suggest `Ctrl+Shift+Y`, but let
   the user rebind) to open the popup without reaching for the mouse.
3. **Copy confirmation.** Inline "Copied" state on the row itself for ~1.2s. No toast that
   covers the list.
4. **Usage-aware ordering.** Track `usedCount` and `lastUsedAt`; offer sort modes: manual,
   most used, recently used. Cheap to build, disproportionately useful once you have 40+
   snippets across a tree.
5. **JSON import/export.** Required (see §3). Also the sharing mechanism — a colleague
   asks for your Graph queries, you send them a file. Export must preserve hierarchy.

**High value, v2:**

6. **Placeholder tokens.** `{{tenantId}}`, `{{upn}}`, `{{today}}`. On copy, prompt for any
   unfilled variables in a tiny inline form, remember the last value per variable per
   folder. For a multi-tenant administrator this is probably the single biggest real-world
   time saver in the whole concept — the same twelve queries, different tenant every time.
   Deferred only because it needs its own UI and shouldn't delay v1. Note the interaction
   with §6: variable values are *also* stored in plaintext, so the same warning applies to
   them, and `{{clientSecret}}` should be actively discouraged.
7. **`chrome.storage.managed` policy folders.** Read-only folders pushed by an
   administrator via Edge/Chrome policy (ADMX, or Intune Settings Catalog / Edge policy
   CSP). Rendered with a lock icon and non-editable, sitting alongside the user's own tree.
   An IT department can ship a curated "standard commands" folder to a whole team, and it
   costs you no backend at all. No competitor appears to do this, it maps directly onto the
   environment you work in every day, and it is the most defensible feature on this list.
8. **"Add snippet from selection"** context menu — optional and off by default, since it
   needs `contextMenus`. Note this is *manual capture on user gesture*, categorically
   different from the auto-capture clipboard managers do.

**Explicitly recommended against for v1:**

- Insert-into-focused-field. Requires content scripts and broad host permissions,
  destroying the minimal-permission story from §6, and it's the crowded part of the market.
  Copy-to-clipboard is enough.
- Any form of cloud sharing or team sync. Violates principle 2. Use export/import, or
  managed storage for the org case.
- Depth beyond `MAX_DEPTH`. Unlimited nesting in an 800×600 popup is a navigation problem
  with no good answer.

---

## 8. Technical specification

**Platform:** Manifest V3. One codebase, two store submissions (Chrome Web Store and Edge
Add-ons accept the same MV3 package).

**Stack:** TypeScript + Vite + React (or Preact for bundle size — popup-only, so either is
fine). Vitest for unit tests. No CSS framework required; if one is wanted, keep it to
Tailwind and prune aggressively.

**Structure:**

```
src/
  popup/            # the entire user-facing surface
  options/          # folder tree management, URL patterns, settings, quota meter, import/export
  lib/
    storage.ts      # sync/local abstraction: chunking, quota + item accounting, debounce, migration
    schema.ts       # types + zod validation + schemaVersion migrations
    tree.ts         # parentId graph: depth enforcement, move/reparent, delete cascade, path lookup
    matcher.ts      # match-pattern parsing, scoring, precedence resolution — pure, testable
    session.ts      # tab+origin override map: read, write, clear, LRU cap
    guards.ts       # secret pattern list + detection
    clipboard.ts
  background/       # service worker: commands, tabs.onRemoved cleanup, (v2) context menus
```

`matcher.ts`, `tree.ts`, `session.ts`, `guards.ts` and `storage.ts` must be pure (or
thinly wrapped over a mockable storage interface) and fully unit-tested. They hold all the
logic that is miserable to debug through a popup.

**Manifest permissions (v1, keep this list short):**
`storage`, `activeTab`. That's it. No host permissions, no `tabs`, no `clipboardRead`, no
content scripts. If a future feature seems to need `tabs`, re-read §5.3 first.

**Data model:**

```ts
type SchemaVersion = 1;

export const MAX_DEPTH = 2;        // root + one child level; see §4
export const MAX_SNIPPET_CHARS = 2000;
export const MAX_LABEL_CHARS = 60;

interface Snippet {
  id: string;            // uuid
  label?: string;        // ≤60 chars, optional
  value: string;         // ≤2000 chars, plaintext, always visible
  order: number;
  createdAt: number;
  usedCount: number;
  lastUsedAt?: number;
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;      // null = root; depth enforced against MAX_DEPTH
  order: number;                // sort order among siblings
  urlPatterns: string[];        // chrome match-pattern syntax; not inherited by children
  snippets: Snippet[];          // a folder may hold snippets and children simultaneously
  rollUpDescendants?: boolean;  // remembered "show all in this folder" toggle
  source: 'user' | 'managed';   // 'managed' is read-only (v2)
}

interface Meta {
  schemaVersion: SchemaVersion;
  folderIds: string[];          // all folders, flat; hierarchy lives in parentId
  settings: {
    sortMode: 'manual' | 'mostUsed' | 'recent';
    theme: 'system' | 'light' | 'dark';
    warnOnSecretShapedValues: boolean;  // default true
  };
}

// storage.session, not sync
type OverrideKey = `override:${number}:${string}`;   // override:<tabId>:<origin>
type OverrideValue = string;                          // folderId
```

Storage keys: `meta`, `folder:<id>` (chunked as `folder:<id>:<n>` when >7.5KB).
Every read path must tolerate a missing chunk or an orphaned `parentId` without throwing —
recover by reparenting orphans to root and logging once.

---

## 9. Delivery phases

Each phase should end with something installable via "Load unpacked".

**P0 — Foundation.** Repo scaffold, MV3 manifest, build pipeline, `schema.ts`,
`storage.ts` with chunking + quota and item accounting + debounced writes + migration hook,
`tree.ts` with depth enforcement and cascade rules. Unit tests for storage round-tripping,
chunk splitting, quota-exceeded handling, depth violations, orphan recovery. No UI.

**P1 — Core loop.** Popup: root view, drill-down with breadcrumb, click to copy, add /
edit / delete snippets and folders, tree-wide search. Options page with drag-and-drop tree
management. This phase alone should already be usable daily.

**P2 — Context awareness.** `matcher.ts` with full coverage against a fixture table of URLs
and patterns, including the depth-blind and specificity cases from §5.4. Folder
URL-pattern editor with live testing against the current tab and preset shortcuts.
`session.ts` override memory with the tab+origin key, the `tabs.onRemoved` cleanup
listener, the state chip, and the "Auto" reset. Every §5.4 acceptance criterion green.

**P3 — Guardrails and identity.** `guards.ts` with the strict pattern list, inline red
border and warning text, the false-positive fixture set in CI, length caps, plaintext
disclosure copy, sync-status and quota indicators, local-overflow fallback. This is where
the product's stance becomes visible; don't let it slip to "later".

**P4 — Ergonomics.** Keyboard navigation and fuzzy search across the tree,
`chrome.commands` shortcut, usage-based sorting, JSON import/export with hierarchy, dark
mode, empty states.

**P5 — Ship.** Icons, screenshots, store listings, privacy policy (short and honest: no
data leaves the browser except via the user's own profile sync), README, MIT license,
public GitHub repo.

**P6 — v2 features.** Placeholder tokens; `storage.managed` policy folders with ADMX /
Intune deployment notes; optional context-menu capture.

---

## 10. Naming

A note on the shortlist. **Avoid anything that sounds like a password manager** — this
matters more than usual given §1. "Memory Buddy", and especially anything using *Vault*,
*Keeper*, *Safe*, *Locker* or *Secrets*, work against the positioning. "ForgetMeNot" is
also already in use by several extensions.

Names that lean into the actual job — reusable commands for people who administer things:

- **Cheatsheet** / **Cheatsheet for Admins**
- **Runbook** (strong resonance with the ops audience)
- **Command Drawer** / **Snippet Drawer**
- **Handy**
- **Recall** *(check for collisions — Microsoft has a product by that name)*
- **CommandMemory** — of the original three, this is the clearest about what it does

Check name availability on both the Chrome Web Store and Edge Add-ons before committing,
and grab the GitHub repo name at the same time.

---

## 11. Open questions

Decided and closed: folder depth (§4), reload behaviour and cross-tab reset (§5.3),
credential-detection strategy (§6.1). What remains:

- Should the override key be the **origin**, or the **folder that auto-match would have
  chosen**? Origin is specified because it's predictable and explainable in one line of UI
  copy. The alternative — "remember that on pages like this, I prefer folder X" — is more
  powerful and generalises across sites, but is much harder to explain and to reason about
  when no folder matches. Origin first; revisit if it feels too narrow in use.
- Should a snippet be able to belong to more than one folder? Simpler answer is no — a
  folder is a location, not a tag. Nesting reduces the pressure for this. Revisit only if
  it bites; tags would be the cleaner answer than multi-parenting if it does.
- Multi-line values: allowed within the 2,000-char cap, or single-line only? Multi-line is
  genuinely useful for PowerShell blocks; single-line is a stronger anti-credential signal.
  Leaning toward allowing multi-line and relying on the length cap plus §6.1 instead.
- Does the Yinson tenant's Edge sync policy actually permit extension-data sync on work
  profiles? Verify early — it affects whether you can dogfood this at work.
