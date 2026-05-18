/**
 * MyFb Service Worker — capture queue
 *
 * Wraps chrome.tabs.captureVisibleTab with:
 *   - rate-limit honouring MIN_CAPTURE_INTERVAL_MS (Chrome's quota)
 *   - retry on MAX_CAPTURE errors with exponential-ish backoff
 *   - global serialisation (one-at-a-time) so concurrent callers from
 *     multiple windows / sidepanels don't race each other
 *
 * Exposes:
 *   captureWithRateLimit(windowId) → Promise<dataUrl>
 *   capturePromise — legacy lock kept for the old message-routing
 *                    path that chains directly on it.
 */

/* eslint-disable no-undef */

const CAPTURE_CFG = (self.MyFb && self.MyFb.config && self.MyFb.config.capture) || {};
const MIN_CAPTURE_INTERVAL_MS = CAPTURE_CFG.MIN_INTERVAL_MS    || 1500;
const MAX_CAPTURE_ATTEMPTS    = CAPTURE_CFG.MAX_RETRY          || 3;
const RETRY_BASE_DELAY_MS     = CAPTURE_CFG.RETRY_BASE_DELAY_MS || 2000;
const LAST_CAPTURE_KEY = 'myfb:lastCaptureAt';

let capturePromise = Promise.resolve();
let _captureChain  = Promise.resolve();

async function readLastCaptureAt() {
  try {
    const o = await chrome.storage.session.get(LAST_CAPTURE_KEY);
    return Number(o[LAST_CAPTURE_KEY]) || 0;
  } catch (_) { return 0; }
}
async function writeLastCaptureAt(ts) {
  try { await chrome.storage.session.set({ [LAST_CAPTURE_KEY]: ts }); } catch (_) {}
}

function captureWithRateLimit(windowId) {
  const next = _captureChain.then(
    () => _captureOnce(windowId),
    // Previous capture failed — don't propagate, just continue the chain.
    () => _captureOnce(windowId),
  );
  // Keep the chain advancing even if this caller's promise rejects.
  _captureChain = next.catch(() => {});
  return next;
}

async function _captureOnce(windowId) {
  const lastCaptureAt = await readLastCaptureAt();
  const now  = Date.now();
  const wait = Math.max(0, MIN_CAPTURE_INTERVAL_MS - (now - lastCaptureAt));
  if (wait > 0) await sleep(wait);

  for (let attempt = 0; attempt < MAX_CAPTURE_ATTEMPTS; attempt++) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
      await writeLastCaptureAt(Date.now());
      return dataUrl;
    } catch (err) {
      const msg = err?.message || String(err);
      if (msg.includes('MAX_CAPTURE') && attempt < MAX_CAPTURE_ATTEMPTS - 1) {
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error('captureVisibleTab: max retries reached');
}
