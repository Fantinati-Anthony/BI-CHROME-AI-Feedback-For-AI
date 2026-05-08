# BIAIF — Privacy & Permissions

BIAIF is **fully local-first**: nothing leaves your browser unless you explicitly export, copy, or inject a prompt. This document explains every permission we request and what data is stored on your machine.

## Quick claims

| Claim | Status |
|---|---|
| Sends your prompts to a third-party server | ❌ Never |
| Collects analytics / telemetry | ❌ Never |
| Reads cookies, localStorage of visited sites | ❌ Never |
| Injects ads / modifies foreign DOM beyond picker/capture overlays | ❌ Never |
| Phones home for updates / config | ❌ Never |
| Uses `chrome.storage.local` for your history | ✅ Yes (your machine only) |
| Uses `chrome.storage.sync` to sync your **settings + templates** across your own devices | ✅ Optional, opt-in |
| Re-encodes screenshots to JPEG before storage | ✅ Yes (saves quota) |
| Auto-redacts PII / secrets (emails, IBAN, JWT, Bearer/sk-, Luhn-valid cards) | ✅ Yes, default ON |

## Permissions explained

| Permission | Why we need it | What it does NOT do |
|---|---|---|
| `host_permissions: ["<all_urls>"]` | The element-picker, screenshot capture, and prompt injection must work on **any website you choose to use them on**. That's the core value of the product. | We don't run code on pages you haven't asked us to act on. The `activeTab` policy + your click is the actual gate. |
| `activeTab` | Allows `chrome.tabs.captureVisibleTab()` after **your click** on Capture. | Doesn't grant background access to tabs. |
| `storage` | `chrome.storage.local` for history (10 MB on your machine), `chrome.storage.sync` for settings + templates (100 KB across **your** Chrome account). | We don't read other extensions' storage. |
| `clipboardWrite` | The "Copy" / "Inject" actions write your prompt to the clipboard. | We never read the clipboard. |
| `sidePanel` | Renders the BIAIF UI in Chrome's side panel. | — |
| `contextMenus` | Right-click → "Add to BIAIF" on selected text or images. | — |
| `commands` | Keyboard shortcuts (Alt+Shift+F/E/M/C). | — |

## What is stored

```
chrome.storage.local      ← demandes (history) with screenshot dataUrls (compressed JPEG)
chrome.storage.sync       ← settings, templates (no images, no history)
```

Both are scoped to your machine / your Chrome account. No external server. No external SDK in the bundle (no Sentry, no GA, no Mixpanel).

## Auto-redaction (Privacy mode)

Settings → Confidentialité → "Masquage automatique" (default **ON**).

Before any text lands in storage, BIAIF runs a regex pass that replaces:

- emails → `[email]`
- credit card numbers (Luhn-validated) → `[card]`
- IBANs → `[iban]`
- JWT tokens → `[jwt]`
- Bearer / sk- / pk- / ghp_ / xox*- / hf_ / nvapi- API keys (≥16 chars) → `[token]`

This is **opt-out**, not opt-in. A senior dev should be able to install the extension on a work laptop without leaking a Stripe API key into a screenshot. The setting also affects export bundles.

## Export / Import

- The "Export JSON" feature in Réglages produces a file scoped to your machine. Image dataUrls can be optionally stripped (`Exclure les captures d'écran`) for a 99% smaller share-friendly file.
- "Import" requires a bundle with the magic header `{ _biaif: "export", _version, data: ... }`. The schema is validated (types, lengths, URL/dataUrl shape regex) before anything is written to your state. Unknown fields are silently dropped.

## Sender authentication

The service worker (`background/messages.js`) only accepts `chrome.runtime.onMessage` payloads where `sender.id === chrome.runtime.id`. This blocks any rogue extension installed alongside BIAIF from talking to our background.

## Third-party services

The only outbound traffic from the extension is:

1. The **VS Code bridge** (`http://127.0.0.1:*`, `http://localhost:*`) when you click "VS-Code Terminal" or "VS-Code GH for Copilot" — and only if a local bridge is running on your loopback. CSP enforces the loopback restriction.
2. The "Open in" buttons (Claude.ai, ChatGPT, Gemini, …) — these open **a new tab** to the official AI website. We don't proxy the request.

## Reporting an issue

If you find a privacy-affecting bug, please open a GitHub issue or email the maintainer. Do not include sensitive content in the issue.
