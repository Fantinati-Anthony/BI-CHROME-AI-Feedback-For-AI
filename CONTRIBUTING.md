# Contributing to My-Feedbacks

Thanks for considering a contribution! This document covers everything
you need to start hacking — repo layout, dev workflow, code style, and
PR conventions.

## TL;DR

```bash
git clone https://github.com/Fantinati-Anthony/BI-CHROME-AI-Feedback-For-AI.git
cd BI-CHROME-AI-Feedback-For-AI
# Load the unpacked extension in chrome://extensions/ (Developer mode on)
# Edit. Reload the extension. Reload the target tab.

npx eslint .          # lint
npx prettier --check . # format check
```

There is intentionally **no build step** — files are loaded as-is by
Chrome. Reload after every change.

---

## Project structure

```
manifest.json          MV3 manifest — content scripts, permissions, CSP
background.js          Service worker (no DOM access — pure messaging /
                       capture-queue / sidepanel auto-open)

shared/                Shared between SW, content scripts, and side panel
content/               Injected into web pages
sidepanel/             Side panel modules
sidepanel.{html,css,js}

vscode-extension/      Companion VS Code extension (HTTP bridge)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for data flow and module
responsibilities.

---

## Loading the extension

1. `chrome://extensions/` → enable **Developer mode**
2. Click **Load unpacked**, select the repo root (containing `manifest.json`)
3. Pin the extension in the toolbar
4. Open the side panel (`Alt+Shift+F` or click the toolbar icon)
5. After **every** code change: click the circular reload arrow in
   `chrome://extensions/`, then refresh the target tab.

To install the VS Code companion:

```bash
cd vscode-extension
npm install -g vsce            # one-time
vsce package
code --install-extension my-feedbacks-vscode-bridge-*.vsix
```

---

## Code style

- **No build step**, no TypeScript — vanilla ES2022 modules in IIFEs
  (because they need to coexist with `importScripts()` in the service
  worker and content-script injection)
- ESLint + Prettier configured at the repo root. CI runs both on every
  push (see `.github/workflows/ci.yml`).
- Use `const` / `let` for new code. Existing `var` is tolerated; don't
  bulk-refactor without a reason.
- Wrap every module in an IIFE: `(function (window) { ... })(window);`
  and expose a single namespace under `window.My-Feedbacks*`.
- All async messaging through `chrome.runtime.sendMessage` /
  `chrome.tabs.sendMessage` should `.catch(() => {})` to avoid
  unhandled rejection warnings when the receiving end isn't ready —
  but **log** the error via `My-Feedbacks.log.warn` if it actually matters.
- Reserve `console.log` / `console.warn` for the logger module
  (`shared/logger.js`). Use `My-Feedbacks.log.debug/info/warn/error` everywhere
  else. Set `localStorage.My-Feedbacks_LOG_LEVEL = 'debug'` in the side panel
  (or content script) to enable verbose logs.

### XSS hygiene

- **Never use `innerHTML` for user data.** Use `textContent` or
  `createElement` + `appendChild`. The few `innerHTML` calls remaining
  in the codebase are for static SVGs / templates with zero
  interpolation.
- Always pass user-controlled strings through `esc()` (renderer.js,
  toast.js) before injecting into HTML attributes.

### i18n

- Every user-facing string goes through `_t(key, fallbackFr, vars)`.
  The fallback is shown if the key is missing (with a `console.warn`
  in dev).
- Add new strings in **all 7 languages** in `shared/i18n.js`. If you
  don't speak the language, machine-translate and mark with `// TODO`.
  Better an imperfect translation than a missing one.
- Variable interpolation uses `{name}` syntax: `t('toast.x', { n: 3 })`.

### Adapter-driven AI host configuration

When adding support for a new AI host, just append an entry to
`shared/ai-adapters.js`:

```js
{
  host: 'newai.com',
  label: 'NewAI',
  webUrl: 'https://newai.com/chat',     // open-in-new-tab target
  editor:    [...],  // CSS selectors for the input editor
  submitBtn: [...],  // CSS selectors for the send button
  stopBtn:   [...],  // CSS selectors for the stop/abort button
  generatingEl: [...], // element present only while AI is thinking
  inputHide: [...],  // selectors for "hide native textarea" feature
}
```

Then add the host to:
- `manifest.json` content_scripts entry for `ai-watcher.js`
- `manifest.json` content_scripts entry for the picker bundle (if
  capture/picking is desired on this host)
- `sidepanel/export.js` `openInXxx()` factory wrappers if you want a
  one-click open button

---

## PR conventions

- Branch off `main`, prefix with `feature/`, `fix/`, or `refactor/`.
- One concern per PR. Audit fixes for unrelated issues go in separate PRs.
- Update `CHANGELOG.md` under `## [Unreleased]` for any user-visible
  change.
- Bump the version in `manifest.json` + `shared/constants.js` +
  `vscode-extension/package.json` (when releasing — not in feature PRs).
- PR title format: `<type>: <imperative summary>` (e.g.
  `feat: keyboard merge for segments`, `fix: ai-watcher memory leak`).
- A short PR description with motivation > implementation > test plan
  beats a long bullet list of what changed.

### Test plan format

```
## Test plan

- [ ] Load the extension fresh
- [ ] Open a tracked tab, start a session
- [ ] Trigger feature X via {hotkey | menu | button}
- [ ] Verify Y happens, Z is persisted across reload
```

---

## Debugging

Open the side panel, then:

```js
// In the side panel devtools console:
localStorage.My-Feedbacks_LOG_LEVEL = 'debug';
location.reload();

// Now My-Feedbacks.log.debug(...) calls in any module are visible.
```

For service-worker logs: `chrome://extensions/` → My-Feedbacks → "service
worker" link → opens devtools attached to the SW.

For content-script logs: open devtools on the target tab. Content
scripts share that tab's console.

To inspect the Tiptap editor that My-Feedbacks injects into on Claude.ai:

```js
// In Claude.ai's devtools console:
$0 = document.querySelector('div.ProseMirror[contenteditable="true"]');
```

---

## Reporting issues

Please include:
- Chrome version (`chrome://version`)
- Operating system
- The page URL where the bug appears (or "any page")
- Reproduction steps in numbered list
- Expected vs actual behaviour
- A side-panel screenshot if relevant
- Any errors visible in the side-panel devtools console **and** the
  service-worker devtools console

---

## Releasing

1. Update `## [Unreleased]` to `## [X.Y.Z] — YYYY-MM-DD` in
   `CHANGELOG.md`. Add a fresh empty `## [Unreleased]` above it.
2. Bump `version` in `manifest.json`, `shared/constants.js`
   (`My-Feedbacks.VERSION`), and `vscode-extension/package.json`.
3. Tag the commit: `git tag vX.Y.Z && git push --tags`.
4. (Future) Build a `.crx` from `chrome://extensions/` "Pack
   extension".

---

Thanks again for contributing 🙏
