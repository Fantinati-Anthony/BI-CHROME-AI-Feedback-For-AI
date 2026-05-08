/**
 * BIAIF Service Worker — editor injection retry loop
 *
 * Sends `msg` to the target tab repeatedly until one of three things
 * happens:
 *   1. The content script answers `{ ok: true, ... }` → return that.
 *   2. The content script answers `{ error: 'editor not found' }` →
 *      keep retrying (the editor DOM is rendering on a SPA route).
 *   3. We hit `maxMs` → return a structured timeout error.
 *
 * Also tolerates "Receiving end does not exist" type errors during the
 * first ~1s while the content script's document_idle scripts are still
 * being injected.
 */

/* eslint-disable no-undef */

async function injectWithRetry(tabId, msg, opts) {
  opts = opts || {};
  const intervalMs = opts.intervalMs || 400;
  const maxMs      = opts.maxMs      || 15000;
  const deadline   = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    let resp;
    try {
      resp = await chrome.tabs.sendMessage(tabId, msg);
    } catch (e) {
      const err = e?.message || String(e);
      if (err.includes('Could not establish connection') ||
          err.includes('Receiving end does not exist') ||
          err.includes('No tab with id')) {
        continue; // content script not loaded yet — keep waiting
      }
      return { error: err };
    }
    if (resp && resp.ok) return resp;
    if (resp && resp.error === 'editor not found') continue;
    return resp || {};
  }
  return {
    error:   'editor not found after ' + Math.round(maxMs / 1000) + 's — open Claude.ai in the target tab and try again',
    code:    'editor_timeout',
    seconds: Math.round(maxMs / 1000),
  };
}
