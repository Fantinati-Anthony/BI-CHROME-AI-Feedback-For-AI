/**
 * BIAIF Service Worker — chrome.runtime.onMessage routing
 *
 * Routes messages between sidepanel ↔ content scripts. Returning `true`
 * from the listener tells Chrome to keep the message channel open until
 * we call `sendResponse` asynchronously.
 *
 * Message families handled here:
 *   - PICKER_TOGGLE / ENABLE / DISABLE  → forwarded to active tab
 *   - CAPTURE_MODE                       → forwarded as 'capture-mode' command
 *   - ANNOTATE                           → forwarded as 'annotate' command
 *   - RELOAD_ACTIVE_TAB                  → reload + ack
 *   - INJECT_TO_EDITOR                   → maybeOpenTab + injectWithRetry
 *   - OPEN_WITH_FILTER, START_LINKED_*   → open sidepanel + relay to it
 *   - CAPTURE_PROGRESS                   → relay (content → sidepanel)
 *   - AI_STATUS_UPDATE, AI_RESPONSE_DONE → relay with sender tabId
 *   - CAPTURE_TAB                        → captureWithRateLimit
 */

/* eslint-disable no-undef */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;
  // SECURITY: only accept messages originating from this extension itself
  // (sidepanel, content scripts, options page). Blocks any rogue extension
  // installed alongside that might try to talk to our service worker.
  if (!sender || sender.id !== chrome.runtime.id) return;

  // Sidepanel → active tab : picker
  if (msg.type === MSG.PICKER_TOGGLE || msg.type === MSG.PICKER_ENABLE ||
      msg.type === MSG.PICKER_DISABLE) {
    const action = msg.type.replace('biaif:', '');
    sendToActiveTabContent({ type: MSG.COMMAND, action })
      .then((resp) => sendResponse(resp));
    return true;
  }

  // Sidepanel → active tab : manual capture
  if (msg.type === MSG.CAPTURE_MODE) {
    sendToActiveTabContent({ type: MSG.COMMAND, action: 'capture-mode', mode: msg.mode })
      .then((resp) => sendResponse(resp));
    return true;
  }

  // Sidepanel → active tab : annotation editor
  if (msg.type === MSG.ANNOTATE) {
    sendToActiveTabContent({ type: MSG.COMMAND, action: 'annotate', dataUrl: msg.dataUrl })
      .then((resp) => sendResponse(resp));
    return true;
  }

  // Sidepanel → SW : reload the active tab
  if (msg.type === MSG.RELOAD_ACTIVE_TAB) {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) { sendResponse({ error: 'no active tab' }); return; }
        await chrome.tabs.reload(tab.id);
        sendResponse({ ok: true });
      } catch (e) { sendResponse({ error: e?.message || String(e) }); }
    })();
    return true;
  }

  // Sidepanel → target/active tab : inject text + images into external editor.
  // If targetUrl is provided we focus or open that tab first, then
  // injectWithRetry handles the editor-not-ready period.
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
          const resp     = await injectWithRetry(targetTabId, msg);
          const tabAfter = await chrome.tabs.get(targetTabId).catch(() => null);
          sendResponse(Object.assign({}, resp, {
            targetTabId,
            tabUrl: tabAfter && tabAfter.url,
          }));
        } else {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
            .catch(() => [null]);
          const resp = await sendToActiveTabContent(msg);
          sendResponse(Object.assign({}, resp, {
            targetTabId: activeTab && activeTab.id,
            tabUrl:      activeTab && activeTab.url,
          }));
        }
      } catch (e) { sendResponse({ error: e?.message || String(e) }); }
    })();
    return true;
  }

  // Content script → SW : open sidepanel + relay
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

  // Content script → sidepanel : capture progress (forwarded as-is)
  if (msg.type === MSG.CAPTURE_PROGRESS) {
    chrome.runtime.sendMessage(msg).catch(() => {});
    return;
  }

  // Content script → SW → sidepanel : AI generating / response done.
  // We stamp the sender tabId so the sidepanel can match even if the URL
  // changed mid-flight (Claude.ai /new → /chat/UUID).
  if (msg.type === MSG.AI_STATUS_UPDATE || msg.type === MSG.AI_RESPONSE_DONE) {
    chrome.runtime.sendMessage(Object.assign({}, msg, {
      tabId: sender.tab && sender.tab.id,
    })).catch(() => {});
    return;
  }

  // Content script → SW : captureVisibleTab (queued globally)
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

  // Sidepanel → SW → user's bridge endpoint (DB info).
  // Sidepanel CSP forbids arbitrary connect-src; SW has no such limit.
  // Body is pre-signed (HMAC) by the caller — SW just forwards bytes.
  if (msg.type === MSG.DB_BRIDGE_CALL) {
    (async () => {
      try {
        if (typeof msg.url !== 'string' || !/^https?:\/\//.test(msg.url)) {
          sendResponse({ error: 'invalid bridge url' }); return;
        }
        if (!msg.body || typeof msg.body !== 'object') {
          sendResponse({ error: 'missing body' }); return;
        }
        const r = await fetch(msg.url, {
          method:  'POST',
          mode:    'cors',
          cache:   'no-store',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(msg.body),
        });
        const text = await r.text();
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (_) { /* leave as null */ }
        sendResponse({ status: r.status, ok: r.ok, body: parsed, raw: parsed ? undefined : text.slice(0, 500) });
      } catch (e) {
        sendResponse({ error: e?.message || String(e) });
      }
    })();
    return true;
  }
});
