/**
 * BIAIF Error Bridge (isolated world)
 *
 * Pendant du page-error-monitor.js. Écoute les CustomEvent
 * "__biaif_page_error__" dispatchés depuis le MAIN world et forwarde
 * chaque erreur unique au side panel via chrome.runtime.sendMessage.
 *
 * Filtre :
 *   - on ne forwarde que les erreurs "réelles" : console.error,
 *     window.error, unhandledrejection. Les warnings sont ignorés
 *     ici (l'addon affiche un compteur d'erreurs, pas de warnings).
 *   - dédoublonnage par (kind|msg|file:line) côté content script ;
 *     un second dédoublonnage côté side panel filtre les répétitions
 *     entre rechargements de la sidebar.
 */

(function () {
  if (window.__BIAIF_ERROR_BRIDGE__) return;
  window.__BIAIF_ERROR_BRIDGE__ = true;

  const seen = new Set();
  const errors = [];                     // payloads complets (pour replay)
  const ERROR_KINDS = new Set(['console.error', 'error', 'unhandledrejection']);

  window.addEventListener(window.BIAIF.MSG.PAGE_ERROR_EVENT, (e) => {
    const d = (e && e.detail) || {};
    if (!ERROR_KINDS.has(d.kind)) return;
    const key = (d.kind || '') + '|' + (d.msg || '') + '|' + (d.file || '') + ':' + (d.line || 0);
    if (seen.has(key)) return;
    seen.add(key);
    const payload = {
      msg: d.msg || '',
      file: d.file || null,
      line: d.line || null,
      col: d.col || null,
      stack: d.stack || null,
      kind: d.kind || 'error',
      url: window.location.href,
      ts: Date.now(),
      key,
    };
    errors.push(payload);
    try {
      const p = chrome.runtime.sendMessage({ type: window.BIAIF.MSG.CONSOLE_ERROR, error: payload });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) { /* SW idle, ignore */ }
  });

  // Replay : la side panel demande la liste complète des erreurs de la
  // page courante (ex. au changement d'onglet ou après ouverture).
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== window.BIAIF.MSG.GET_ERRORS) return;
    if (sender.id && sender.id !== chrome.runtime.id) return;
    sendResponse({ errors: errors.slice() });
    return false;
  });
})();
