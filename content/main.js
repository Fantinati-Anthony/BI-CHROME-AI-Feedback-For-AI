/**
 * MyFb Main Content Script (v0.3)
 *
 * Bridge entre le service worker et les modules in-tab.
 *   - Picker : enable / disable / toggle (MyFbElementSelector)
 *   - Capture manuelle : visible / selection / element / fullpage
 *     (MyFbScreenshot)
 *   - Annotateur : ouvre la modale (MyFbScreenshotEditor) sur un dataUrl
 *     et renvoie le résultat
 *   - Listener clavier in-page comme filet de sécurité contre les
 *     conflits de chrome.commands
 */

(function () {
  'use strict';

  if (window.__MYFB_LOADED__) return;
  window.__MYFB_LOADED__ = true;

  // Pont SW → onglet : on traite les commandes de manière async pour
  // pouvoir renvoyer un dataUrl (capture, annotate).
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== window.MyFb.MSG.COMMAND) return;

    const action = msg.action;

    // Ping : permet à la side panel de savoir si le content script est chargé.
    if (action === 'ping') {
      sendResponse({ ok: true, version: window.MyFb.VERSION });
      return;
    }

    // Picker : sync, fire-and-forget
    if (action === 'toggle-picker' || action === 'picker-toggle') {
      try { window.MyFbElementSelector && window.MyFbElementSelector.toggle(); } catch (_) {}
      sendResponse({ ok: true });
      return; // pas async, mais réponse immédiate
    }
    if (action === 'picker-enable') {
      try { window.MyFbElementSelector && window.MyFbElementSelector.enable(); } catch (_) {}
      sendResponse({ ok: true });
      return;
    }
    if (action === 'picker-disable') {
      try { window.MyFbElementSelector && window.MyFbElementSelector.disable(); } catch (_) {}
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
    if (!window.MyFbScreenshot) throw new Error('Module screenshot indisponible');
    const Shot = window.MyFbScreenshot;
    if (mode === 'visible')   return Shot.capture();
    if (mode === 'selection') return Shot.pickAndCapture('selection');
    if (mode === 'element')   return Shot.pickAndCapture('element');
    if (mode === 'fullpage')  return Shot.captureFullPage();
    throw new Error('mode inconnu : ' + mode);
  }

  async function handleAnnotate(dataUrl) {
    if (!window.MyFbScreenshotEditor) {
      return { error: 'Annotateur indisponible' };
    }
    if (!dataUrl) {
      return { error: 'pas de dataUrl' };
    }
    try {
      const result = await window.MyFbScreenshotEditor.open(dataUrl);
      if (!result) return { cancelled: true };
      return { dataUrl: result };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  }

  // ---------- Console errors monitor ----------
  // Désormais géré par les content scripts dédiés :
  //   - content/page-error-monitor.js (MAIN world, document_start)
  //   - content/error-bridge.js       (isolated, document_start)
  // Aucun code ici : on ne capte rien depuis ce script (document_idle)
  // car la plupart des erreurs surviennent au chargement de la page.

  // Listener clavier in-page (filet de sécurité contre les conflits
  // de chrome.commands).
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === 'e') {
      e.preventDefault(); e.stopPropagation();
      try { window.MyFbElementSelector && window.MyFbElementSelector.toggle(); } catch (_) {}
      return;
    }
    if (k === 'f' || k === 'm' || k === 'c') {
      e.preventDefault(); e.stopPropagation();
      const action = k === 'f' ? 'toggle-sidebar' : k === 'm' ? 'toggle-mic' : 'copy-prompt';
      chrome.runtime.sendMessage({ type: window.MyFb.MSG.HOTKEY, action }).catch(() => {});
    }
  }, true);
})();
