/**
 * My-Feedbacks Breadcrumbs (content script — isolated world)
 *
 * Captures a rolling buffer of the user's last N user-interaction
 * "breadcrumbs" so that, at submit time, the feedback prompt can carry
 * the last 20 actions that led to the bug. Massively improves
 * reproducibility — turns "ça marche pas" into "click on .submit-btn
 * after typing in input#email" within seconds.
 *
 * What's captured per breadcrumb:
 *   { ts, type, selector, text? }
 *
 * What's NOT captured (RGPD-safe by design):
 *   - The VALUE of input fields (passwords, emails, sensitive text)
 *   - innerHTML of clicked elements
 *   - Any cookie / storage data
 *
 * `text` is included ONLY for buttons and links, truncated to 60 chars
 * and PII-scrubbed before storage.
 *
 * Buffer is per-tab, in-memory only. Side panel pulls it via
 * chrome.tabs.sendMessage('myfb:breadcrumbs:get').
 */

(function () {
  'use strict';

  if (window.__MYFB_BREADCRUMBS__) return;
  window.__MYFB_BREADCRUMBS__ = true;

  var MAX = 20;
  var _ring = [];

  // Lazy scrub - if MyFbScrub is available use it, else basic regex
  function _scrubText(s) {
    if (!s) return s;
    try {
      if (window.MyFbScrub && window.MyFbScrub.scrub) return window.MyFbScrub.scrub(s);
    } catch (_) {}
    // Basic fallback: strip emails
    return String(s).replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]');
  }

  function _shortSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + el.id.slice(0, 40);
    var tag = (el.tagName || '').toLowerCase();
    var cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    return (tag + cls).slice(0, 80);
  }

  function _safeText(el) {
    var t = (el.innerText || el.textContent || '').trim();
    if (!t) return null;
    return _scrubText(t.slice(0, 60));
  }

  function _push(crumb) {
    crumb.ts = Date.now();
    _ring.push(crumb);
    if (_ring.length > MAX) _ring.shift();
  }

  // ── Click breadcrumbs ───────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var el = e.target;
    if (!el || el.nodeType !== 1) return;
    var crumb = { type: 'click', selector: _shortSelector(el) };
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'button' || tag === 'a') {
      var txt = _safeText(el);
      if (txt) crumb.text = txt;
    }
    _push(crumb);
  }, true);

  // ── Submit breadcrumbs ──────────────────────────────────────────────
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || f.tagName !== 'FORM') return;
    _push({ type: 'submit', selector: _shortSelector(f) });
  }, true);

  // ── Input focus breadcrumbs (no value, just selector) ───────────────
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (!el || el.nodeType !== 1) return;
    var tag = (el.tagName || '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return;
    var type = (el.getAttribute && el.getAttribute('type') || '').toLowerCase();
    // Skip sensitive input types entirely.
    if (type === 'password' || type === 'creditcard' || type === 'cc-number') return;
    _push({ type: 'focus', selector: _shortSelector(el) });
  }, true);

  // ── Navigation breadcrumbs (history API hook) ───────────────────────
  function _wrapHistory(method) {
    var orig = history[method];
    if (typeof orig !== 'function') return;
    history[method] = function () {
      var ret = orig.apply(this, arguments);
      _push({ type: 'navigate', selector: location.pathname + location.search });
      return ret;
    };
  }
  try { _wrapHistory('pushState'); _wrapHistory('replaceState'); } catch (_) {}
  window.addEventListener('popstate', function () {
    _push({ type: 'navigate', selector: location.pathname + location.search });
  });

  // ── chrome.runtime API ──────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'myfb:breadcrumbs:get') return;
    if (sender.id && sender.id !== chrome.runtime.id) return;
    sendResponse({ breadcrumbs: _ring.slice() });
    return false;
  });

  // Test-friendly export
  window.MyFbBreadcrumbs = {
    list:  function () { return _ring.slice(); },
    clear: function () { _ring = []; },
    _max:  MAX,
  };
})();
