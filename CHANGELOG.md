# Changelog

All notable changes to My-Feedbacks are documented here.

## [2.0.0] — Final Chrome Web Store-ready release

Closes the gaps identified at the end of v1.x : the new event-sourced
core is no longer parallel to the legacy STATE — it's now genuinely
integrated.

### Added — legacy ↔ event store bridges (PR #136)

- `sidepanel/legacy-event-bridge.js` — wraps MyFbStorage.persist and
  emits the corresponding events whenever STATE.demandes mutates :
  demande.created / .text_updated / .deleted, ref.added / .removed,
  demande.tagged / .untagged. Legacy refs without ids are synthesised
  as `legacy:<demandeId>:<index>`. Idempotent via a shadow snapshot.
- `sidepanel/state-sync.js` — reverse bridge that subscribes to the
  transport, patches STATE.demandes in place when a remote event
  arrives, and triggers `renderSegments()`. Calls syncShadow() to
  avoid the forward bridge re-emitting the same change.

Result : a user creating a demande through the legacy submit flow
now produces real events in IndexedDB, which the sync engine then
pushes to peers; conversely, a remote demande appears live in the
existing UI without reload.

### Added — E2E encryption foundation (PR #137)

- `shared/core/crypto/keypair.js` — generate / loadOrCreate /
  deriveSharedKey / encrypt / decrypt using SubtleCrypto :
  ECDH P-256 for key agreement, AES-GCM-256 for symmetric payload
  encryption. Envelopes are "iv:ct" base64 strings safe to put in
  the JSONL stream.

### Added — opt-in anonymous telemetry + AI prompts in user's language (PR #138)

- `shared/core/telemetry.js` — strict opt-in (default OFF), local-only
  counters in v2.0. Whitelist of 11 event names. NEVER collects UUID,
  IP, user text, URLs, etc — header docs every guarantee.
- `shared/core/ai-client.js` — new `_detectLang()` helper reads
  `MyFbI18n.getLang()` and pins the system prompt to that language
  (Reply in French / English / etc) instead of "same as input".

### Added — privacy controls UI (PR #139)

- `sidepanel/privacy-controls.js` + CSS : 3 controls in Settings →
  "Vos données" :
    • Telemetry opt-in toggle + live local counter + reset button
    • 🔒 E2E encryption opt-in (persisted in chrome.storage.local
      under `myfb:e2e:enabled`)
    • 🔄 Reload extension button (chrome.runtime.reload())
- 14 new `priv.*` i18n keys × 7 langs.

### Notes for the next major (server tiers)

Everything above is purely client-side. The roadmap from this point
on involves a backend :

- Tier 3 server (PHP/MySQL, open-source AGPL) — separate repo
- Tier 4 cloud (my-feedbacks.com on o2switch) — multi-tenant + Stripe
- Public Plausible endpoint for the telemetry counters (currently
  local-only)
- Transport-level encrypt/decrypt wiring (the crypto primitives are
  ready ; the sync-engine just needs to call them when the toggle
  is ON and we have a peer publicJwk)
- Webhooks / issue-tracker integrations

The extension v2.0.0 is feature-complete for what it can do
without a server. Numbers : 547+ i18n keys × 7 langs = 3,800+
translations, 31 test files, 366 tests passing, ~5,000 LOC across
the v2 bridges and crypto.


Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — Unreleased

Initial public release under the **My-Feedbacks** brand. Local-first
feedback bridge between developers and their clients. Event-sourced
core, 4-tier sync architecture (solo / shared-folder / self-hosted /
cloud), AI-native via Claude, GDPR-conscious from day one.

### Highlights

- **Event sourcing** — every state change is an immutable event in
  IndexedDB. Sync, undo, audit log and multi-device become trivial.
- **4-screen onboarding wizard** — role (admin / client), identity,
  pairing (placeholder for v1.7+), RGPD consent.
- **Persistent ref overlays** — toggle 👁 in topbar to show captured
  picker / screenshot regions as cadres on the host page, with badge
  showing the demande number. Click badge → opens the panel.
- **Triage workflow** — status (new / accepted / rejected / shipped),
  priority (low / medium / high / critical), assignee, tags, and a
  threaded comments API.
