/**
 * BIAIF Main Content Script (v0.2)
 *
 * Bridge entre le service worker et les modules in-tab. La sidebar et le
 * micro ne vivent plus dans la page (ils sont dans chrome.sidePanel et
 * dans l'offscreen document) — ici on ne pilote plus que le picker et
 * les outils screenshot.
 *
 * Fournit aussi un listener clavier in-page comme filet de sécurité
 * lorsque chrome.commands est déjà pris par une autre extension/app.
 */

(function () {
  'use strict';

  if (window.__BIAIF_LOADED__) return;
  window.__BIAIF_LOADED__ = true;

  const handlers = {
    'toggle-picker':  () => window.BIAIFElementSelector && window.BIAIFElementSelector.toggle(),
    'picker-toggle':  () => window.BIAIFElementSelector && window.BIAIFElementSelector.toggle(),
    'picker-enable':  () => window.BIAIFElementSelector && window.BIAIFElementSelector.enable(),
    'picker-disable': () => window.BIAIFElementSelector && window.BIAIFElementSelector.disable(),
  };

  function runAction(action) {
    const fn = handlers[action];
    if (!fn) return;
    try { fn(); } catch (e) { console.warn('[BIAIF]', action, e); }
  }

  // 1) Pont avec le service worker (chrome.commands + sidepanel commandes)
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'biaif:command') return;
    runAction(msg.action);
    sendResponse({ ok: true });
    return true;
  });

  // 2) Listener clavier in-page (filet de sécurité contre les conflits
  //    de chrome.commands). Les autres raccourcis (mic / copy / sidebar)
  //    sont remontés au SW pour qu'il les route vers la side panel.
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === 'e') {
      e.preventDefault(); e.stopPropagation();
      runAction('toggle-picker');
    } else if (k === 'f' || k === 'm' || k === 'c') {
      e.preventDefault(); e.stopPropagation();
      const action = k === 'f' ? 'toggle-sidebar' : k === 'm' ? 'toggle-mic' : 'copy-prompt';
      chrome.runtime.sendMessage({ type: 'biaif:hotkey', action }).catch(() => {});
    }
  }, true);
})();
