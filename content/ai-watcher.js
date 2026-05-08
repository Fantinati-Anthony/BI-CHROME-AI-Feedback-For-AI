/**
 * BIAIF AI Watcher v2
 *
 * Three redundant detection strategies — first to fire enters "generating";
 * all three must be silent for DONE_DELAY_MS before "done" is declared.
 *
 *  1. generatingEl  – adapter-specific element present only during generation
 *                     (e.g. Claude.ai reflection timer div.tabular-nums)
 *  2. stopBtn       – adapter-specific CSS selectors for the stop button
 *  3. streamingText – MutationObserver burst: ≥4 text-node additions outside
 *                     input areas within 800 ms → streaming detected
 *
 * State machine per page:  idle → generating → idle
 *
 * Messages forwarded by SW to sidepanel:
 *   AI_STATUS_UPDATE  { conversationUrl, status: 'generating' }
 *   AI_RESPONSE_DONE  { conversationUrl }
 */
(function () {
  'use strict';

  if (window.__BIAIF_AI_WATCHER__) return;
  window.__BIAIF_AI_WATCHER__ = true;

  var MSG      = (window.BIAIF && window.BIAIF.MSG) || {};
  var ADAPTERS = (window.BIAIF && window.BIAIF.AI_ADAPTERS) || [];

  // ── Adapter ─────────────────────────────────────────────────────────────────

  function _adapter() {
    var h = location.hostname;
    for (var i = 0; i < ADAPTERS.length; i++) {
      var a = ADAPTERS[i];
      if (h === a.host || h.endsWith('.' + a.host)) return a;
    }
    return null;
  }

  var _ad = _adapter();
  if (!_ad) return;

  // ── Shared state + unified done-timer ───────────────────────────────────────

  var _wasGenerating = false;
  var _doneTimer     = null;
  var DONE_DELAY_MS  = 2500; // silence window before declaring done

  function _send(type, extra) {
    var payload = Object.assign({ type: type, conversationUrl: location.href }, extra || {});
    try { chrome.runtime.sendMessage(payload).catch(function () {}); } catch (_) {}
  }

  function _markGenerating() {
    clearTimeout(_doneTimer); // reset done countdown whenever activity detected
    _doneTimer = null;
    if (_wasGenerating) return;
    _wasGenerating = true;
    _send(MSG.AI_STATUS_UPDATE || 'biaif:ai-status-update', { status: 'generating' });
  }

  function _scheduleDone() {
    if (!_wasGenerating) return;
    if (_doneTimer) return; // already counting down
    _doneTimer = setTimeout(function () {
      _doneTimer = null;
      // Final confirmation: none of the active indicators are present
      if (!_isActive()) {
        _wasGenerating = false;
        _send(MSG.AI_RESPONSE_DONE || 'biaif:ai-response-done');
      }
      // else: something became active again — stay in generating state
    }, DONE_DELAY_MS);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function _isVisible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    // Elements hidden via opacity-0 / visibility:hidden stay in DOM but are not active
    try {
      var cs = window.getComputedStyle(el);
      if (parseFloat(cs.opacity) < 0.1) return false;
      if (cs.visibility === 'hidden')    return false;
      if (cs.display === 'none')         return false;
    } catch (_) {}
    return true;
  }

  function _queryAny(sels) {
    for (var i = 0; i < (sels || []).length; i++) {
      try {
        var el = document.querySelector(sels[i]);
        if (el && _isVisible(el)) return el;
      } catch (_) {}
    }
    return null;
  }

  // ── Strategy 1 : generatingEl ────────────────────────────────────────────────
  // An element that exists ONLY while the AI is active (e.g. reflection timer).

  function _hasGeneratingEl() {
    return !!_queryAny(_ad.generatingEl);
  }

  // ── Strategy 2 : stop-button CSS selectors ───────────────────────────────────

  function _hasStopBtn() {
    if (_queryAny(_ad.stopBtn)) return true;

    // Generic: a button whose only SVG child is a single <rect> (stop/square icon)
    try {
      var btns = document.querySelectorAll('button');
      for (var j = 0; j < btns.length; j++) {
        var btn = btns[j];
        if (!_isVisible(btn)) continue;
        var r = btn.getBoundingClientRect();
        if (r.width < 20 || r.width > 100) continue;
        var svgRects = btn.querySelectorAll('svg rect');
        var svgOther = btn.querySelectorAll('svg path, svg polyline, svg line, svg circle, svg polygon');
        if (svgRects.length >= 1 && svgOther.length === 0) return true;
      }
    } catch (_) {}
    return false;
  }

  // ── Combined active check ────────────────────────────────────────────────────

  function _isActive() {
    return _hasGeneratingEl() || _hasStopBtn();
  }

  // ── Tick (runs on poll + MutationObserver) ───────────────────────────────────

  function _tick() {
    if (_isActive()) {
      _markGenerating();
    } else if (_wasGenerating) {
      _scheduleDone();
    }
  }

  // Lifecycle handles — cleared on pagehide / bfcache to avoid leaks.
  var _tickInterval = setInterval(_tick, 700);
  var _attrObs = null;
  var _streamObs = null;

  // MutationObserver: near-instant re-check when DOM attributes/children change
  try {
    _attrObs = new MutationObserver(function (mutations) {
      var relevant = mutations.some(function (m) {
        return m.type === 'childList' ||
          (m.type === 'attributes' &&
            (m.attributeName === 'class' || m.attributeName === 'aria-label' ||
             m.attributeName === 'data-testid' || m.attributeName === 'hidden' ||
             m.attributeName === 'disabled'));
      });
      if (relevant) _tick();
    });
    _attrObs.observe(document.body, {
      childList: true, subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-label', 'data-testid', 'hidden', 'disabled'],
    });
  } catch (_) {}

  // ── Strategy 3 : streaming-text burst detection ──────────────────────────────
  // Detects rapid text-node additions outside input/contenteditable areas.
  // Entering generating state requires ≥4 mutations within 800ms (avoids
  // false-positives from single DOM updates).

  var _burstCount = 0;
  var _burstTimer = null;

  function _isInsideInput(node) {
    var el = (node.nodeType === Node.TEXT_NODE) ? node.parentElement : node;
    while (el && el !== document.body) {
      var tag = (el.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA' || tag === 'INPUT') return true;
      if (el.getAttribute && el.getAttribute('contenteditable') === 'true') return true;
      el = el.parentElement;
    }
    return false;
  }

  try {
    _streamObs = new MutationObserver(function (mutations) {
      var hasAiText = false;
      outer: for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'characterData') {
          if (m.target.textContent.trim() && !_isInsideInput(m.target)) { hasAiText = true; break; }
        } else if (m.type === 'childList') {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType === Node.TEXT_NODE && n.textContent.trim() && !_isInsideInput(n)) {
              hasAiText = true; break outer;
            }
          }
        }
      }
      if (!hasAiText) return;

      _burstCount++;
      clearTimeout(_burstTimer);
      _burstTimer = setTimeout(function () { _burstCount = 0; }, 800);

      if (_burstCount >= 4) {
        _markGenerating(); // burst confirmed — streaming in progress
      } else if (_wasGenerating) {
        // Even a single text change resets the done countdown
        clearTimeout(_doneTimer);
        _doneTimer = null;
      }
    });
    _streamObs.observe(document.body, {
      childList: true, subtree: true, characterData: true,
    });
  } catch (_) {}

  // Cleanup on page hide / bfcache eviction — avoids leaking observers + interval
  // across SPA navigations and tab close.
  function _teardown() {
    try { clearInterval(_tickInterval); } catch (_) {}
    try { clearTimeout(_doneTimer); } catch (_) {}
    try { clearTimeout(_burstTimer); } catch (_) {}
    try { if (_attrObs)   _attrObs.disconnect(); }   catch (_) {}
    try { if (_streamObs) _streamObs.disconnect(); } catch (_) {}
    _tickInterval = null; _doneTimer = null; _burstTimer = null;
    _attrObs = null; _streamObs = null;
  }
  window.addEventListener('pagehide', _teardown, { once: true });

})();
