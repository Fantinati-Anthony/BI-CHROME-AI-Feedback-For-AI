/**
 * BIAIF Textarea Injector
 *
 * Injects a pair of always-visible buttons next to every <textarea> and
 * [contenteditable] found on the page (including dynamically added ones).
 *
 * Button 1 (funnel) – opens the sidepanel filtered to segments linked to
 *   the EXACT conversation URL (location.href at click time).
 * Button 2 (plus)   – opens the sidepanel, starts a new session, and tags
 *   every segment created in that session with the conversation URL.
 *
 * Buttons are always visible (not just on focus) when the textarea is in
 * the viewport.  Positions are kept in sync via ResizeObserver + scroll/rAF.
 */
(function () {
  'use strict';

  if (window.__BIAIF_TEXTAREA_INJECTOR__) return;
  window.__BIAIF_TEXTAREA_INJECTOR__ = true;

  /* ── constants ─────────────────────────────────────────────────────────── */

  var STYLE_ID = '__biaif_style__';
  var CSS = [
    '.__biaif_pair__ {',
    '  position:fixed;',
    '  z-index:2147483647;',
    '  display:flex;',
    '  gap:4px;',
    '  pointer-events:auto;',
    '  transition: opacity .2s;',
    '}',
    '.__biaif_pair__.is-hidden { opacity:0; pointer-events:none; }',
    '.__biaif_btn__ {',
    '  width:26px; height:26px;',
    '  border-radius:50%;',
    '  border:none;',
    '  padding:0;',
    '  cursor:pointer;',
    '  display:flex;',
    '  align-items:center;',
    '  justify-content:center;',
    '  box-shadow:0 2px 6px rgba(0,0,0,.35);',
    '  transition: transform .15s, opacity .15s;',
    '  font-family:sans-serif;',
    '}',
    '.__biaif_btn__:hover { transform:scale(1.12); }',
    '.__biaif_btn__--filter { background:#6c47ff; }',
    '.__biaif_btn__--new    { background:#1a9e6f; }',
    '.__biaif_btn__ svg { display:block; }',
    '.__biaif_tip__ {',
    '  position:absolute;',
    '  bottom:calc(100% + 5px);',
    '  left:50%;',
    '  transform:translateX(-50%);',
    '  background:#1a1a2e;',
    '  color:#fff;',
    '  font-size:11px;',
    '  white-space:nowrap;',
    '  padding:3px 7px;',
    '  border-radius:4px;',
    '  pointer-events:none;',
    '  opacity:0;',
    '  transition:opacity .1s;',
    '}',
    '.__biaif_btn__:hover .__biaif_tip__ { opacity:1; }',
  ].join('\n');

  /* ── style injection ────────────────────────────────────────────────────── */

  function _ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id  = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ── tracked elements ───────────────────────────────────────────────────── */

  // Map<Element, { pair:Element, ro:ResizeObserver, io:IntersectionObserver }>
  var _tracked = new Map();

  var _rAF = null;

  function _scheduleUpdate() {
    if (_rAF) return;
    _rAF = requestAnimationFrame(function () {
      _rAF = null;
      _tracked.forEach(function (entry, el) {
        _reposition(el, entry.pair);
      });
    });
  }

  function _reposition(el, pair) {
    var rect = el.getBoundingClientRect();
    var vw   = window.innerWidth;
    var vh   = window.innerHeight;
    var inView = rect.width > 0 && rect.height > 0 &&
                 rect.bottom > 0 && rect.top < vh &&
                 rect.right > 0  && rect.left < vw;

    if (!inView) { pair.classList.add('is-hidden'); return; }
    pair.classList.remove('is-hidden');

    // Place bottom-right corner of the textarea, shifted slightly inside
    var PAIR_W  = 26 + 4 + 26; // btn + gap + btn
    var PAIR_H  = 26;
    var MARGIN  = 4;

    var top  = rect.bottom - PAIR_H - MARGIN;
    var left = rect.right  - PAIR_W - MARGIN;

    // Clamp inside viewport
    if (left < 4)        left = 4;
    if (top  < 4)        top  = rect.top + MARGIN;
    if (left + PAIR_W > vw - 4) left = vw - PAIR_W - 4;
    if (top  + PAIR_H > vh - 4) top  = vh - PAIR_H - 4;

    pair.style.top  = top  + 'px';
    pair.style.left = left + 'px';
  }

  function _makeBtn(cls, svg, tip, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = '__biaif_btn__ __biaif_btn__--' + cls;
    btn.setAttribute('aria-label', tip);
    var tipEl = document.createElement('span');
    tipEl.className = '__biaif_tip__';
    tipEl.textContent = tip;
    btn.innerHTML = svg;
    btn.appendChild(tipEl);
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); onClick(); });
    return btn;
  }

  var SVG_FILTER = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';
  var SVG_NEW    = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

  function _attach(el) {
    if (_tracked.has(el)) return;
    // Skip tiny / invisible elements (tool widgets, etc.)
    var r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 20) return;

    _ensureStyle();

    var conversationUrl = location.href;

    var pair = document.createElement('div');
    pair.className = '__biaif_pair__ is-hidden';

    var tipFilter = 'PromptDrop – Filtrer cette conversation';
    var tipNew    = 'PromptDrop – Nouveau segment lié à cette conversation';

    var btnFilter = _makeBtn('filter', SVG_FILTER, tipFilter, function () {
      _send({
        type:            _msgType('OPEN_WITH_FILTER'),
        conversationUrl: location.href,
        repoId:          _extractGithubRepo(location.href),
        filterUrl:       null,
      });
    });
    var btnNew = _makeBtn('new', SVG_NEW, tipNew, function () {
      _send({
        type:            _msgType('START_LINKED_SEGMENT'),
        conversationUrl: location.href,
        repoId:          _extractGithubRepo(location.href),
      });
    });

    pair.appendChild(btnFilter);
    pair.appendChild(btnNew);
    document.body.appendChild(pair);

    var ro = new ResizeObserver(function () { _scheduleUpdate(); });
    ro.observe(el);

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) pair.classList.add('is-hidden');
        else _reposition(el, pair);
      });
    }, { threshold: 0 });
    io.observe(el);

    _tracked.set(el, { pair: pair, ro: ro, io: io });
    _reposition(el, pair);
  }

  function _detach(el) {
    var entry = _tracked.get(el);
    if (!entry) return;
    entry.ro.disconnect();
    entry.io.disconnect();
    if (entry.pair.parentNode) entry.pair.parentNode.removeChild(entry.pair);
    _tracked.delete(el);
  }

  /* ── GitHub repo detection ──────────────────────────────────────────────── */

  function _extractGithubRepo(url) {
    try {
      var u = new URL(url);
      if (u.hostname === 'github.com') {
        var parts = u.pathname.split('/').filter(Boolean);
        var skip  = ['orgs','settings','marketplace','explore','trending','notifications','search','login','logout'];
        if (parts.length >= 2 && !skip.includes(parts[0])) return parts[0] + '/' + parts[1];
      }
    } catch (_) {}
    return null;
  }

  /* ── message helper ─────────────────────────────────────────────────────── */

  function _msgType(key) {
    return (window.BIAIF && window.BIAIF.MSG && window.BIAIF.MSG[key])
      ? window.BIAIF.MSG[key]
      : 'biaif:' + key.toLowerCase().replace(/_/g, '-');
  }

  function _send(msg) {
    try { chrome.runtime.sendMessage(msg).catch(function () {}); } catch (_) {}
  }

  /* ── selector ───────────────────────────────────────────────────────────── */

  var SELECTOR = 'textarea, [contenteditable="true"], [contenteditable=""]';

  function _scanAll() {
    document.querySelectorAll(SELECTOR).forEach(function (el) {
      _attach(el);
    });
  }

  /* ── scroll / resize ────────────────────────────────────────────────────── */

  window.addEventListener('scroll',     function () { _scheduleUpdate(); }, { passive: true, capture: true });
  window.addEventListener('resize',     function () { _scheduleUpdate(); }, { passive: true });

  /* ── MutationObserver ───────────────────────────────────────────────────── */

  var _mo = new MutationObserver(function (mutations) {
    var needScan = false;
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (n) {
        if (n.nodeType !== 1) return;
        if (n.matches && n.matches(SELECTOR)) { _attach(n); return; }
        if (n.querySelector) {
          n.querySelectorAll(SELECTOR).forEach(function (el) { _attach(el); });
        }
        needScan = true;
      });
      m.removedNodes.forEach(function (n) {
        if (n.nodeType !== 1) return;
        if (_tracked.has(n)) _detach(n);
        if (n.querySelectorAll) {
          n.querySelectorAll(SELECTOR).forEach(function (el) { if (_tracked.has(el)) _detach(el); });
        }
      });
    });
    if (needScan) _scheduleUpdate();
  });

  _mo.observe(document.documentElement, { childList: true, subtree: true });

  /* ── initial scan ───────────────────────────────────────────────────────── */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _scanAll);
  } else {
    _scanAll();
  }

})();
