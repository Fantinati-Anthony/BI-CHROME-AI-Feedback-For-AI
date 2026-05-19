# Architecture

High-level data flow and module responsibilities. For day-to-day code
style, lint config, and PR rules see [CONTRIBUTING.md](CONTRIBUTING.md).
For user-facing features see [README.md](README.md).

---

## Three execution contexts (Chrome MV3)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Service Worker (background.js)                                      │
│  • No DOM, no window, ephemeral                                      │
│  • Capture queue, message routing, sidepanel auto-open               │
│  • Loads via importScripts(): constants.js, utils.js, ai-adapters.js │
└──────────────────────────────────────────────────────────────────────┘
        │                          │                            │
        ▼                          ▼                            ▼
┌────────────────┐  ┌────────────────────────────┐  ┌────────────────────┐
│  Side Panel    │  │  Content Scripts           │  │  Page MAIN world   │
│  (extension UI)│  │  (per-tab, isolated world) │  │  (page-error-      │
│                │  │                            │  │   monitor.js only) │
│  • All modules │  │  • element-selector        │  │                    │
│    in shared/, │  │  • screenshot              │  │  • catches         │
│    sidepanel/  │  │  • screenshot-editor       │  │    window.onerror  │
│  • Stateful    │  │  • inject (Claude.ai)      │  │  • dispatches      │
│  • Long-lived  │  │  • textarea-injector       │  │    CustomEvent →   │
│                │  │  • ai-watcher              │  │    error-bridge    │
└────────────────┘  └────────────────────────────┘  └────────────────────┘
```

### Why these splits?

- **Service worker**: required by MV3 for background messaging. Cannot
  touch the DOM. Cannot use `setInterval` reliably (gets killed after
  ~30s of idle). All long-lived state lives in `chrome.storage`.
- **Side panel** (`sidepanel.html`): the rich UI. Has full DOM access
  but cannot inject scripts into web pages. Communicates with content
  scripts via `chrome.runtime.sendMessage` → SW → `chrome.tabs.sendMessage`.
- **Content script (isolated world)**: same DOM as the page, but its
  own JS context (so the page can't see our globals). Can read/modify
  the DOM, dispatch synthetic events.
- **Content script (MAIN world)**: shares the page's JS context.
  Required to catch `window.onerror` because page-thrown errors don't
  propagate to the isolated world. Communicates back via CustomEvent
  on `window`, picked up by `error-bridge.js` in the isolated world.

---

## Data flow: capturing an element

```
Page (target tab)             Service worker            Side panel
─────────────────             ──────────────            ──────────
User clicks "picker" btn ─────────────────────────────► sendMessage
                                                          PICKER_TOGGLE
PICKER_ENABLE ◄───────────────── chrome.tabs.sendMessage
element-selector.enable()
  shows overlay
User hovers, clicks ─────────► chrome.runtime.sendMessage
                                 ELEMENT_PICKED
                                 { descriptor, screenshot, metadata }
                               relays via runtime.sendMessage ──────► onMessage
                                                                       session.addRefToTarget()
                                                                       renderer.appendChipToEditor()
                                                                       storage.persist()
```

## Data flow: injecting into Claude.ai

```
Side panel                Service worker              Tab content script
──────────                ──────────────              ──────────────────
"Inject" button click ───► sendMessage(INJECT_TO_EDITOR
                            { text, images, targetUrl, autoSubmit })
                          maybeOpenTab(targetUrl)
                          waitForTabLoaded(tabId)
                          for ttl=15s:
                            chrome.tabs.sendMessage ──────────────► inject.js
                            INJECT_TO_EDITOR                         findEditor()
                          ◄──── { ok, text, images } ◄─────────────  injectText
                                                                     injectImage * N
                                                                     if (autoSubmit) clickSubmit
sendResponse({ ok, tabUrl, targetTabId }) ◄───────────────────────── 
toast.show("Demande #N injectée")
session._stampSubmitted(dem)
```

## Data flow: VS Code bridge (Claude Code Terminal / Copilot Chat)

```
Side panel                                   VS Code (companion ext)
──────────                                   ───────────────────────
"VS-Code Terminal" btn ──── HTTP POST 127.0.0.1:51473/inject
                            { target: 'vscode',
                              text, images: [dataUrl, ...] }
                                                        ┌─ http server (extension.js)
                                                        ▼
                                                       _saveImages → temp dir
                                                       handleInjectVscode:
                                                         clipboard.writeText(text)
                                                         showInformationMessage(...)
                            ◄──────── 200 OK { ok, text, images, tmpDir }
