/**
 * My-Feedbacks Network Monitor (MAIN world)
 *
 * Wraps window.fetch and XMLHttpRequest.send to keep a rolling buffer
 * of recent network FAILURES (HTTP >= 400 OR network error). The
 * bridge (error-bridge.js style) is used to forward them to the side
 * panel so they get attached to a feedback at submit time.
 *
 * Captured per entry:
 *   { ts, method, url, status, durationMs?, error? }
 *
 * NOT captured:
 *   - Request body
 *   - Response body
 *   - Request / response headers
 *   - Cookies
 *   - Authorization headers
 *
 * Successful responses are NOT captured — only failures, to keep noise
 * low (Chrome's perf logs cover the rest if needed).
 *
 * MUST run in MAIN world (like page-error-monitor.js) so it sees the
 * page's actual fetch / XHR, not the extension's isolated ones.
 */

(function () {
  'use strict';

  if (window.__MYFB_NETWORK_MONITOR__) return;
  window.__MYFB_NETWORK_MONITOR__ = true;

  var MAX = 20;
  var _ring = [];

  function _push(entry) {
    entry.ts = Date.now();
    _ring.push(entry);
    if (_ring.length > MAX) _ring.shift();
    try {
      window.dispatchEvent(new CustomEvent('__myfb_network_failure__', { detail: entry }));
    } catch (_) {}
  }

  // ── fetch() wrap ────────────────────────────────────────────────────
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function () {
      var args   = arguments;
      var url    = (typeof args[0] === 'string') ? args[0] : (args[0] && args[0].url) || '';
      var method = (args[1] && args[1].method) || 'GET';
      var t0     = performance.now ? performance.now() : Date.now();
      var p;
      try {
        p = origFetch.apply(this, args);
      } catch (e) {
        _push({ method: method, url: url, status: 0, error: String(e && e.message || e) });
        throw e;
      }
      return p.then(function (res) {
        if (res && res.status >= 400) {
          _push({
            method:     method,
            url:        url,
            status:     res.status,
            durationMs: Math.round((performance.now ? performance.now() : Date.now()) - t0),
          });
        }
        return res;
      }, function (err) {
        _push({
          method:     method,
          url:        url,
          status:     0,
          error:      String(err && err.message || err).slice(0, 200),
          durationMs: Math.round((performance.now ? performance.now() : Date.now()) - t0),
        });
        throw err;
      });
    };
  }

  // ── XMLHttpRequest wrap ─────────────────────────────────────────────
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__myfb_method = method;
    this.__myfb_url    = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    var t0  = performance.now ? performance.now() : Date.now();
    function _maybeCapture() {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 400 || xhr.status === 0) {
        _push({
          method:     xhr.__myfb_method || 'GET',
          url:        xhr.__myfb_url || '',
          status:     xhr.status || 0,
          durationMs: Math.round((performance.now ? performance.now() : Date.now()) - t0),
        });
      }
    }
    xhr.addEventListener('readystatechange', _maybeCapture);
    return origSend.apply(this, arguments);
  };

  // Test-friendly export
  window.__MYFB_NETWORK__ = {
    list:  function () { return _ring.slice(); },
    clear: function () { _ring = []; },
    _max:  MAX,
  };
})();
