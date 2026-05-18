/**
 * My-Feedbacks Ref Overlay (content script — isolated world)
 *
 * Renders persistent visual markers on the host page for each ref the
 * user has captured (element picker, screenshot region). Each overlay
 * shows the bounding rect + a small badge with the demande number(s)
 * the ref belongs to. Clicking the badge focuses that demande in the
 * side panel.
 *
 * Design choices:
 *   - Single Shadow DOM root anchored at <html> with z-index max,
 *     pointer-events: none — never intercepts page clicks except on
 *     the badges themselves.
 *   - Reposition on scroll, resize, and (lightly) on DOM mutation, so
 *     overlays track the page even as the user interacts with it.
 *   - For element refs we re-resolve `ref.selector` each frame; if the
 *     element vanished we fall back to the captured `box` with a
 *     "stale" style so the user knows it moved.
 *   - For screenshot refs we use the captured rect verbatim (the
 *     overlay is a SNAPSHOT marker, by design).
 *
 * The sidepanel pushes a fresh ref list whenever overlays should be
 * visible. The content script never pulls — that keeps the data flow
 * one-way and easy to debug.
 */

(function () {
  'use strict';

  if (window.__MYFB_REF_OVERLAY__) return;
  window.__MYFB_REF_OVERLAY__ = true;

  var MSG = (window.MyFb && window.MyFb.MSG) || {
    OVERLAYS_RENDER:    'myfb:overlays-render',
    OVERLAYS_CLEAR:     'myfb:overlays-clear',
    OVERLAYS_FOCUS_REF: 'myfb:overlays-focus-ref',
  };

  var ACCENT          = '#2bd4d9';
  var ACCENT_STALE    = '#94a3b8';
  var BADGE_BG        = '#0f172a';
  var BADGE_FG        = '#f1f5f9';

  var _hostEl  = null;
  var _shadow  = null;
  var _container = null;
  var _refs    = [];   // [{ ref, demandeIndex, demandeId }]
  var _rafId   = null;
  var _scrollDebounce = null;

  // ── Setup / teardown ────────────────────────────────────────────────

  function _ensureMount() {
    if (_hostEl && document.body && document.body.contains(_hostEl)) return;
    _hostEl = document.createElement('div');
    _hostEl.id = 'myfb-ref-overlay-host';
    _hostEl.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;' +
      'z-index:2147483646;';
    _shadow = _hostEl.attachShadow({ mode: 'closed' });
    _container = document.createElement('div');
    _container.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;';
    _shadow.appendChild(_container);

    var style = document.createElement('style');
    style.textContent = _styles();
    _shadow.appendChild(style);

    (document.documentElement || document.body).appendChild(_hostEl);
  }

  function _styles() {
    return [
      '*{box-sizing:border-box;font-family:Inter,system-ui,sans-serif}',
      '.overlay{position:absolute;border:2px solid ' + ACCENT + ';' +
        'background:rgba(43,212,217,0.06);border-radius:3px;' +
        'transition:opacity 180ms ease,border-color 180ms ease}',
      '.overlay.screenshot{border-style:dashed}',
      '.overlay.stale{border-color:' + ACCENT_STALE + ';opacity:0.45}',
      '.badge{position:absolute;top:-12px;right:-12px;min-width:22px;height:22px;' +
        'padding:0 6px;border-radius:11px;background:' + BADGE_BG + ';' +
        'color:' + BADGE_FG + ';border:2px solid ' + ACCENT + ';' +
        'font-size:11px;font-weight:700;line-height:18px;text-align:center;' +
        'cursor:pointer;pointer-events:auto;user-select:none;' +
        'box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:transform 140ms ease}',
      '.overlay.screenshot .badge{border-color:' + ACCENT + ';border-style:dashed}',
      '.overlay.stale .badge{border-color:' + ACCENT_STALE + '}',
      '.badge:hover{transform:scale(1.15)}',
      '.badge-stale-icon{margin-left:3px;color:#fbbf24}',
    ].join('');
  }

  function _teardown() {
    if (_hostEl && _hostEl.parentNode) _hostEl.parentNode.removeChild(_hostEl);
    _hostEl = null;
    _shadow = null;
    _container = null;
    _refs = [];
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  }

  // ── Public-ish API (called from messages) ───────────────────────────

  function render(refsForUrl) {
    if (!Array.isArray(refsForUrl) || refsForUrl.length === 0) {
      return _teardown();
    }
    _ensureMount();
    _refs = refsForUrl.filter(_isRenderable);
    _draw();
    _attachReposListeners();
  }

  function clear() {
    _teardown();
  }

  function _isRenderable(entry) {
    if (!entry || !entry.ref) return false;
    var r = entry.ref;
    if (r.type === 'element') {
      return !!r.selector || !!r.box;
    }
    if (r.type === 'screenshot') {
      return !!r.box;
    }
    return false;
  }

  // ── Draw + reposition ───────────────────────────────────────────────

  function _draw() {
    if (!_container) return;
    _container.innerHTML = '';

    // Group entries by spatial bucket so multiple refs at the same place
    // can share a single overlay with a combined badge.
    var buckets = {};
    _refs.forEach(function (entry) {
      var rect = _resolveRect(entry.ref);
      if (!rect) return;
      var key = entry.ref.type + ':' + Math.round(rect.x) + ',' + Math.round(rect.y) +
                ',' + Math.round(rect.w) + ',' + Math.round(rect.h);
      if (!buckets[key]) buckets[key] = { rect: rect, type: entry.ref.type, entries: [], stale: rect._stale };
      buckets[key].entries.push(entry);
    });

    Object.keys(buckets).forEach(function (k) {
      var b = buckets[k];
      var ov = document.createElement('div');
      ov.className = 'overlay ' + b.type + (b.stale ? ' stale' : '');
      ov.style.left   = b.rect.x + 'px';
      ov.style.top    = b.rect.y + 'px';
      ov.style.width  = b.rect.w + 'px';
      ov.style.height = b.rect.h + 'px';

      var demNums = b.entries.map(function (e) { return e.demandeIndex; })
        .filter(function (v, i, a) { return a.indexOf(v) === i; })
        .sort(function (a, c) { return a - c; });

      var badge = document.createElement('div');
      badge.className = 'badge';
      var label = demNums.length === 1 ? String(demNums[0]) :
                  demNums.length === 2 ? demNums.join('+') :
                  demNums[0] + '+' + (demNums.length - 1);
      badge.textContent = label;
      if (b.stale) badge.innerHTML = label + '<span class="badge-stale-icon" title="Élément déplacé/disparu">⚠</span>';
      badge.title = _badgeTitle(b.entries);
      badge.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        _focusRef(b.entries[0]);
      });

      ov.appendChild(badge);
      _container.appendChild(ov);
    });
  }

  function _badgeTitle(entries) {
    var first = entries[0];
    var dNum = entries.map(function (e) { return '#' + e.demandeIndex; }).join(', ');
    var snippet = first && first.demandeText ? first.demandeText.slice(0, 80) : '';
    return 'Demande(s) ' + dNum + (snippet ? ' — ' + snippet : '');
  }

  function _resolveRect(ref) {
    if (ref.type === 'element') {
      // Try to re-resolve the selector — element may have moved/changed.
      try {
        var el = ref.selector ? document.querySelector(ref.selector) : null;
        if (el) {
          var r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            return { x: r.left, y: r.top, w: r.width, h: r.height };
          }
        }
      } catch (_) {
        // Invalid selector — fall through to stored box.
      }
      // Fallback: stored box, but viewport-relative (substract scroll).
      if (ref.box) {
        return {
          x: ref.box.x - (window.scrollX || 0),
          y: ref.box.y - (window.scrollY || 0),
          w: ref.box.w, h: ref.box.h,
          _stale: true,
        };
      }
      return null;
    }
    if (ref.type === 'screenshot' && ref.box) {
      var b = ref.box;
      // Screenshot box is usually viewport-relative at capture time but
      // the page may have scrolled since — best-effort, treat as page-
      // absolute coordinates (so scroll moves the overlay with content).
      return {
        x: (b.x || 0) - (window.scrollX || 0),
        y: (b.y || 0) - (window.scrollY || 0),
        w: b.w || b.width || 0,
        h: b.h || b.height || 0,
      };
    }
    return null;
  }

  function _attachReposListeners() {
    if (_attachReposListeners._done) return;
    _attachReposListeners._done = true;
    window.addEventListener('scroll', _scheduleRedraw, true);
    window.addEventListener('resize', _scheduleRedraw, true);
    // SPA navigation: re-draw on URL change too. cheap polling.
    var lastUrl = location.href;
    setInterval(function () {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        _teardown();
        // Request fresh refs for the new URL
        try {
          chrome.runtime.sendMessage({ type: 'myfb:overlays-need-refresh', url: lastUrl }).catch(function () {});
        } catch (_) {}
      }
    }, 800);
  }

  function _scheduleRedraw() {
    if (_scrollDebounce) cancelAnimationFrame(_scrollDebounce);
    _scrollDebounce = requestAnimationFrame(function () {
      _scrollDebounce = null;
      _draw();
    });
  }

  function _focusRef(entry) {
    try {
      chrome.runtime.sendMessage({
        type: MSG.OVERLAYS_FOCUS_REF,
        demandeId: entry.demandeId,
        demandeIndex: entry.demandeIndex,
      }).catch(function () {});
    } catch (_) {}
  }

  // ── Wire chrome.runtime messages ────────────────────────────────────

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    if (sender.id && sender.id !== chrome.runtime.id) return;
    if (msg.type === MSG.OVERLAYS_RENDER) {
      render(msg.refs || []);
      sendResponse({ ok: true, drawn: _refs.length });
      return false;
    }
    if (msg.type === MSG.OVERLAYS_CLEAR) {
      clear();
      sendResponse({ ok: true });
      return false;
    }
  });

  // Best-effort: expose for tests + integration
  window.MyFbRefOverlay = {
    render: render,
    clear:  clear,
    _refs:  function () { return _refs.slice(); },
  };
})();