- **Passive capture** — last 20 breadcrumbs (clicks, submits, focus,
  navigations) + last 20 network failures + JS errors. Auto-attached
  to feedbacks per consent toggle.
- **Tier 2 sync (shared folder)** — point two installs at the same
  Drive / Dropbox / OneDrive folder, sync via append-only JSONL.
  Conflict-free thanks to idempotent event ids.
- **AI integration** — paste your Anthropic API key in Settings, get
  `summarize()` and `suggestTriage()` on any feedback. Choice between
  Claude Opus 4.7 / Sonnet 4.6 / Haiku 4.5.
- **Multi-target export** — one-click send to Claude.ai, ChatGPT,
  Gemini, Mistral, Perplexity, Cursor, Aider, VS Code Copilot, mailto.
- **Privacy first** — local-first by design, opt-in consent toggles,
  PII auto-scrubbing always-on, no telemetry, no analytics, no phone-
  home. EU-friendly defaults.

### Changed (BREAKING — fresh launch, no migration)
- **Rebrand** : `BIAIF` → `MyFb` (code), `BI Chrome AI Feedback` →
  `My-Feedbacks` (user-facing). New domain target: my-feedbacks.com.
- **Storage** : clé bumped à `myfb:v1:state`. Pas de migration depuis les
  anciennes clés (`biaif:vXX:state`) — c'est un fresh launch.
- **VS Code bridge** : renommé `my-feedbacks-vscode-bridge` (port 51473
  inchangé pour ne pas casser les setups locaux en cours de test).
- **CI** : `package-lock.json` est désormais committé (corrige l'échec
  setup-node `cache: 'npm'` qui bloquait toutes les PRs).

### Added — event sourcing foundation
- **`shared/core/events/catalog.js`** — catalogue de 28 types d'events,
  schema versioning, validation, ordering déterministe (lamportTs + id).
- **`shared/core/events/lamport.js`** — horloge logique Lamport pour la
  sync future entre peers sans coordination centrale.
- **`shared/core/events/store.js`** — event store IndexedDB raw (zéro
  dépendance), append-only, idempotent sur duplicate ids, KV meta pour
  l'horloge et les cursors de sync.
- **`shared/core/events/reducer.js`** — reducer pur qui dérive l'état
  complet (workspaces, demandes, devices, links) depuis le log d'events.
  Forward-compatible (skip les events de schema future).
- **`shared/core/transports/interface.js`** — contrat unifié (init/push/
  pull/subscribe/status/dispose) pour les 4 tiers de sync.
- **`shared/core/transports/solo.js`** — implémentation no-op pour le tier
  1 (utilisateur solo, zéro sync).

### Tests
- 46 nouveaux tests (`tests/core/`) : catalog, lamport, store, reducer,
  transport-solo. Couvre l'idempotence sync, l'ordering, la
  forward-compat, et le KV meta.

### Added — runtime + onboarding (was v1.1 + v1.2)

- **`shared/core/device-meta.js`** — persistent UUID in chrome.storage.sync,
  rich `collectDeviceMeta()` snapshot (browser, OS, viewport, DPR, screen,
  hardware, prefs, network, locale, performance), `anonymize()` for the
  opt-in anonymous mode.
- **`shared/core/profile.js`** — admin/client role + RGPD consent toggles,
  conservative client defaults (breadcrumbs off), validate / update /
  acceptConsent / hasOnboarded helpers, chrome.storage.sync persistence.
- **`shared/core/bootstrap.js`** — `init()` that opens IndexedDB,
  hydrates the lamport clock, loads/creates UUID, loads profile,
  replays events, emits `device.connected` on first run, returns a
  ctx with an `emit(type, payload)` helper.
- **`sidepanel/runtime.js`** — orchestrates `bootstrap.init()` + the
  first-launch onboarding overlay. Fire-and-forget so failures don't
  block the legacy UI.
- **`sidepanel/onboarding.js` + CSS** — 4-screen overlay (role /
  identity / pairing-placeholder / RGPD consent). Skippable from any
  screen, falls back to a conservative admin profile.

