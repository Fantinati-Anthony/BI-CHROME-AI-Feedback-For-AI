# BI Chrome AI Feedback For AI

> Capture visual + voice + console feedback on **any** web page, then ship it
> to **Claude Code** (or any other LLM) as a structured Markdown prompt — in
> one click, with screenshots and CSS selectors automatically attached.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/manifest-v3-green.svg)](manifest.json)
![Languages](https://img.shields.io/badge/i18n-7%20langs-orange.svg)

Chrome extension (Manifest V3) that lets you point at things in a web page,
talk about them, capture screenshots, and turn the result into an LLM-ready
prompt with all the selectors, classes, screenshots, and console errors
inlined automatically. Built for **vibe-fixing** UI bugs from Chrome → Claude
Code without the copy-paste tedium.

---

## Quickstart

```bash
git clone https://github.com/Fantinati-Anthony/BI-CHROME-AI-Feedback-For-AI.git
cd BI-CHROME-AI-Feedback-For-AI
```

1. Open `chrome://extensions/` (or `edge://extensions/`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the repo root (containing `manifest.json`).
4. Pin the extension and press **Alt+Shift+F** to open the side panel.

> Reload the extension after every code change (`chrome://extensions/` →
> circular-arrow icon).

---

## Features

### Capture
- **Element picker** with live overlay — hover to highlight, click to capture
  a unique CSS selector (id / data-testid / classes / nth-of-type fallback)
- **Screenshots** in three modes: visible viewport, full page (auto-stitched
  via scroll), single element (cropped around the bounding box)
- **Annotation editor** in a Shadow-DOM overlay (rectangles, arrows, blur,
  text) — re-annotate any captured screenshot from the side panel
- **Console errors** automatically captured (MAIN-world script bridges
  `error` events back into the side panel as references)
- **GitHub repo auto-detection** when capturing on `github.com/owner/repo`
  pages — stamped onto every demande for filtering later

### Compose
- **Speech-to-text** via Web Speech API (continuous + interim) — dictate
  while pointing, transcribed text inserts directly into the active editor
- **Demande chips**: every captured element / screenshot / console error
  becomes a draggable chip inline in the prose, expandable to inspect
- **Multi-segment session**: chain multiple demandes in one capture session,
  each finalised independently
- **Conversation grouping**: segments sharing a `conversationUrl` collapse
  into a single conversation card. Done segments turn into archived
  sub-segments to prevent accidental edits.
- **Generic archive zone** for done segments without a conversationUrl,
  collapsible with relative timestamp ("MAJ il y a Xs")

### Ship
- **Direct injection into Claude.ai** — text via `beforeinput` /
  `execCommand`, images via simulated DataTransfer drop (clipboard paste
  fallback), then optional auto-submit
- **VS Code Terminal / Copilot Chat** via local HTTP bridge (companion
  extension, see below)
- **One-click open** in Claude / ChatGPT / Gemini / Grok / Perplexity /
  Le Chat / DeepSeek (copies the prompt and opens the AI in a new tab)
- **Markdown export**: copy to clipboard or download `.md` + screenshots

### Quality of life
- **Auto-open side panel** when switching to a known AI tab or to a tab
  matching a tracked segment URL
- **Hide Claude.ai textarea** option — replaces the native input with the
  BIAIF buttons only (requires auto-submit)
- **Onboarding wizard** on first run, configurable from settings
- **History search** with debounced filtering (150 ms)
- **7 languages**: French, English, Spanish, German, Italian, Portuguese,
  Dutch — auto-detected from `navigator.language`
- **Undo stack** (50 snapshots) and Ctrl+Z support in the side panel

---

## Keyboard shortcuts

| Action                              | Default               |
| ----------------------------------- | --------------------- |
| Open / close side panel             | `Alt+Shift+F`         |
| Toggle element picker               | `Alt+Shift+E`         |
| Toggle microphone                   | `Alt+Shift+M`         |
| Copy formatted prompt               | `Alt+Shift+C`         |
| **Command palette**                 | **`Cmd/Ctrl+K`**      |
| Merge with previous / next segment  | `Alt+↑` / `Alt+↓`     |
| Exit picker mode                    | `Esc` (in page)       |
| Multi-pick (capture without exit)   | `Ctrl/Cmd + click`    |

The command palette is the fastest way to use BIAIF without a mouse:
templates (with `{{var}}` interpolation), AI targets, theme switch,
save / copy / search — all behind a fuzzy filter.
| Merge demande with neighbour        | `Alt+↑` / `Alt+↓` on the drag handle |

Shortcuts can be remapped in `chrome://extensions/shortcuts`.

> ⚠️ **`Alt+Shift+F` is also VS Code's "Format Document".** If Chrome doesn't
> grab the global shortcut, click the toolbar icon (`chrome.action.onClicked`
> opens the side panel) or use the in-page keyboard listener (the content
> script listens for the same combos as long as the page has focus).

---

## VS Code bridge (optional)

The companion extension `vscode-extension/` runs a local HTTP server on
`127.0.0.1:51473` and lets BIAIF inject prompts directly into the VS Code
terminal or GitHub Copilot Chat.

```bash
cd vscode-extension
npm install -g vsce  # one-time
vsce package
code --install-extension biaif-vscode-bridge-*.vsix
```

The bridge:
- Listens **only on 127.0.0.1** (loopback, never reachable from LAN)
- Restricts CORS to **`chrome-extension://*` origins**
- Caps payload at **20 MB** total / **10 images per request**
- Validates the `target` enum and image data-URL format
- Saves images to `os.tmpdir()/biaif-inject/` (configurable via
  `biaif.tempDir`)

Linux users: install `xdotool` for the auto-paste fallback into Copilot
Chat (`sudo apt install xdotool`). macOS uses AppleScript, Windows uses
PowerShell — both built-in.

Configurable in VS Code settings:
- `biaif.bridgePort` — default `51473`
- `biaif.autoStart` — default `true`
- `biaif.tempDir` — default empty (uses system temp)

---

## Settings reference

All settings live in `chrome.storage.local` and survive between sessions.

| Setting                  | Default | Description |
| ------------------------ | ------- | ----------- |
| `uiLang`                 | auto    | UI language (auto-detected from browser, override in settings) |
| `lang`                   | `fr-FR` | Speech recognition language |
| `micDeviceId`            | system  | Microphone device |
| `sortOrder`              | `asc`   | Segment sort order |
| `segFontSize`            | `13`    | Segment text size (8–16) |
| `visibleButtons`         | varies  | Per-action button visibility on cards |
| `autoOpenOnKnownActive`  | `false` | Open panel when switching to a tab linked to an active segment |
| `autoOpenOnKnownDone`    | `false` | Same for done segments |
| `autoOpenOnAiPage`       | `false` | Open panel on any known AI host |
| `hideAiTextarea`         | `false` | Hide Claude.ai's native input (requires `autoSubmitAfterInject`) |
| `autoSubmitAfterInject`  | `false` | Click the send button after injection |
| `archiveExpanded`        | `false` | Persist the archive-zone open/closed state |

---

## Output format

```markdown
# Demandes utilisateur

> Chaque demande est une instruction unique exprimée en langage naturel,
> avec des références numérotées `[#N]` insérées inline.

## Demande #1

**Page :** https://example.com/dashboard

**Instruction :**

> Le bouton [#1 button.cta] est mal aligné par rapport au texte [#2 div.subtitle].
> J'ai capturé l'écran [#3 capture viewport].

**Références :**

- **#1 — élément**
  - sélecteur : `body > main > section.hero > button.cta`
  - tag : `<button>`
  - classes : `cta primary lg`
  - texte : « Try for free »

- **#2 — élément**
  - sélecteur : `body > main > section.hero > div.subtitle`

- **#3 — capture (viewport)**
  📷 See `dem1-ref3.png`
```

---

## Architecture

```
manifest.json                  Manifest V3 + content scripts + commands + CSP
background.js                  Service worker (capture queue, msg routing,
                               sidepanel auto-open, VS Code bridge dispatch)

shared/                        Loaded everywhere (SW, sidepanel, content)
  constants.js                 MSG types, storage keys, version, bridge port
  utils.js                     extractGithubRepo, decodeErr, t, msgKey,
                               findAiAdapter — single source of truth
  ai-adapters.js               Per-host config: editor, submitBtn, stopBtn,
                               generatingEl, inputHide, label, webUrl
  i18n.js                      7-language translation table + missing-key
                               diagnostics
  intent-parser.js             "Insert tag", "Open settings", etc.
  logger.js                    Levelled logger (debug/info/warn/error)

content/                       Injected into every (or matched) tab
  page-error-monitor.js        MAIN-world: catches window.onerror and
                               unhandledrejection, dispatches CustomEvent
  error-bridge.js              Isolated world: relays the CustomEvent to SW
  css-selector.js              Unique-CSS-selector generator
  element-selector.js          Picker overlay (hover highlight, click capture)
  screenshot.js                Viewport / full-page / element capture +
                               loader + scroll-stitch
  screenshot-editor.js         Annotation overlay (Shadow DOM)
  inject.js                    Inject text + images into Claude.ai's Tiptap
  textarea-injector.js         Floating BIAIF buttons next to every textarea
  ai-watcher.js                Detects AI generating/done state on AI hosts
  main.js                      Orchestrator + hotkey listener fallback

sidepanel.html                 Side panel UI
sidepanel.css                  Side panel styles (1500+ lines, dark theme)
sidepanel.js                   Side panel orchestrator (event binding,
                               settings sync, hotkeys, message dispatch)
sidepanel/
  storage.js                   Hydrate / persist (versioned, quota fallback)
  session.js                   Session lifecycle, edit mode, finalize, merge
  speech.js                    Web Speech API (continuous + interim ghost)
  renderer.js                  All DOM rendering (segments, chips, editor)
  export.js                    Prompt builder, copy, download, inject
  toast.js                     Notification queue (max 4)
  undo.js                      Undo stack (max 50)
  wizard.js                    Onboarding modal

vscode-extension/              Companion VS Code extension (TS-free, Node)
  extension.js                 HTTP server, image temp files, target dispatch
  package.json                 VS Code config schema
```

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for data flows and module
interactions.

---

## Privacy & security

- **No telemetry** — nothing leaves the browser except (1) the prompts /
  screenshots **you** explicitly send to your chosen LLM, and (2) the
  Web Speech API audio sent to Google's servers when the mic is active.
- **No remote code** — all scripts ship in the extension; no `eval`, no
  CDN-loaded scripts. The `content_security_policy` in `manifest.json`
  default-denies anything not from `'self'` (Google Fonts is the only
  whitelisted CDN, for the UI font).
- **VS Code bridge** binds **only to `127.0.0.1`** and (since 0.5.0)
  enforces an origin allowlist + payload caps to prevent abuse from
  malicious local pages.
- **Storage** is `chrome.storage.local` only; the extension does not
  use cookies, IndexedDB, or external persistence. A versioned migration
  framework (`STATE.version`) handles upgrades.

---

## Browser support

- **Chrome / Edge / Brave** — fully supported (Chromium 114+ for the
  `chrome.sidePanel` API)
- **Firefox** — not supported (different MV3 + side panel APIs)
- **Web Speech API** — Chromium-only, requires network connectivity
  (transcription routed via Google's servers)
- **`chrome://`, Web Store, and other privileged URLs** — Chrome blocks
  content-script injection on these, so capture/picker won't work
  there

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for dev setup, lint configuration,
file layout, and PR conventions.

```bash
# Lint (ESLint + Prettier configured at repo root)
npx eslint .
npx prettier --check .

# Reload after every change
# chrome://extensions/ → BIAIF → 🗘 reload
```

---

## License

[MIT](LICENSE) © Anthony Fantinati — use, modify, fork freely.