toast.show("Demande #N → VS-Code Terminal")
```

---

## Data flow: DB context bridge (v2.4)

Goal — feed the AI with the structure + a few rows of the client's
database so the model can reason about real schema, not hallucinate.

```
Side panel                  Service Worker          User's webserver
──────────                  ──────────────          ─────────────────
db-profiles-ui.js           messages.js             myfb-bridge.php
"🔄 Rafraîchir"
   │
   ├─ readSecret(profile) ─► AES-GCM decrypt
   │                          (key from IndexedDB,
   │                           extractable: false)
   │
   ├─ db-bridge-client.js:
   │   body = { op, args, ts, nonce }
   │   sig  = HMAC-SHA256(secret,
   │                       ts.nonce.op.canonArgs)
   │
   └─ chrome.runtime.sendMessage({
        type: 'myfb:db-bridge-call',
        url:  profile.bridgeUrl,
        body: body
      }) ──────────────────► fetch(url, POST body) ──► HMAC verify
                                                       nonce replay check
                                                       PDO prepared
                                                       op switch
                                                          (meta / tables /
                                                           describe / sample /
                                                           count / schema_md)
                             ◄──────────────────────── JSON response
       ◄──── { ok, status,                              { ok, data, version }
              body, raw }
   │
   ├─ humanizeError(status, raw)  // network ? 401 ? 5xx ?
   ├─ version check vs MIN_BRIDGE_VERSION
   │
   └─ profile.schemaMd = data.markdown
      persist(STATE)
      render()
