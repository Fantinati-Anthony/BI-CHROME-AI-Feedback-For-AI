/**
 * BI Chrome AI Feedback - Service Worker (v0.4)
 */

importScripts('shared/constants.js');

const MIN_CAPTURE_INTERVAL_MS = 1500;
const MAX_CAPTURE_ATTEMPTS = 3;
const LAST_CAPTURE_KEY = 'biaif:lastCaptureAt';

let capturePromise = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- side panel : auto-open on icon / hotkey ------------------------

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ---------- chrome.contextMenus ------------------------------------------

function setupContextMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'biaif-element',
      title: 'BIAIF — Ajouter cet élément (sélecteur)',
      contexts: ['page', 'frame', 'image', 'link', 'selection'],
    });
    chrome.contextMenus.create({
      id: 'biaif-capture-visible',
      title: 'BIAIF — Capturer le viewport visible',
      contexts: ['page', 'frame', 'image', 'link', 'selection'],
    });
    chrome.contextMenus.create({
      id: 'biaif-selection',
      title: 'BIAIF — Ajouter cette sélection',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'biaif-image',
      title: 'BIAIF — Ajouter cette image',
      contexts: ['image'],
    });
  });
}
chrome.runtime.onInstalled.addListener(setupContextMenus);
chrome.runtime.onStartup.addListener(setupContextMenus);

const MSG = self.BIAIF.MSG;

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try { if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id }); } catch (_) {}

    if (info.menuItemId === 'biaif-element') {
      sendToActiveTabContent({ type: MSG.COMMAND, action: 'picker-enable' });
      chrome.runtime.sendMessage({
        type: MSG.CONTEXT_STATUS,
        msg: 'Sélecteur activé — cliquez l\'élément à référencer.',
      }).catch(() => {});
    } else if (info.menuItemId === 'biaif-capture-visible') {
      chrome.runtime.sendMessage({
        type: MSG.CONTEXT_SHOT,
        mode: 'visible',
        pageUrl: info.pageUrl || tab?.url || null,
      }).catch(() => {});
    } else if (info.menuItemId === 'biaif-selection') {
      chrome.runtime.sendMessage({
        type: MSG.CONTEXT_ADD_TEXT,
        text: info.selectionText || '',
        pageUrl: info.pageUrl || tab?.url || null,
      }).catch(() => {});
    } else if (info.menuItemId === 'biaif-image') {
      chrome.runtime.sendMessage({
        type: MSG.CONTEXT_ADD_IMAGE,
        srcUrl: info.srcUrl || '',
        pageUrl: info.pageUrl || tab?.url || null,
      }).catch(() => {});
    }
  });
}

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
  if (command === 'toggle-picker') {
    sendToActiveTabContent({ type: MSG.COMMAND, action: 'toggle-picker' });
    return;
  }
  if (command === 'toggle-mic' || command === 'copy-prompt') {
    chrome.runtime.sendMessage({ type: MSG.HOTKEY, action: command }).catch(() => {});
  }
});

// ---------- message routing ---------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;

  // Sidepanel → active tab : picker
  if (msg.type === MSG.PICKER_TOGGLE || msg.type === MSG.PICKER_ENABLE ||
      msg.type === MSG.PICKER_DISABLE) {
    const action = msg.type.replace('biaif:', '');
    sendToActiveTabContent({ type: MSG.COMMAND, action })
      .then((resp) => sendResponse(resp));
    return true;
  }

  // Sidepanel → active tab : capture manuelle
  if (msg.type === MSG.CAPTURE_MODE) {
    sendToActiveTabContent({ type: MSG.COMMAND, action: 'capture-mode', mode: msg.mode })
      .then((resp) => sendResponse(resp));
    return true;
  }

  // Sidepanel → active tab : annotateur
  if (msg.type === MSG.ANNOTATE) {
    sendToActiveTabContent({ type: MSG.COMMAND, action: 'annotate', dataUrl: msg.dataUrl })
      .then((resp) => sendResponse(resp));
    return true;
  }

  // Sidepanel → SW : reload active tab
  if (msg.type === MSG.RELOAD_ACTIVE_TAB) {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) { sendResponse({ error: 'no active tab' }); return; }
        await chrome.tabs.reload(tab.id);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ error: e?.message || String(e) });
      }
    })();
    return true;
  }

  // Sidepanel → active tab : inject text + images into external editor
  if (msg.type === MSG.INJECT_TO_EDITOR) {
    sendToActiveTabContent(msg).then(function (resp) { sendResponse(resp); });
    return true;
  }

  // Content script → sidepanel : forward capture progress
  if (msg.type === MSG.CAPTURE_PROGRESS) {
    chrome.runtime.sendMessage(msg).catch(() => {});
    return;
  }

  // Content script → SW : captureVisibleTab
  if (msg.type === MSG.CAPTURE_TAB) {
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
});
