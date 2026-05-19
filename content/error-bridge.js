/**
 * MyFb Error Bridge (isolated world)
 *
 * Pendant du page-error-monitor.js. Écoute les CustomEvent
 * "__myfb_page_error__" dispatchés depuis le MAIN world et forwarde
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
  if (window.__MYFB_ERROR_BRIDGE__) return;
  window.__MYFB_ERROR_BRIDGE__ = true;

  const seen = new Set();
  const errors = [];                     // payloads complets (pour replay)
  const ERROR_KINDS = new Set(['console.error', 'error', 'unhandledrejection']);

  // ── Heuristique anti-bruit SDK tiers ────────────────────────────────
  //
  // Beaucoup de sites (LinkedIn, Notion, Twitter…) embarquent leur propre
  // Sentry-like qui appelle console.error pour ses limites internes
  // ("Can't add event, because span event limit (128) has been reached"
  // sur LinkedIn par exemple). Ces erreurs sont 100 % hors du contrôle
  // du user qui debugge son site avec My-Feedbacks — du pur bruit dans
  // le panneau Erreurs.
  //
  // Heuristique : si CHAQUE URL du stack trace est sur un hostname
  // différent de window.location.hostname (ET ne partage pas son
  // domaine racine), on considère l'erreur comme bruit tiers et on la
  // skip. Si même UNE seule frame est sur le code du user (même origine
  // ou sous-domaine du même registrable), on la garde.
  //
  // Edge cases couverts :
  //   - app.example.com avec assets sur static.example.com → kept
  //   - linkedin.com avec stack 100% sur static.licdn.com → dropped
  //   - Stack vide (pas d'URL extraitable) → kept (safe default)
  const URL_RE = /https?:\/\/([^\/\s)]+)/g;
  function _rootDomain(host) {
    if (!host) return '';
    const parts = host.replace(/^www\./, '').split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : host;
  }
  function _isThirdPartyNoise(d) {
    const blob = (d.stack || '') + ' ' + (d.file || '');
    const hosts = [];
    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(blob)) !== null) hosts.push(m[1]);
    if (hosts.length === 0) return false;
    const pageRoot = _rootDomain(window.location.hostname);
    return hosts.every((h) => _rootDomain(h) !== pageRoot);
  }

  window.addEventListener(window.MyFb.MSG.PAGE_ERROR_EVENT, (e) => {
    const d = (e && e.detail) || {};
    if (!ERROR_KINDS.has(d.kind)) return;
    if (_isThirdPartyNoise(d)) return;
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
      const p = chrome.runtime.sendMessage({ type: window.MyFb.MSG.CONSOLE_ERROR, error: payload });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) { /* SW idle, ignore */ }
  });

  // Replay : la side panel demande la liste complète des erreurs de la
  // page courante (ex. au changement d'onglet ou après ouverture).
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== window.MyFb.MSG.GET_ERRORS) return;
    if (sender.id && sender.id !== chrome.runtime.id) return;
    sendResponse({ errors: errors.slice() });
    return false;
  });
})();
