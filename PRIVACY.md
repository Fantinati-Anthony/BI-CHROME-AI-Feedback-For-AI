# My-Feedbacks — Privacy & Permissions

My-Feedbacks is **fully local-first**: nothing leaves your browser unless you explicitly export, copy, or inject a prompt. This document explains every permission we request and what data is stored on your machine.

## Quick claims

| Claim | Status |
|---|---|
| Sends your prompts to a third-party server unprompted | ❌ Never |
| Collects analytics / telemetry | ❌ Never |
| Reads cookies, localStorage of visited sites | ❌ Never |
| Injects ads / modifies foreign DOM beyond picker/capture overlays | ❌ Never |
| Phones home for updates / config | ❌ Never |
| Uses `chrome.storage.local` for your history | ✅ Yes (your machine only) |
| Uses `chrome.storage.sync` to sync your **profile (UUID, role, name, consent), settings + templates** across your own Chromes | ✅ Optional, opt-in |
| Uses `IndexedDB` for the event log (since v1.0) and binary blobs (screenshots) | ✅ Yes (your machine only) |
| Re-encodes screenshots to JPEG before storage | ✅ Yes (saves quota) |
| Auto-redacts PII / secrets (emails, IBAN, JWT, Bearer/sk-, Luhn-valid cards) | ✅ Yes, default ON |
| Generates a persistent device UUID on first run | ✅ Yes (regeneratable on demand) |
| Captures recent JS errors / network failures / breadcrumbs on the page | ✅ Yes — but **only** included in a feedback if YOU click "Send" with the matching consent toggle ON |
| Calls api.anthropic.com (Claude) for "Summarize" / "Suggest triage" | ⚠ Only if YOU paste your own API key in Settings → AI and click the button. Your key is stored locally only. |

## What's stored on your machine

| Data | Where | Lifecycle |
|---|---|---|
| Your demandes (text + refs) | `chrome.storage.local` (`myfb:v1:state`) | Until you delete |
| Event log (every state mutation) | `IndexedDB` (`my-feedbacks` db, `events` store) | Until you delete |
| Blobs (screenshots) | `IndexedDB` (`my-feedbacks` db, `blobs` store) | GC'd when no demande references them |
| Profile (UUID, role, displayName, email, consent toggles) | `chrome.storage.sync` (`myfb:profile:v1`) | Until you reset profile or uninstall |
| Lamport clock counter | `IndexedDB` meta store | Until you clear data |
| Anthropic API key (if you configured one) | `chrome.storage.local` (`myfb:ai:anthropic-key`) | Until you clear |
| Overlay-toggle visibility preference | `chrome.storage.local` (`myfb:overlays:visible`) | Until you toggle off |

## Network calls

My-Feedbacks makes a network call ONLY when you trigger an explicit action :

| Action | Destination | What's sent |
|---|---|---|
| "Send to Claude.ai" button | https://claude.ai/new?q=… | The formatted prompt only |
| "Send to ChatGPT" / "Perplexity" / etc. | Their public URL | The formatted prompt only |
| "Summarize" / "Suggest triage" (Settings → AI configured) | https://api.anthropic.com/v1/messages | Your prompt + the API key YOU provided. No UUID / no device meta unless those are inside the prompt text you authored. |
| "Send to VS Code" | http://127.0.0.1:51473 (local bridge) | The formatted prompt + screenshots, to your own machine only |
| "Send via tier 2 shared folder" (v1.5+) | The folder YOU picked (Drive / Dropbox / OneDrive) | The event log JSONL line |
| **"🔄 Rafraîchir" / "🔌 Tester" / autoInject (v2.4)** | The bridge URL YOU configured (`myfb-bridge.php` on YOUR server) | A signed HMAC POST. The body contains an op name, optional args (table name, limit), a timestamp + nonce — **never your prompt, never API keys, never PII**. Response is DB schema + sample rows that YOU exposed via the bridge's `expose` patterns. Data flow stays between YOUR browser and YOUR server — my-feedbacks.com is not involved. |

That's the full list. No background pings, no version checks, no analytics, no error reporting to us.

### v2.4 DB bridge — what stays where

When you configure a "DB profile" in Settings → Bases de données :

- The **HMAC secret** is encrypted with AES-GCM-256 using a
  non-extractable WebCrypto key kept in your browser's IndexedDB.
  It never leaves your machine in plaintext, including in
  `chrome.storage` backups.
- The **bridge URL** is stored as-is in `chrome.storage.local`. If
  you sync your Chrome profile across devices, the URL syncs with
  it (the secret does not, because the AES-GCM key is per-profile-
  per-machine).
