/**
 * MyFb Page Error Monitor
 *
 * Injecté dans le MAIN world de la page au plus tôt (document_start).
 * - Override console.error pour capter ce qui apparaît dans l'onglet
 *   "Erreurs" des DevTools.
 * - Capture les exceptions non gérées (window.onerror) et les rejets
 *   de promesse non gérés (unhandledrejection).
 * - Dispatch un CustomEvent "__myfb_page_error__" sur window que le
 *   content script bridge (isolated world) intercepte et forwarde au
 *   side panel via chrome.runtime.sendMessage.
 *
 * NB : on ne peut pas appeler chrome.* depuis le MAIN world, d'où le
 * bridge.
 *
 * console.warn n'est PAS interceptée : error-bridge.js filtre déjà les
 * warnings et un wrapper sur console.warn ferait apparaître chaque
 * warning de la page (LinkedIn, Notion…) dans le panneau Erreurs de
 * l'extension à cause de la frame extension dans la stack.
 */

(function () {
  if (window.__MYFB_PAGE_MONITOR__) return;
  window.__MYFB_PAGE_MONITOR__ = true;

  const orig = {
    error: console.error.bind(console),
  };

  function stringifyArg(a) {
    if (a == null) return String(a);
    if (a instanceof Error) return a.stack || a.message || String(a);
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch (_) { return String(a); }
    }
    return String(a);
  }

  function fire(detail) {
    try {
      window.dispatchEvent(new CustomEvent('__myfb_page_error__', { detail }));
    } catch (_) {}
  }

  console.error = function (...args) {
    orig.error.apply(console, args);
    fire({
      kind: 'console.error',
      msg: args.map(stringifyArg).join(' '),
    });
  };

  window.addEventListener('error', function (e) {
    fire({
      kind: 'error',
      msg: e.message || (e.error && e.error.message) || String(e),
      file: e.filename || null,
      line: e.lineno || null,
      col: e.colno || null,
      stack: e.error && e.error.stack ? String(e.error.stack) : null,
    });
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    const r = e.reason;
    fire({
      kind: 'unhandledrejection',
      msg: (r && r.message) || (typeof r === 'string' ? r : 'Unhandled rejection'),
      stack: r && r.stack ? String(r.stack) : null,
    });
  });
})();
