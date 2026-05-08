/**
 * BIAIF AI Watcher
 *
 * Runs on all AI online pages. Polls every 600ms for the "stop generating"
 * button using selectors from BIAIF.AI_ADAPTERS.
 *
 * State machine per page:
 *   idle → generating (stop btn appears) → idle (stop btn disappears → fire AI_RESPONSE_DONE)
 *
 * Sends to background SW (forwarded to sidepanel):
 *   AI_STATUS_UPDATE  { conversationUrl, status: 'generating' | 'idle' }
 *   AI_RESPONSE_DONE  { conversationUrl }
 */
(function () {
  'use strict';

  if (window.__BIAIF_AI_WATCHER__) return;
  window.__BIAIF_AI_WATCHER__ = true;

  var MSG = (window.BIAIF && window.BIAIF.MSG) || {};
  var ADAPTERS = (window.BIAIF && window.BIAIF.AI_ADAPTERS) || [];

  // ── Find the adapter for the current host ────────────────────────────────

  function _adapter() {
    var h = location.hostname;
    for (var i = 0; i < ADAPTERS.length; i++) {
      var a = ADAPTERS[i];
      if (h === a.host || h.endsWith('.' + a.host)) return a;
    }
    return null;
  }

  var _ad = _adapter();
  if (!_ad) return; // not an AI page we know about

  // ── Stop-button probe ────────────────────────────────────────────────────

  function _hasStopBtn() {
    var sels = _ad.stopBtn || [];
    for (var i = 0; i < sels.length; i++) {
      try {
        var el = document.querySelector(sels[i]);
        if (el) return true;
      } catch (_) {}
    }
    return false;
  }

  // ── Message sender ───────────────────────────────────────────────────────

  function _send(type, extra) {
    var payload = Object.assign({ type: type, conversationUrl: location.href }, extra || {});
    try { chrome.runtime.sendMessage(payload).catch(function () {}); } catch (_) {}
  }

  // ── Polling state machine ────────────────────────────────────────────────

  var _wasGenerating = false;
  var _pollMs = 700;

  function _tick() {
    var now = _hasStopBtn();
    if (now && !_wasGenerating) {
      _wasGenerating = true;
      _send(MSG.AI_STATUS_UPDATE || 'biaif:ai-status-update', { status: 'generating' });
    } else if (!now && _wasGenerating) {
      _wasGenerating = false;
      _send(MSG.AI_RESPONSE_DONE || 'biaif:ai-response-done');
    }
  }

  // Start polling once the page is interactive
  function _start() {
    setInterval(_tick, _pollMs);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _start);
  } else {
    _start();
  }

})();