- The **schema markdown** returned by the bridge is cached in
  `chrome.storage.local` alongside the other profile fields. It
  becomes part of the AI prompt you assemble — same privacy
  posture as anything else you type in a feedback.
- The **bridge** runs on YOUR server. We never receive any DB rows.
  Its audit log (`myfb-bridge.audit.log`) records timestamp +
  op-name + IP — no SQL, no payload.

## Build variants (`dist/`)

`npm run build` produces two manifests in `dist/`:

| File | When to use | What changes |
|---|---|---|
| `manifest.dev.json` | Development / local install via `chrome://extensions` "Load unpacked" | Identical to source `manifest.json` — keeps `connect-src http://127.0.0.1:51473 http://localhost:51473` so the VS Code bridge ("VS-Code Terminal", "VS-Code Copilot Chat") works. |
| `manifest.webstore.json` | Public Web Store publication | Removes the loopback `connect-src` from the CSP. The bridge buttons still appear but show a friendly "Bridge VS Code introuvable" toast since the fetch is blocked by CSP — no functional regression for users who don't run the bridge anyway. |

The reviewer-friendly variant has zero arbitrary-URL fetches (`connect-src 'self'`).

## Permissions explained

| Permission | Why we need it | What it does NOT do |
|---|---|---|
| `host_permissions: ["<all_urls>"]` | The element-picker, screenshot capture, and prompt injection must work on **any website you choose to use them on**. That's the core value of the product. | We don't run code on pages you haven't asked us to act on. The `activeTab` policy + your click is the actual gate. |
| `activeTab` | Allows `chrome.tabs.captureVisibleTab()` after **your click** on Capture. | Doesn't grant background access to tabs. |
| `storage` | `chrome.storage.local` for history (10 MB on your machine), `chrome.storage.sync` for settings + templates (100 KB across **your** Chrome account). | We don't read other extensions' storage. |
| `clipboardWrite` | The "Copy" / "Inject" actions write your prompt to the clipboard. | We never read the clipboard. |
| `sidePanel` | Renders the My-Feedbacks UI in Chrome's side panel. | — |
| `contextMenus` | Right-click → "Add to My-Feedbacks" on selected text or images. | — |
| `commands` | Keyboard shortcuts (Alt+Shift+F/E/M/C). | — |

## What is stored

```
chrome.storage.local      ← demandes (history) with screenshot dataUrls (compressed JPEG)
chrome.storage.sync       ← settings, templates (no images, no history)
```

Both are scoped to your machine / your Chrome account. No external server. No external SDK in the bundle (no Sentry, no GA, no Mixpanel).

## Auto-redaction (Privacy mode)

Settings → Confidentialité → "Masquage automatique" (default **ON**).

Before any text lands in storage, My-Feedbacks runs a regex pass that replaces:

- emails → `[email]`
- credit card numbers (Luhn-validated) → `[card]`
- IBANs → `[iban]`
- JWT tokens → `[jwt]`
- Bearer / sk- / pk- / ghp_ / xox*- / hf_ / nvapi- API keys (≥16 chars) → `[token]`

This is **opt-out**, not opt-in. A senior dev should be able to install the extension on a work laptop without leaking a Stripe API key into a screenshot. The setting also affects export bundles.

## Export / Import

- The "Export JSON" feature in Réglages produces a file scoped to your machine. Image dataUrls can be optionally stripped (`Exclure les captures d'écran`) for a 99% smaller share-friendly file.
- "Import" requires a bundle with the magic header `{ _myfb: "export", _version, data: ... }`. The schema is validated (types, lengths, URL/dataUrl shape regex) before anything is written to your state. Unknown fields are silently dropped.

## Sender authentication

The service worker (`background/messages.js`) only accepts `chrome.runtime.onMessage` payloads where `sender.id === chrome.runtime.id`. This blocks any rogue extension installed alongside My-Feedbacks from talking to our background.

## Third-party services

The only outbound traffic from the extension is:

1. The **VS Code bridge** (`http://127.0.0.1:*`, `http://localhost:*`) when you click "VS-Code Terminal" or "VS-Code GH for Copilot" — and only if a local bridge is running on your loopback. CSP enforces the loopback restriction.
2. The "Open in" buttons (Claude.ai, ChatGPT, Gemini, …) — these open **a new tab** to the official AI website. We don't proxy the request.

## Reporting an issue

If you find a privacy-affecting bug, please open a GitHub issue or email the maintainer. Do not include sensitive content in the issue.
