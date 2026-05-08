# Changelog

All notable changes to BI Chrome AI Feedback are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Major refactor — `sidepanel.css` split** (1581 L → 34 L entry +
  7 themed files under `sidepanel/css/`):
  - `base.css`     (165 L) — design tokens (`:root` vars), reset,
                              scrollbar, `.biaif-root` state classes
                              (armed / editing / empty), hero animations
  - `session.css`  (129 L) — session bar + quick-tools row
  - `editor.css`   (108 L) — current-demande Mad-Libs editor
  - `settings.css` (146 L) — settings popover (toggles, sections)
  - `segments.css` (511 L) — segment cards, filter chips, meta-tags,
                              archive zone, conversation groups, action
                              buttons (largest module — inherent)
  - `chrome.css`   (272 L) — sticky bottom bar, logs panel, status,
                              errors button, reload modal, toast,
                              history search, capture progress,
                              onboarding empty state
  - `wizard.css`   (243 L) — onboarding wizard modal
  - The Google-Fonts `@import` stays at the top of `sidepanel.css`
    (CSS spec: external imports must precede any other rule).
- **Major refactor — `background.js` split** (401 L → 38 L entry +
  7 modules under `background/`):
  - `lib.js`           — `MSG`, `sleep`, `sendToActiveTabContent`,
                          `openSidePanelForActive`, `waitForTabLoaded`
  - `capture.js`       — `captureWithRateLimit` queue + retry +
                          rate-limit honouring `MIN_INTERVAL_MS`
  - `inject.js`        — `injectWithRetry` (waits for editor DOM)
  - `context-menu.js`  — 4 entries + `onClicked` router
  - `auto-open.js`     — `chrome.tabs.onActivated/onUpdated` →
                          `checkAutoOpenForTab`
  - `commands.js`      — `chrome.commands.onCommand`
  - `messages.js`      — `chrome.runtime.onMessage` routing
  - `importScripts()` shares the same global scope so modules
    reference each other's top-level functions by their bare names
    (loaded top-down).
- **Repo hygiene**: `.gitignore` (OS cruft, node_modules, vsix,
  local env), `.editorconfig` (2-space, LF, UTF-8), and `console.js`
  moved into `sidepanel/console.js` where it belongs.
- **Major refactor — `sidepanel.js` split**. The 987-line orchestrator is
  now a 139-line bootstrap that owns only `STATE`, `REFS`, `cacheRefs()`,
  and the `DOMContentLoaded` sequence. Everything else moved to focused
  modules under `sidepanel/bindings/`:
  - `ctx.js`       — shared STATE/REFS accessor (mirrors `render/ctx.js`)
  - `helpers.js`   — sendBg, msgKey, decodeErr, capture subline / reload
                     modal / progress bar / linked-session banner,
                     console-error refresh, file import, context-menu
                     text/image, clearAll, performUndo
  - `tabs.js`      — chrome.tabs lifecycle, ready check, picker re-arm
  - `events.js`    — 22 small `_bind*()` per UI feature (session buttons,
                     tools, footer, lang, shot, files, errors, sort, font,
                     search, settings, reload, wizard, button-visibility,
                     auto-open, behaviour deps, ui-lang, mic, editor live
                     sync, ref-chip edit, filter badges, status bar)
  - `keyboard.js`  — global keydown (Ctrl+Z, Esc)
  - `messages.js`  — `chrome.runtime.onMessage` router + AI-event matcher
                     + handlers (status, done, open-with-filter,
                     start-linked-segment, picker-state, element-picked)
  - `hydrate.js`   — post-storage DOM sync (settings checkboxes, language)
  - `index.js`     — `bindAll()` orchestrator
- **Major refactor — `renderer.js` split** (already shipped in 0.5.0;
  cross-referenced here for completeness).

## [0.5.0] — 2025-05

### Added
- **`shared/logger.js`** — levelled logger (`debug`/`info`/`warn`/`error`)
  gated by `localStorage.BIAIF_LOG_LEVEL` or
  `chrome.storage.local.biaif_log_level`. Wired into the service worker, the
  side panel, and every content script. Replaces ad-hoc `console.warn`
  scattered across the codebase.
- **README rewrite** — comprehensive feature reference, settings table,
  architecture summary, privacy/security section, dev quickstart.
- **CONTRIBUTING.md** — file layout, code style, XSS hygiene, i18n rules,
  PR conventions, debugging tips, release process.
- **ARCHITECTURE.md** — three-context diagram (SW / sidepanel / content),
  data-flow diagrams (capture, inject, VS Code bridge), storage versioning
  model, full module map.
- **GitHub Actions CI** (`.github/workflows/ci.yml`) — JSON validation,
  per-file `node --check`, ESLint and Prettier checks (warning-only for
  now until the codebase is clean).
- **Versioned storage migration framework** — payloads now carry an
  explicit `_v` field. `_MIGRATIONS` registry runs ordered transformations
  on hydrate. Failed migrations leave data untouched rather than
  corrupting it.