### Added — page overlays (was v1.3)

- **`content/ref-overlay.js`** — Shadow-DOM mounted overlay layer,
  z-index max - 1, `pointer-events: none`. Re-resolves `ref.selector`
  each frame, falls back to stored `box` with stale style if element
  is gone. Bucket overlapping refs into a single overlay with combined
  badge ("1+2"). Repositions on scroll / resize / SPA URL change.
- **`sidepanel/overlay-controller.js`** — toggle button in topbar-extras
  with mini count badge. Broadcasts ref list filtered by active tab
  URL via `chrome.tabs.sendMessage`.
- Badge click → side panel scrolls + flashes the matching segment card.

### Added — triage workflow (was v1.4)

- **`sidepanel/triage-api.js`** — `MyFbTriage.{setStatus,getStatus,
  setPriority,getPriority,setAssignee,getAssignee,addTag,removeTag,
  getTags,addComment,editComment,deleteComment,listComments,
  listByStatus,listByPriority,listByAssignee,listByTag,statusCounts}`.
  All headless-testable, safe no-ops when runtime not booted.

### Added — passive capture + tier 2 sync (was v1.5)

- **`content/breadcrumbs.js`** — rolling 20-entry buffer of click /
  submit / focus / navigate. Never captures field values, skips
  password/cc inputs entirely. PII-scrubbed via MyFbScrub.
- **`content/network-monitor.js`** (MAIN world) — wraps `window.fetch`
  + `XMLHttpRequest.send` to keep last 20 FAILURES (status ≥ 400 OR
  network error). No body, no headers, no cookies.
- **`shared/core/transports/shared-folder.js`** — append-only JSONL
  via File System Access API. Push / pull / subscribe / dispose.
  Conflict-free via event-id dedup.
- Wired into `bootstrap._createTransport` so `MyFb.runtime` can pick
  this tier as soon as the UI lets the user choose a folder.

### Added — AI client + export targets (was v1.6)

- **`shared/core/ai-client.js`** — thin wrapper over Anthropic Messages
  API. `summarize()`, `suggestTriage()`, `complete()`. Picks model
  from Opus 4.7 / Sonnet 4.6 / Haiku 4.5 (default haiku). API key
  stored locally only. CSP allows `https://api.anthropic.com`.
- **`shared/core/export-targets.js`** — catalog of 9 destinations with
  per-target URL builders: claude / chatgpt / gemini / mistral /
  perplexity / cursor / aider / vscode-copilot / mailto.

### Privacy / Security

- PRIVACY.md exhaustively updated with the v1 storage layout,
  consent toggles, and network-call inventory (every outbound HTTP
  documented — there are very few).

### Tests

- **296 tests** (vs 168 in pre-v1 BIAIF) covering the entire new core
  + onboarding + overlay controller + triage API + AI client +
  export targets + shared-folder transport.
- All run headless via Vitest + jsdom + fake-indexeddb.

### Notes for future work (v1.x roadmap visible in README)

- v1.7: Settings → AI panel UI for API key input
- v1.7: Per-segment "Summarize" + "Suggest triage" buttons
- v1.7: Multi-target export picker on segment cards
- v1.8: Tier 2 folder-picker UI in Settings → Sync
- v2.0: Tier 3 (self-hosted PHP/MySQL server, open-source AGPL)
- v2.x: Tier 4 (my-feedbacks.com hosted cloud)

### Added — visible UI for v1.0.0 launch (PRs 9 → 18)

**AI integration UI** (v1.8)
- `sidepanel/ai-ui.js` — Settings → IA section with API key input
  (password, 600 ms debounced save), model picker (Opus 4.7 / Sonnet
  4.6 / Haiku 4.5), "Test connection" button + status badge
- Per-card ✨ button (decorator) opens a menu with "Résumer cette
  demande" and "Suggérer un triage" — calls Anthropic, renders result
  inline, applies suggested triage with one click

**Settings UI complete** (v1.9)
- Settings → "Cet appareil" — UUID display + 📋 copy + live deviceMeta
  dump (browser, OS, viewport, DPR, deviceClass, language, network) +
  "Refaire l'onboarding" / "Régénérer l'UUID" buttons
