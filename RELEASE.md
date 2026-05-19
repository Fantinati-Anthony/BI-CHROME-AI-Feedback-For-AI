# Release process — My-Feedbacks

How to ship a new version to the Chrome Web Store.

## Pre-flight checklist (before any tag)

- [ ] All CI green on `main`
- [ ] `npm run lint` → 0 errors
- [ ] `npx tsc -p jsconfig.json --noEmit` → 0 errors
- [ ] `npm run i18n:check` → green
- [ ] `npm test` → all pass
- [ ] `npm run build` → produces `dist/sidepanel.bundle.js`,
      `dist/background.bundle.js`, `dist/manifest.dev.json`,
      `dist/manifest.webstore.json`
- [ ] Manifest `version` bumped (semver) — see `manifest.json`
- [ ] `package.json` `version` bumped to match
- [ ] `CHANGELOG.md` entry written for the new version
- [ ] Smoke tested locally (load unpacked in `chrome://extensions`)

## 1. Build the Web Store ZIP

```bash
npm run build
cd dist
# Replace the dev manifest with the public one
cp manifest.webstore.json manifest.json
rm manifest.webstore.json manifest.dev.json
# Also copy the non-bundled assets the extension needs at runtime
cd ..
# (Or use a packaging script — TODO: scripts/package.mjs)
```

> Reviewer-friendly note: `manifest.webstore.json` removes the
> `http://127.0.0.1:51473..51482` and `http://localhost:51473..51482`
> entries from `connect-src`. The VS Code bridge buttons still appear
> but fail gracefully with a "bridge not found" toast — no functional
> regression for users who aren't running the bridge.

## 2. Submit to Chrome Web Store

1. https://chrome.google.com/u/0/webstore/devconsole/
2. Pick the My-Feedbacks item.
3. **Package** tab → upload the new ZIP.
4. **Privacy practices** tab :
   - Single purpose: "Capture visual + voice feedback on web pages and
     send to AI tools (Claude, ChatGPT, Cursor, VS Code Copilot)."
   - Permissions justification — see table below.
   - Remote code: **None**. Anthropic API call is opt-in user-initiated.
   - Data usage compliance: tick "I do not collect / sell / transfer user
     data" (verified: PRIVACY.md is the source of truth).
5. **Distribution** → optionally bump version notes.
6. Submit for review.

### Permissions justification (paste into reviewer notes)

| Permission | Why |
|---|---|
| `activeTab` | Needed for the element picker + screenshot capture to act on the current page when the user clicks them. |
| `storage` | Local feedback history + user settings via `chrome.storage.local` / `chrome.storage.sync`. No data leaves the device. |
| `clipboardWrite` | Implements the "Copy prompt" shortcut (Alt+Shift+C) and clipboard-fallback for export targets that don't support deep-links (Gemini, Aider). |
| `sidePanel` | Whole product is a side panel UI (Manifest V3 SidePanel API). |
| `contextMenus` | Right-click "Add to feedback" entries (text selection, image, link) for quick capture. |
| `<all_urls>` host permission | The picker / screenshot / breadcrumbs need to run on any site the user wants to give feedback about. |

## 3. After approval

- [ ] Create a GitHub release with the same version tag (`v1.0.0`).
- [ ] Attach the ZIP and `dist/manifest.webstore.json`.
- [ ] Paste the CHANGELOG entry into the release notes.

## 4. Hotfix flow

If a critical bug ships :

1. Branch from the released tag.
2. Bump patch version (`1.0.0` → `1.0.1`).
3. Cherry-pick or write the fix.
4. Run the full pre-flight.
5. Submit a new build. Chrome Web Store typically processes patches in
   < 24 hours when reviewer-relevant fields didn't change.

## Known reviewer gotchas

- Don't ship `package-lock.json` in the ZIP (already excluded — only
  source files needed at runtime go in `dist/`).
- Don't ship the test files / `tests/` / `node_modules/`.
- Manifest `version` MUST go up monotonically. Once you submit `1.0.0`,
  the next submission must be `1.0.1` or higher.
