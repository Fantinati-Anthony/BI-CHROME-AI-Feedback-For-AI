/**
 * BIAIF Main Content Script
 *
 * Reçoit les ordres du service worker (hotkeys / clic icône) et
 * les répercute sur les modules de la page.
 *
 * Fournit aussi un listener clavier in-page comme filet de sécurité
 * lorsque chrome.commands est déjà pris par une autre extension/app
 * (Alt+Shift+F est notamment utilisé par VS Code).
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
    'toggle-session': () => {
      ensureSidebarOpen();
      window.BIAIFSidebar.toggleSession();
    },
    'copy-prompt': () => {
      ensureSidebarOpen();
      window.BIAIFSidebar.copyPrompt();
    },
  };

  function runAction(action) {
    const fn = handlers[action];
    if (fn) {
      try { fn(); } catch (e) { console.warn('[BIAIF]', action, e); }
    }
  }

  // 1) Pont avec le service worker (chrome.commands + clic icône)
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'biaif:command') return;
    runAction(msg.action);
    sendResponse({ ok: true });
    return true;
  });

  // 2) Listener clavier in-page (filet de sécurité contre les conflits
  //    de chrome.commands). Mêmes combinaisons par défaut.
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    let action = null;
    if (k === 'f') action = 'toggle-sidebar';
    else if (k === 'e') action = 'toggle-picker';
    else if (k === 'm') action = 'toggle-mic';
    else if (k === 'c') action = 'copy-prompt';
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    runAction(action);
  }, true);
})();
