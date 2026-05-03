/**
 * BI Chrome AI Feedback - Service Worker
 *
 * Relaie :
 *   - les hotkeys (chrome.commands) et clics sur l'icône vers le content script
 *   - les demandes de capture (chrome.tabs.captureVisibleTab) depuis la page
 *
 * captureVisibleTab est rate-limité par Chrome (~2 appels/seconde par fenêtre).
 * Pour les captures scroll+stitch on doit espacer les appels et retrier sur
 * MAX_CAPTURE_VISIBLE_TAB_CALLS.
 */

const COMMAND_TO_ACTION = {
  'toggle-sidebar': 'toggle-sidebar',
  'toggle-picker': 'toggle-picker',
  'toggle-mic': 'toggle-mic',
  'copy-prompt': 'copy-prompt',
};

const MIN_CAPTURE_INTERVAL_MS = 1500;
const MAX_CAPTURE_ATTEMPTS = 3;
let lastCaptureAt = 0;
let capturePromise = Promise.resolve();

async function sendToActiveTab(action) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'biaif:command', action });
  } catch (err) {
    console.warn('[BIAIF] sendMessage failed:', err?.message || err);
  }
}

chrome.commands.onCommand.addListener((command) => {
  const action = COMMAND_TO_ACTION[command];
  if (action) sendToActiveTab(action);
});

chrome.action.onClicked.addListener(() => {
  sendToActiveTab('toggle-sidebar');
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureWithRateLimit(windowId) {
  const now = Date.now();
  const wait = Math.max(0, MIN_CAPTURE_INTERVAL_MS - (now - lastCaptureAt));
  if (wait > 0) await sleep(wait);

  for (let attempt = 0; attempt < MAX_CAPTURE_ATTEMPTS; attempt++) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
      lastCaptureAt = Date.now();
      return dataUrl;
    } catch (err) {
      const msg = err?.message || String(err);
      if (msg.includes('MAX_CAPTURE') && attempt < MAX_CAPTURE_ATTEMPTS - 1) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error('captureVisibleTab: max retries reached');
}

/**
 * Capture du tab visible (appelé depuis content/screenshot.js).
 * Sérialisée pour éviter de spammer chrome.tabs.captureVisibleTab depuis
 * plusieurs sections en même temps.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'biaif:capture-tab') return false;
  const windowId = sender.tab?.windowId;
  capturePromise = capturePromise
    .catch(() => {})
    .then(() => captureWithRateLimit(windowId))
    .then(
      (dataUrl) => sendResponse({ dataUrl }),
      (err) => sendResponse({ error: err?.message || String(err) })
    );
  return true; // réponse asynchrone
});