```

**Why this routing** — sidepanel pages run under a strict CSP
(`connect-src 'self' …`) that forbids `fetch()` to arbitrary HTTPS
hosts. The service worker has no such limit, so the sidepanel signs
the body locally and asks the SW to do the actual POST.

**Why we never send the secret over the wire** — only the signature
travels. The secret stays in the extension's encrypted IndexedDB
store (`myfb-secret-crypto` DB, `extractable: false` AES-GCM key).
Even a script injected into the extension cannot `exportKey()` it.

**Why the bridge is a single PHP file** — universally drop-in on any
LAMP host (cPanel, OVH mutualisé, WordPress, …) that already runs
PHP-FPM. The setup wizard (first GET request) writes
`myfb-bridge.config.php` with the secret + DB credentials, then
self-locks. See `bridge/README.md`, `bridge/SECURITY.md` for the
threat model, `bridge/EXAMPLES.md` for curl recipes.

---

## Storage versioning

`chrome.storage.local[My-Feedbacks.STORAGE_KEY]` holds a single object with
the whole state. The key includes a version (`myfb:v1:state`).

```
┌─────────────────────────────────────────────────────────────┐
│ storage.hydrate()                                           │
│                                                             │
│   1. fetch[ KEY, ...LEGACY_KEYS ]                          │
│   2. saved = obj[KEY] || _migrateLegacy(obj)               │
│   3. apply each top-level field with type guards           │
│   4. legacy keys removed on next persist()                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ storage.persist(STATE)                                      │
│                                                             │
│   1. push undo snapshot (max 50)                            │
│   2. _buildPayload(STATE) → strict whitelist of fields      │
│   3. set({ KEY: payload })                                  │
│      └─ on QuotaExceeded: retry with dataUrls stripped      │
│   4. remove legacy keys (best-effort)                       │
│   5. _checkQuota → toast warning at 8 MB                    │
└─────────────────────────────────────────────────────────────┘
```

When bumping the version: bump `STORAGE_KEY` in `shared/constants.js`,
add the previous key to `STORAGE_LEGACY_KEYS`, and add the migration
shape transformation in `_migrateLegacy()` if needed.

---

## Module map

### `shared/`

| Module          | Loaded in            | Responsibility |
| --------------- | -------------------- | -------------- |
| `constants.js`  | SW + sidepanel + content | MSG enum, STORAGE_KEY, version, bridge port |
| `utils.js`      | SW + sidepanel + content | extractGithubRepo, decodeErr, t, msgKey, findAiAdapter |
| `ai-adapters.js`| SW + sidepanel + content | Per-AI-host config (label, webUrl, editor, submitBtn, ...) |
| `i18n.js`       | sidepanel only       | 7-lang translation table + diagnostics |
| `intent-parser.js` | sidepanel only    | "Insert tag", "Open settings" voice intents |
| `logger.js`     | SW + sidepanel + content | Levelled logger gated by storage flag |

### `content/`

| Module                 | Run-at        | World    | Purpose |
| ---------------------- | ------------- | -------- | ------- |
| `page-error-monitor.js`| document_start| **MAIN** | Catches window.onerror → CustomEvent |
| `error-bridge.js`      | document_start| isolated | Relays the CustomEvent → SW |
| `css-selector.js`      | document_idle | isolated | Unique CSS selector generator |
| `element-selector.js`  | document_idle | isolated | Picker overlay (hover + click) |
| `screenshot.js`        | document_idle | isolated | Viewport / full-page / element capture |
| `screenshot-editor.js` | document_idle | isolated | Annotation overlay (Shadow DOM) |
| `inject.js`            | document_idle | isolated | Inject text/images into Claude.ai |
| `textarea-injector.js` | document_idle | isolated | Floating My-Feedbacks buttons next to textareas |
| `ai-watcher.js`        | document_idle | isolated | AI generating/done detection (matched hosts only) |
| `main.js`              | document_idle | isolated | Hotkey listener fallback + orchestration |

### `sidepanel/`

| Module      | Responsibility |
| ----------- | -------------- |
| `storage.js`| hydrate / persist / migration / quota |
| `session.js`| session lifecycle, edit mode, finalize, merge, ref routing |
| `speech.js` | Web Speech API, mic device picker, interim ghost |
| `renderer.js`| All DOM rendering — segments, chips, editor, archive, conversation groups |
| `export.js` | Markdown prompt builder, copy, download, inject (Claude / VS Code / open in tab) |
| `toast.js`  | Notification queue (max 4) |
| `undo.js`   | Undo stack (max 50) |
| `wizard.js` | First-run onboarding modal |
| `db-bridge-client.js` (v2.4) | HMAC-SHA256 request signer + version check + `_humanizeError`. Routes the actual fetch through the SW (sidepanel CSP forbids arbitrary `connect-src`). |
| `db-profiles-ui.js`  (v2.4) | CRUD for `STATE.dbProfiles`, in-form `🔌 Tester`, `🔄 Rafraîchir`, `📋 Insérer`, `autoInjectForSession()` called from `MyFbSession.startSession()`. |
| `db-secret-crypto.js` (v2.4) | AES-GCM-256 wrap of the HMAC secret. Non-extractable WebCrypto key persisted in a dedicated IndexedDB (`myfb-secret-crypto`). |

### `background.js` (service worker)

- **Capture queue** (`captureWithRateLimit`): serialised promise chain
  to prevent concurrent `chrome.tabs.captureVisibleTab` from tripping
  Chrome's rate limit
- **Message router**: receives from sidepanel and content scripts,
  dispatches to the right tab or back to the sidepanel
- **Hotkey handler** (`chrome.commands.onCommand`)
- **Context menu** (`chrome.contextMenus`)
- **Sidepanel auto-open** on tab activation if matching a tracked URL
  or known AI host

---

## Module pattern (IIFE + soft CommonJS export)

Every module is a self-attaching IIFE:

```js
(function (root) {
  'use strict';
  function foo() { /* ... */ }
  var api = { foo };
  root.My-FeedbacksThing = api;
  // Soft ESM — exposes the same surface to Node/Vitest, no-op in browsers
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

This pattern lets us keep zero-build classic `<script>` loading in MV3 **and**
import the same source from Vitest (vite-node) for unit tests, without a
transpilation step. Files with pure logic (`shared/scrub.js`,
`shared/utils.js`, `shared/ai-adapters.js`, `sidepanel/imaging.js`,
`sidepanel/templates.js`) all follow this convention.

For type-checking, opt into TypeScript's JSDoc mode by adding `// @ts-check`
at the top of the file. Ambient types live in `types/myfb.d.ts` and are
picked up via `jsconfig.json`.

## Conventions

- **Globals**: every module exposes one `window.My-Feedbacks<Name>` object.
  No bare globals.
- **No DOM in SW**: `background.js` cannot import any module that
  touches `document` / `window`. `shared/utils.js` is written to be
  safe in both contexts.
- **Messaging**: always go through `chrome.runtime.sendMessage` (to SW)
  → `chrome.tabs.sendMessage` (to a specific tab). Never use
  `window.postMessage` between contexts.
- **Persisted state**: only fields explicitly listed in
  `_buildPayload()` survive a reload. Adding a new state field requires
  adding it to both `_buildPayload` and the `hydrate()` whitelist.
- **i18n keys**: hierarchical, dot-separated (`toast.bridge_offline`,
  `aria.delete_demande`). New keys require entries in **all 7
  languages**.
- **Selectors for AI hosts**: live in `shared/ai-adapters.js`, never
  hard-coded inside content scripts.