- Settings → "Synchronisation" — 4-mode picker (Solo / Shared folder /
  Self-hosted [v2.0] / Cloud [v2.0+]). For "Shared folder" :
  showDirectoryPicker() integration that hands the dirHandle to the
  tier-2 transport, hot-swaps runtime.transport, shows live status
- Settings → "Liaisons" — empty state + structured list once partners
  exist (rows with role + status pill)

**Sync engine** (v1.10)
- `shared/core/sync-engine.js` — bridges the local event store and
  the active transport. ingest / syncNow / pushOne / start / stop /
  status. Auto-pull every 30 s (configurable). Idempotent dedup via
  seen-set + store ConstraintError. attach(ctx) wraps ctx.emit so
  locally-emitted events auto-push.

**Per-card export picker** (v1.11)
- `sidepanel/export-picker.js` + `content/network-bridge.js` :
  ↗ button on each card opens a 9-target menu (Claude / ChatGPT /
  Gemini / Mistral / Perplexity / Cursor / Aider / VS Code Copilot /
  mailto). Routes per kind (url / cli clipboard / mailto). Prompt
  builder pulls breadcrumbs + network failures from active tab in
  parallel — best-effort. Network bridge listens to the MAIN-world
  CustomEvent and exposes the buffer to chrome.tabs.sendMessage.

**Triage UI** (v1.12 + v1.13)
- `sidepanel/triage-ui.js` — status chip (cycle new → accepted →
  rejected → shipped), priority dot (cycle low → medium → high →
  critical, pulses on critical), tag pills with × + "+", comments
  thread with delete (confirm) + edit-flag + inline form
- `sidepanel/triage-filter.js` — pill bar above #segments with live
  counts via MyFbTriage.statusCounts(), filter persisted in
  chrome.storage.local, applies via CSS attribute selector

**GDPR data controls** (v1.14)
- `sidepanel/data-controls.js` — Settings → "Vos données" with
  ⬇ Export full bundle, 🔄 Reset profile, 🗑 Delete all my data.
  3-step confirm flow on delete (offers pre-export bundle, final ⚠
  warning, then auto-reload). Wipes chrome.storage local+sync +
  IndexedDB. RGPD compliance for Chrome Web Store EU review.

**Pairing protocol** (v1.15 + v1.16 + v1.17)
- `shared/core/pairing.js` — generateCode / parseCode / fingerprintOf.
  6-char MYFB-XXXXXX codes (Crockford-ish base32 + checksum).
  Deterministic from UUID, shareable by voice/email/chat.
- `sidepanel/pairing-ui.js` — Settings → Liaisons enriched with
  "Mon code" (admin) + 📋 copy and "Coller un code reçu" (client)
  with format/checksum/empty/self-pair handling.
- `shared/core/pairing-handler.js` — reactive layer that auto-emits
  link.accepted when a link.requested with matching fingerprint
  arrives via sync. Idempotent. resolvePlaceholders() helper swaps
  "pending:<fingerprint>" keys to full UUID once link.accepted
  is observed.

### Tests
- Total: **341 tests passing** (from 296 in the previous v1.0.0 batch)
- New : ai-client x19, export-targets x12, sync-engine x16,
  data-controls x5, pairing x13, pairing-handler x11
- DOM-heavy UI modules (triage-ui, ai-ui, settings-ui, etc.) are not
  unit-tested — their underlying APIs are.

### i18n
- 547 keys × 7 languages = **3,829 strings**
- Audit clean (`npm run i18n:check` green)

## [Unreleased]

### Changed
- **Major refactor — `sidepanel.css` split** (1581 L → 34 L entry +
  7 themed files under `sidepanel/css/`):
  - `base.css`     (165 L) — design tokens (`:root` vars), reset,
                              scrollbar, `.myfb-root` state classes
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
  gated by `localStorage.My-Feedbacks_LOG_LEVEL` or
  `chrome.storage.local.myfb_log_level`. Wired into the service worker, the
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
  My-Feedbacks buttons. Requires `autoSubmitAfterInject`.
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
