/**
 * Vitest setup — provide minimal Chrome extension globals for jsdom.
 * The IIFE-style modules attach to `window`, so we just load them via
 * import-once-per-suite (Node-style require since they are non-module
 * scripts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// IndexedDB shim — jsdom doesn't ship one. Loaded eagerly so any
// module that does `indexedDB.open(...)` at import time resolves.
import 'fake-indexeddb/auto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

// Stubs for the chrome.* API used by the addon.
globalThis.chrome = {
  runtime: {
    id: 'test-extension-id',
    sendMessage: () => Promise.resolve(null),
    onMessage:   { addListener: () => {} },
    getManifest: () => ({ version: '1.0.0' }),
    getURL: (p) => 'chrome-extension://test/' + p,
  },
  storage: {
    local: {
      get: () => Promise.resolve({}),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      getBytesInUse: () => Promise.resolve(0),
    },
    QUOTA_BYTES: 10 * 1024 * 1024,
  },
  tabs:        { query: () => Promise.resolve([]), sendMessage: () => Promise.resolve() },
  i18n:        { getMessage: (k) => k },
  permissions: { contains: () => Promise.resolve(true) },
};

// Helper: load a non-module script into the current jsdom window.
globalThis.loadAddonScript = function loadAddonScript(relPath) {
  const abs  = path.join(ROOT, relPath);
  const code = fs.readFileSync(abs, 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', 'self', 'globalThis', 'chrome', code)(
    window, window, globalThis, globalThis.chrome,
  );
};
