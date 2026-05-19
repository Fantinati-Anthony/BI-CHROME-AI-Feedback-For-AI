# Migration guide

Upgrade paths between major My-Feedbacks versions. **For the full
release notes**, see [`CHANGELOG.md`](CHANGELOG.md). This document
focuses on **breaking changes** and **manual steps** the user has to
do — anything else just upgrades silently.

## 2.0.x → 2.4.x

### Storage shape (no migration required)

The new `STATE.dbProfiles` array is added to the persisted state shape.
Old installs (`STATE.dbProfiles` absent) hydrate to `[]` automatically
on first load — no data loss, no user action needed.

```diff
 {
   "demandes": [...],
   "currentDemande": {...},
   "templates": [...],
+  "dbProfiles": [],   // new in 2.4, defaults to []
   "lang": "fr-FR",
   ...
 }
```

### Permissions (no change)

`manifest.json` permissions are **unchanged**. The DB bridge calls
arbitrary HTTPS hosts from the **service worker**, not from the
side panel — so the existing `host_permissions: ["<all_urls>"]`
covers it. No re-prompt for users.

### CSP for the side panel (no change)

`connect-src` on the sidepanel still forbids arbitrary URLs.
Network calls to the bridge are routed through the SW (which has no
such restriction). Users who run a custom CSP override don't need
to adapt.

### New optional feature : DB context

If you want to use the new DB profiles feature, follow
[`bridge/INSTALL.md`](bridge/INSTALL.md) for a 3-minute setup.
**Skipping is fine** — the Settings → Bases de données section is
empty by default and has zero impact on existing flows.

### Internal renames (devs only)

If you've been hacking on the codebase since v1.x :

- `window.BIAIF*` → `window.MyFb*` (completed in v1.0.0 — should not
  surface anymore)
- DB modules use the `MyFb*` namespace : `MyFbDbBridge`,
  `MyFbDbProfilesUi`, `MyFbDbSecretCrypto`
- New MSG type : `MSG.DB_BRIDGE_CALL = 'myfb:db-bridge-call'`

## 1.x → 2.0

See the v2.0.0 section of [`CHANGELOG.md`](CHANGELOG.md). Key
breaking change : `STORAGE_KEY` bumped to `myfb:v1:state` (was
`biaif:vXX:state`). The hydrate code reads both via
`STORAGE_LEGACY_KEYS` and migrates silently on first load.

## How to test the upgrade is clean

1. Backup your current state : *Settings → Données → Exporter en JSON*
2. Install the new version (reload unpacked or update from store)
3. Open the side panel. The history should look identical.
4. Check console : no `[MyFb Storage] hydrate failed` warning.
5. If your old install had `STATE.dbProfiles` set (probably not),
   confirm Settings → Bases de données lists the same profiles.

## Rollback

`chrome://extensions/` → My-Feedbacks → Details → Allow access to file
URLs OFF, then re-install the previous version's `.crx` / unpacked
folder. Your `chrome.storage.local` survives — the v2.4 additions
(`STATE.dbProfiles`) will just be ignored by the older code.

If something corrupts the storage during migration, the export from
step 1 above can be re-imported via *Settings → Données → Importer JSON*.
