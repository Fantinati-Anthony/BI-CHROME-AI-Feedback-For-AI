# BIAIF tests

Vitest + jsdom suite. The addon ships as IIFE scripts that attach to
`window.BIAIF*`; tests load each module via `loadAddonScript()` (defined
in `tests/setup.js`) into the jsdom window, then assert against the
public API.

## Run

```bash
npm install            # one-time
npm test               # single run
npm run test:watch     # watch mode
npm run test:coverage  # v8 coverage report (HTML in coverage/)
```

## Suites

- `imaging.test.js`        — `BIAIFImaging.bytes` + `compressDataUrl` fallback paths
- `templates.test.js`      — CRUD on `STATE.templates`
- `ai-adapters.test.js`    — registries shape + invariants
- `storage-export.test.js` — export/import bundle roundtrip + stripDataUrls

## Adding a test

1. Create `tests/<feature>.test.js`.
2. `beforeAll(() => { loadAddonScript('sidepanel/foo.js'); })`.
3. Assert against `window.BIAIFFoo.*`.

Stubs for `chrome.runtime`, `chrome.storage`, `chrome.tabs`, `chrome.i18n`
are pre-installed by `tests/setup.js`. Override individual methods in
the test file if you need custom behaviour.
