# Changelog

All notable changes to BI Chrome AI Feedback are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Centralised AI host metadata in `shared/ai-adapters.js` (`label`, `webUrl`,
  `editor`, `submitBtn`, `inputHide`, `stopBtn`, `generatingEl`).
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
- LICENSE (MIT), this CHANGELOG, `.eslintrc.json`, `.prettierrc`.
- Explicit `content_security_policy` in `manifest.json`.
- i18n dev warnings: console logs missing translation keys / locales the
  first time they're requested.

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
