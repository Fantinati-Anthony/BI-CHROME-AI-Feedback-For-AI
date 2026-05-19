# My-Feedbacks tests

Vitest + jsdom suite. The addon ships as IIFE scripts that attach to
`window.MyFb*`; tests load each module via `loadAddonScript()` (defined
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

| File | Coverage |
|---|---|
| `imaging.test.js`        | `MyFbImaging.bytes` + `compressDataUrl` fallback paths |
| `templates.test.js`      | CRUD on `STATE.templates` |
| `ai-adapters.test.js`    | registries shape + invariants |
| `storage-export.test.js` | export/import bundle roundtrip + stripDataUrls |
| `token-counter.test.js`  | BPE heuristic + colour-threshold transitions |
| `i18n.test.js`           | t/tn placeholder substitution + plural fallback |
| `scrub.test.js`          | PII scrubbing across all detectors |
| `blob-store.test.js`     | IndexedDB put/get/remove/gc cycle |
| `session.test.js`        | finalizeDemande flow, edit mode, disarm |
| `core/lamport.test.js`   | hybrid logical clock monotonicity |
| `core/store.test.js`     | event store append + idempotency |
| `core/reducer.test.js`   | pure state derivation from event log |
| `core/transport-solo.test.js` | no-op transport contract |
| `db-bridge-client.test.js`    | HMAC-SHA256 signing matches PHP byte-for-byte |
| `db-secret-crypto.test.js`    | AES-GCM encrypt/decrypt + tampering rejection |
| `db-profiles-auto-inject.test.js` | session-start auto-injection logic |

## Adding a test

1. Create `tests/<feature>.test.js`.
2. `beforeAll(() => { loadAddonScript('sidepanel/foo.js'); })`.
3. Assert against `window.MyFbFoo.*`.

Stubs for `chrome.runtime`, `chrome.storage`, `chrome.tabs`, `chrome.i18n`
are pre-installed by `tests/setup.js`. Override individual methods in
the test file if you need custom behaviour.

## Crypto in tests

`crypto.subtle` is provided by Node ≥ 20 via `globalThis.crypto.webcrypto`.
The DB modules check for `globalThis.crypto.subtle` and inject the polyfill
if absent — see `tests/db-secret-crypto.test.js` for the pattern.
