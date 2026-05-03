/**
 * BI Chrome AI Feedback - Service Worker (v0.2)
 *
 * Architecture v0.2 : Side Panel + Offscreen.
 *   - sidepanel.html : UI persistante, une seule par fenêtre, survit aux
 *     changements d'onglet.
 *   - offscreen.html : héberge SpeechRecognition. Un seul micro pour
 *     toute l'extension → plus de conflit cross-tab par construction.
 *   - content scripts (par onglet) : picker + screenshots du DOM actif.
 *
 * Le SW route les messages :
 *   sidepanel  → SW → offscreen        (commandes mic)
 *   offscreen  → SW → sidepanel        (events mic ; broadcast natif)
 *   sidepanel  → SW → activeTab        (picker, captures)
 *   activeTab  → SW → sidepanel        (element-picked, picker-state)
 */

const MIN_CAPTURE_INTERVAL_MS = 1500;
const MAX_CAPTURE_ATTEMPTS = 3;
const LAST_CAPTURE_KEY = 'biaif:lastCaptureAt';
const OFFSCREEN_PATH = 'offscreen.html';

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

// ---------- offscreen : create-once, JIT ----------------------------------

async function hasOffscreen() {
  if (!chrome.runtime.getContexts) return false;
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return contexts.some((c) => (c.documentUrl || '').endsWith('/' + OFFSCREEN_PATH));
  } catch (_) { return false; }
}

let creatingOffscreen = null;
async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['USER_MEDIA'],
    justification: 'Speech recognition for voice feedback (single mic across tabs).',
  })
    .catch((e) => { console.warn('[BIAIF] offscreen create failed', e?.message || e); })
    .finally(() => { creatingOffscreen = null; });
  return creatingOffscreen;
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
    if (!tab || !tab.id) return null;
    return await chrome.tabs.sendMessage(tab.id, payload);
  } catch (e) {
    console.warn('[BIAIF] sendToActiveTabContent failed', e?.message || e);
    return null;
  }
}

// ---------- hotkeys / icon click -----------------------------------------

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-sidebar') { openSidePanelForActive(); return; }
  if (command === 'toggle-picker')  { sendToActiveTabContent({ type: 'biaif:command', action: 'toggle-picker' }); return; }
  if (command === 'toggle-mic')     { chrome.runtime.sendMessage({ type: 'biaif:hotkey', action: 'toggle-mic' }).catch(() => {}); return; }
  if (command === 'copy-prompt')    { chrome.runtime.sendMessage({ type: 'biaif:hotkey', action: 'copy-prompt' }).catch(() => {}); return; }
});

// ---------- message routing ---------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;

  // Sidepanel → offscreen (mic commands)
  if (msg.type === 'biaif:mic-start' || msg.type === 'biaif:mic-stop' ||
      msg.type === 'biaif:mic-set-lang' || msg.type === 'biaif:mic-reset') {
    (async () => {
      await ensureOffscreen();
      const action =
        msg.type === 'biaif:mic-start'    ? 'start'    :
        msg.type === 'biaif:mic-stop'     ? 'stop'     :
        msg.type === 'biaif:mic-set-lang' ? 'set-lang' : 'reset';
      await chrome.runtime.sendMessage({ type: 'biaif:offscreen-cmd', action, lang: msg.lang })
        .catch(() => {});
      sendResponse({ ok: true });
    })();
    return true;
  }

  // Sidepanel → active tab (picker)
  if (msg.type === 'biaif:picker-toggle' || msg.type === 'biaif:picker-enable' ||
      msg.type === 'biaif:picker-disable') {
    sendToActiveTabContent({ type: 'biaif:command', action: msg.type.replace('biaif:', '') })
      .then((resp) => sendResponse(resp));
    return true;
  }

  // Content → captureVisibleTab (existing)
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

  // biaif:voice-event (offscreen → broadcast → sidepanel) and
  // biaif:element-picked / biaif:picker-state (content → broadcast → sidepanel)
  // pass through chrome.runtime.sendMessage natively, no SW intervention needed.
});
