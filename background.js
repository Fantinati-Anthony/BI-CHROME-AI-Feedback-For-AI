/**
 * BI Chrome AI Feedback - Service Worker (v0.3)
 *
 * Architecture v0.3 (mono-instance) :
 *   - sidepanel.html : UI + SpeechRecognition (mic est ici directement,
 *     plus d'offscreen). Persistant cross-tab.
 *   - content scripts (par onglet) : picker + screenshot + annotateur.
 *   - SW : route picker / capture-mode / annotate / capture-tab vers
 *     l'onglet actif. Sérialise captureVisibleTab pour respecter le
 *     rate-limit Chrome.
 */

const MIN_CAPTURE_INTERVAL_MS = 1500;
const MAX_CAPTURE_ATTEMPTS = 3;
const LAST_CAPTURE_KEY = 'biaif:lastCaptureAt';

let capturePromise = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- side panel : auto-open on icon / hotkey ------------------------

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function openSidePanelForActive() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) await chrome.sidePanel.open({ tabId: tab.id });
  } catch (e) {
    console.warn('[BIAIF] sidePanel.open failed', e?.message || e);
  }
}

// ---------- captureVisibleTab : rate-limit + serialize --------------------

async function readLastCaptureAt() {
  try {
    const o = await chrome.storage.session.get(LAST_CAPTURE_KEY);
    return Number(o[LAST_CAPTURE_KEY]) || 0;
  } catch (_) { return 0; }
}
async function writeLastCaptureAt(ts) {
  try { await chrome.storage.session.set({ [LAST_CAPTURE_KEY]: ts }); } catch (_) {}
}

async function captureWithRateLimit(windowId) {
  const lastCaptureAt = await readLastCaptureAt();
  const now = Date.now();
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
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error('captureVisibleTab: max retries reached');
}

// ---------- bridge to active tab content script --------------------------

async function sendToActiveTabContent(payload) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return { error: 'no active tab' };
    return await chrome.tabs.sendMessage(tab.id, payload);
  } catch (e) {
    console.warn('[BIAIF] sendToActiveTabContent failed', e?.message || e);
    return { error: e?.message || String(e) };
  }
}

// ---------- hotkeys / icon click -----------------------------------------

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-sidebar') { openSidePanelForActive(); return; }
  if (command === 'toggle-picker')  {
    sendToActiveTabContent({ type: 'biaif:command', action: 'toggle-picker' });
    return;
  }
  if (command === 'toggle-mic' || command === 'copy-prompt') {
    chrome.runtime.sendMessage({ type: 'biaif:hotkey', action: command }).catch(() => {});
  }
});

// ---------- message routing ---------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;

  // Sidepanel → active tab : picker
  if (msg.type === 'biaif:picker-toggle' || msg.type === 'biaif:picker-enable' ||
      msg.type === 'biaif:picker-disable') {
    sendToActiveTabContent({ type: 'biaif:command', action: msg.type.replace('biaif:', '') })
      .then((resp) => sendResponse(resp));
    return true;
  }

  // Sidepanel → active tab : capture manuelle (visible/selection/element/fullpage)
  if (msg.type === 'biaif:capture-mode') {
    sendToActiveTabContent({ type: 'biaif:command', action: 'capture-mode', mode: msg.mode })
      .then((resp) => sendResponse(resp));
    return true;
  }

  // Sidepanel → active tab : annotateur (modal dans la page)
  if (msg.type === 'biaif:annotate') {
    sendToActiveTabContent({ type: 'biaif:command', action: 'annotate', dataUrl: msg.dataUrl })
      .then((resp) => sendResponse(resp));
    return true;
  }

  // Content script → SW : captureVisibleTab (sérialisée + rate-limit)
  if (msg.type === 'biaif:capture-tab') {
    const windowId = sender.tab?.windowId;
    capturePromise = capturePromise
      .catch(() => {})
      .then(() => captureWithRateLimit(windowId))
      .then(
        (dataUrl) => sendResponse({ dataUrl }),
        (err) => sendResponse({ error: err?.message || String(err) })
      );
    return true;
  }

  // biaif:element-picked / biaif:picker-state passent natif via
  // chrome.runtime.sendMessage → reçus directement par la side panel.
});
