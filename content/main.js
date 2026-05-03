/**
 * BIAIF Main Content Script (v0.3)
 *
 * Bridge entre le service worker et les modules in-tab.
 *   - Picker : enable / disable / toggle (BIAIFElementSelector)
 *   - Capture manuelle : visible / selection / element / fullpage
 *     (BIAIFScreenshot)
 *   - Annotateur : ouvre la modale (BIAIFScreenshotEditor) sur un dataUrl
 *     et renvoie le résultat
 *   - Listener clavier in-page comme filet de sécurité contre les
 *     conflits de chrome.commands
 */

(function () {
  'use strict';

  if (window.__BIAIF_LOADED__) return;
  window.__BIAIF_LOADED__ = true;

  // Pont SW → onglet : on traite les commandes de manière async pour
  // pouvoir renvoyer un dataUrl (capture, annotate).
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'biaif:command') return;

    const action = msg.action;

    // Picker : sync, fire-and-forget
    if (action === 'toggle-picker' || action === 'picker-toggle') {
      try { window.BIAIFElementSelector && window.BIAIFElementSelector.toggle(); } catch (_) {}
      sendResponse({ ok: true });
      return; // pas async, mais réponse immédiate
    }
    if (action === 'picker-enable') {
      try { window.BIAIFElementSelector && window.BIAIFElementSelector.enable(); } catch (_) {}
      sendResponse({ ok: true });
      return;
    }
    if (action === 'picker-disable') {
      try { window.BIAIFElementSelector && window.BIAIFElementSelector.disable(); } catch (_) {}
      sendResponse({ ok: true });
      return;
    }

    // Capture manuelle : async (lookup DOM + capture + crop)
    if (action === 'capture-mode') {
      handleCaptureMode(msg.mode).then(
        (dataUrl) => sendResponse({ dataUrl }),
        (err) => sendResponse({ error: err?.message || String(err) })
      );
      return true; // garde le canal ouvert pour async sendResponse
    }

    // Annotateur : ouvre la modale et attend le résultat
    if (action === 'annotate') {
      handleAnnotate(msg.dataUrl).then(
        (result) => sendResponse(result),
        (err) => sendResponse({ error: err?.message || String(err) })
      );
      return true;
    }
  });

  async function handleCaptureMode(mode) {
    if (!window.BIAIFScreenshot) throw new Error('Module screenshot indisponible');
    const Shot = window.BIAIFScreenshot;
    if (mode === 'visible')   return Shot.capture();
    if (mode === 'selection') return Shot.pickAndCapture('selection');
    if (mode === 'element')   return Shot.pickAndCapture('element');
    if (mode === 'fullpage')  return Shot.captureFullPage();
    throw new Error('mode inconnu : ' + mode);
  }

  async function handleAnnotate(dataUrl) {
    if (!window.BIAIFScreenshotEditor) {
      return { error: 'Annotateur indisponible' };
    }
    if (!dataUrl) {
      return { error: 'pas de dataUrl' };
    }
    try {
      const result = await window.BIAIFScreenshotEditor.open(dataUrl);
      if (!result) return { cancelled: true };
      return { dataUrl: result };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  }

  // Listener clavier in-page (filet de sécurité contre les conflits
  // de chrome.commands).
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === 'e') {
      e.preventDefault(); e.stopPropagation();
      try { window.BIAIFElementSelector && window.BIAIFElementSelector.toggle(); } catch (_) {}
      return;
    }
    if (k === 'f' || k === 'm' || k === 'c') {
      e.preventDefault(); e.stopPropagation();
      const action = k === 'f' ? 'toggle-sidebar' : k === 'm' ? 'toggle-mic' : 'copy-prompt';
      chrome.runtime.sendMessage({ type: 'biaif:hotkey', action }).catch(() => {});
    }
  }, true);
})();