- **Centralised AI host metadata** in `shared/ai-adapters.js` (`label`,
  `webUrl`, `editor`, `submitBtn`, `inputHide`, `stopBtn`, `generatingEl`).
- Conversation grouping: segments sharing a `conversationUrl` are grouped into
  a single card with collapsible done sub-segments.
- `hideAiTextarea` setting — hides Claude.ai's native input, leaving only the
  BIAIF buttons. Requires `autoSubmitAfterInject`.
- `autoOpenOnAiPage` setting — opens the side panel on any known AI host.
- `autoSubmitAfterInject` — automatically clicks the send button after
  injection (8 retries / 200 ms, Enter fallback).
- Archive zone with relative timestamp ("MAJ il y a Xs/min"), refreshed every
  30 s, for done segments without a conversationUrl.
- Keyboard accessibility for segment merge: Alt+↑/↓ on the drag handle merges
  with the previous/next demande.
- Hard cap of 50 000 chars on demande text with a warning toast.
- Debounce (150 ms) on the history search input.
- `shared/utils.js` — single source of truth for `extractGithubRepo`,
  `decodeErr`, `findAiAdapter`, `t`, `msgKey`. Replaces three duplicated
  copies of the GitHub helper and two of the error decoder.
- LICENSE (MIT), CHANGELOG, `.eslintrc.json`, `.prettierrc`.
- Explicit `content_security_policy` in `manifest.json`.
- i18n dev warnings: console logs missing translation keys / locales the
  first time they're requested.
- **Cancellable full-page capture** — the loader overlay now shows an
  "Annuler" button that flips `state.cancelRequested`. The scroll-stitch
  loop bails out at the next iteration and emits `error: 'cancelled'`.
- **Adaptive AI-watcher polling** — interval drops from 700 ms to 2000 ms
  while the AI is idle (the MutationObservers cover any actual change in
  between).

### Changed
- Manifest: removed unused `scripting` permission, added `author` and
  `minimum_chrome_version: 114` (when `chrome.sidePanel` shipped).
- Bridge VS Code: validate `resp.ok`, wrap `resp.json()` in try/catch with
  i18n'd error, raise ping timeout from 1.5 s to 3 s.
- Editor selectors moved out of `content/inject.js` into the claude.ai
  ai-adapter; `inject.js` resolves them via `utils.findAiAdapter` with a
  generic fallback list.
- Capture: serialised globally via a promise chain so concurrent callers
  (multiple windows / sidepanels) cannot trip Chrome's MAX_CAPTURE rate-limit.
- Undo stack: bumped from 20 to 50 snapshots.
- Toast queue: bumped from 2 to 4 simultaneous notifications.
- Mic permission denied: explicit 8 s toast + automatic open of the
  chrome://settings page so the user can grant permission immediately.

### Fixed
- **Memory leak in `content/ai-watcher.js`** — the polling `setInterval`
  and two `MutationObserver`s were never cleared; now tracked and torn down
  on `pagehide`.
- **`content/textarea-injector.js`** — adds `pagehide` cleanup that detaches
  every tracked input (with its `ResizeObserver` + `IntersectionObserver`)
  and disconnects the global `MutationObserver`.
- **XSS hardening in `content/screenshot.js`** — full-page-capture loader
  rebuilt via DOM API instead of `innerHTML` interpolation of `message`,
  `current`, `total`.

### Security
- **VS Code bridge hardening (breaking config)**
  - CORS `Access-Control-Allow-Origin: *` → exact-match echo of the
    requesting origin, restricted to `chrome-extension://*`,
    `moz-extension://*`, `safari-web-extension://*`.
  - Disallowed origins now receive HTTP 403.
  - Payload caps: 20 MB total body, 1 MB text, 10 images max, 8 MB per
    image (post-base64 decode).
  - Strict validation: `target` must be `'vscode'` or `'copilot'`,
    `text` must be a string, every image must be a `data:image/(png|
    jpeg|gif|webp);base64,...` URL.
  - Loopback bind (`127.0.0.1`) preserved — no LAN exposure.
  - Bridge version bumped to 0.5.0 (advertised in `/ping`).

## [0.4.0] — 2025-04 (initial public release)

### Added
- Manifest V3 service-worker architecture.
- Side panel UI with editable demande chips, drag-drop merge, history
  search, archive zone, conversation grouping.
- Element picker, full-page screenshots, screenshot annotation editor,
  console error capture (MAIN-world bridge).
- Speech-to-text (Web Speech API) with watchdog and interim ghost.
- VS Code Terminal & Copilot bridge (local HTTP server on port 51473).
- Direct injection into Claude.ai's Tiptap editor (text + images via
  DataTransfer drop / clipboard paste fallback).
- Open-in-new-tab handlers for Claude, ChatGPT, Gemini, Grok, Perplexity,
  Le Chat, DeepSeek.
- Auto-open side panel when switching to a tab matching a tracked
  segment / known AI host.
- 7-language i18n: French, English, Spanish, German, Italian, Portuguese,
  Dutch.
- Storage migration v01 → v04 with quota fallback (strips dataUrls when
  quota exceeded).
- Onboarding wizard.
