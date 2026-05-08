/**
 * BI Chrome AI Feedback - Service Worker (v0.4)
 */

importScripts('shared/constants.js');
importScripts('shared/ai-adapters.js');

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

// ---------- helpers -------------------------------------------------------

function waitForTabLoaded(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs || 15000);
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Retry sending msg to tabId until the content script confirms the editor is
 * ready (resp.ok) or we hit the timeout.  Two expected "retry" signals:
 *   - sendMessage throws  → content script not yet injected (document_idle pending)
 *   - resp.error === 'editor not found' → page loaded but editor DOM not rendered yet
 */
async function injectWithRetry(tabId, msg, { intervalMs = 400, maxMs = 15000 } = {}) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    let resp;
    try {
      resp = await chrome.tabs.sendMessage(tabId, msg);
    } catch (e) {
      const err = e?.message || String(e);
      // Content script not loaded yet — keep retrying
      if (err.includes('Could not establish connection') ||
          err.includes('Receiving end does not exist') ||
          err.includes('No tab with id')) {
        continue;
      }
      return { error: err };
    }
    if (resp && resp.ok) return resp;
    if (resp && resp.error === 'editor not found') continue; // editor DOM not ready yet
    return resp || {}; // any other response (including unexpected errors) — return as-is
  }
  return { error: 'injection timeout: editor not found after ' + Math.round(maxMs / 1000) + 's' };
}

// ---------- auto-open sidepanel when switching to known tab URL -----------

async function checkAutoOpenForTab(tabId, tabUrl) {
  if (!tabUrl || tabUrl.startsWith('chrome') || tabUrl.startsWith('about:') || tabUrl.startsWith('moz-extension:')) return;
  try {
    const result = await chrome.storage.local.get(self.BIAIF.STORAGE_KEY);
    const saved = result[self.BIAIF.STORAGE_KEY];
    if (!saved) return;
    const onActive  = !!saved.autoOpenOnKnownActive;
    const onDone    = !!saved.autoOpenOnKnownDone;
    const onAiPage  = !!saved.autoOpenOnAiPage;

    // Feature: open on any known AI page (claude.ai, chatgpt.com, etc.)
    if (onAiPage) {
      try {
        const tabHostname = new URL(tabUrl).hostname;
        const isAiPage = (self.BIAIF.AI_ADAPTERS || []).some((a) =>
          tabHostname === a.host || tabHostname.endsWith('.' + a.host)
        );
        if (isAiPage) { await chrome.sidePanel.open({ tabId }); return; }
      } catch (_) {}
    }

    if (!onActive && !onDone) return;
    const demandes = saved.demandes || [];
    const shouldOpen = demandes.some((dem) => {
      if (!dem.conversationUrl) return false;
      // Match if the tab URL starts with the conversation URL (handles trailing /new vs. /chat/ID)
      const urlMatch = tabUrl === dem.conversationUrl ||
        tabUrl.startsWith(dem.conversationUrl.split('?')[0]);
      if (!urlMatch) return false;
      const isDone = dem.status === 'done' || dem.status === 'submitted';
      return isDone ? onDone : onActive;
    });
    if (shouldOpen) await chrome.sidePanel.open({ tabId });
  } catch (_) {}
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    checkAutoOpenForTab(tabId, tab.url);
  } catch (_) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    checkAutoOpenForTab(tabId, tab.url);
  }
});

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

  // Sidepanel → target/active tab : inject text + images into external editor
  if (msg.type === MSG.INJECT_TO_EDITOR) {
    (async () => {
      try {
        if (msg.targetUrl) {
          const allTabs = await chrome.tabs.query({});
          const baseUrl = msg.targetUrl.split('?')[0];
          const existing = allTabs.find((t) =>
            t.url && (t.url === msg.targetUrl || t.url.startsWith(baseUrl))
          );
          let targetTabId;
          if (existing) {
            await chrome.tabs.update(existing.id, { active: true });
            try { await chrome.windows.update(existing.windowId, { focused: true }); } catch (_) {}
            targetTabId = existing.id;
          } else {
            const newTab = await chrome.tabs.create({ url: msg.targetUrl });
            targetTabId = newTab.id;
            await waitForTabLoaded(targetTabId);
          }
          // Retry until the content script + editor are both ready (max 15s)
          const resp = await injectWithRetry(targetTabId, msg);
          // Return tabId + actual URL (may differ from targetUrl after SPA navigation)
          const tabAfter = await chrome.tabs.get(targetTabId).catch(() => null);
          sendResponse(Object.assign({}, resp, {
            targetTabId,
            tabUrl: tabAfter && tabAfter.url,
          }));
        } else {
          // No targetUrl: inject into whichever tab is active; still return its ID
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [null]);
          const resp = await sendToActiveTabContent(msg);
          sendResponse(Object.assign({}, resp, {
            targetTabId: activeTab && activeTab.id,
            tabUrl:      activeTab && activeTab.url,
          }));
        }
      } catch (e) {
        sendResponse({ error: e?.message || String(e) });
      }
    })();
    return true;
  }

  // Content script → SW : open sidepanel and filter / start linked session
  if (msg.type === MSG.OPEN_WITH_FILTER || msg.type === MSG.START_LINKED_SEGMENT) {
    (async () => {
      try {
        const tabId = sender.tab && sender.tab.id;
        if (tabId) await chrome.sidePanel.open({ tabId });
        chrome.runtime.sendMessage(msg).catch(() => {});
      } catch (_) {}
      sendResponse({ ok: true });
    })();
    return true;
  }

  // Content script → sidepanel : forward capture progress
  if (msg.type === MSG.CAPTURE_PROGRESS) {
    chrome.runtime.sendMessage(msg).catch(() => {});
    return;
  }

  // Content script → SW → sidepanel: AI generating / response done
  if (msg.type === MSG.AI_STATUS_UPDATE || msg.type === MSG.AI_RESPONSE_DONE) {
    // Include the sender tab ID so the sidepanel can match regardless of URL navigation
    chrome.runtime.sendMessage(Object.assign({}, msg, { tabId: sender.tab && sender.tab.id })).catch(() => {});
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
