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
  const ERROR_KINDS = new Set(['console.error', 'error', 'unhandledrejection']);

  window.addEventListener('__biaif_page_error__', (e) => {
    const d = (e && e.detail) || {};
    if (!ERROR_KINDS.has(d.kind)) return;
    const key = (d.kind || '') + '|' + (d.msg || '') + '|' + (d.file || '') + ':' + (d.line || 0);
    if (seen.has(key)) return;
    seen.add(key);
    try {
      const p = chrome.runtime.sendMessage({
        type: 'biaif:console-error',
        error: {
          msg: d.msg || '',
          file: d.file || null,
          line: d.line || null,
          col: d.col || null,
          stack: d.stack || null,
          kind: d.kind || 'error',
          url: window.location.href,
          ts: Date.now(),
          key,
        },
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) { /* SW idle, ignore */ }
  });
})();
