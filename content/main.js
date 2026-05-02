/**
 * BIAIF Main Content Script
 *
 * Reçoit les ordres du service worker (hotkeys / clic icône) et
 * les répercute sur les modules de la page.
 */

(function () {
  'use strict';

  if (window.__BIAIF_LOADED__) return;
  window.__BIAIF_LOADED__ = true;

  function ensureSidebarOpen() {
    if (!window.BIAIFSidebar.state.open) window.BIAIFSidebar.open();
  }

  const handlers = {
    'toggle-sidebar': () => window.BIAIFSidebar.toggle(),
    'toggle-picker': () => {
      ensureSidebarOpen();
      window.BIAIFElementSelector.toggle();
    },
    'toggle-mic': () => {
      ensureSidebarOpen();
      window.BIAIFVoiceRecorder.toggle();
    },
    'copy-prompt': () => {
      ensureSidebarOpen();
      window.BIAIFSidebar.copyPrompt();
    },
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'biaif:command') return;
    const fn = handlers[msg.action];
    if (fn) {
      try { fn(); sendResponse({ ok: true }); }
      catch (e) { sendResponse({ ok: false, error: e.message }); }
    } else {
      sendResponse({ ok: false, error: 'unknown action' });
    }
    return true;
  });
})();
