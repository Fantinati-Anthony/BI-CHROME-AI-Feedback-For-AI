/**
 * MyFb DB Bridge Client
 *
 * Client-side companion to bridge/myfb-bridge.php. Handles HMAC-SHA256
 * request signing and routes the fetch through the background service
 * worker (the sidepanel page CSP forbids arbitrary connect-src).
 *
 * Public API:
 *   MyFbDbBridge.call(profile, op, args) → Promise<data>
 *   MyFbDbBridge.signRequest(secret, ts, nonce, op, args) → Promise<sigHex>
 *
 * All signing happens via SubtleCrypto. Secrets never leave the
 * sidepanel — only the signature is sent over the wire.
 */
(function (window) {
  'use strict';

  function _utf8(s) { return new TextEncoder().encode(s); }

  function _hex(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
    return s;
  }

  function _randomNonce() {
    var a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return _hex(a.buffer);
  }

  /** Canonical args JSON — must match the PHP json_encode(args). */
  function _canonArgs(args) {
    if (!args || (typeof args === 'object' && Object.keys(args).length === 0)) return '[]';
    return JSON.stringify(args);
  }

  async function signRequest(secret, ts, nonce, op, args) {
    var key = await crypto.subtle.importKey(
      'raw', _utf8(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    var msg = ts + '.' + nonce + '.' + op + '.' + _canonArgs(args);
    var sig = await crypto.subtle.sign('HMAC', key, _utf8(msg));
    return _hex(sig);
  }

  /**
   * Calls the bridge endpoint via the background service worker
   * (sidepanel CSP forbids direct fetch to arbitrary hosts).
   *
   * @param {object} profile  { bridgeUrl, bridgeSecret }
   * @param {string} op       operation name
   * @param {object} [args]   operation arguments
   * @returns {Promise<object>} resolved data on success, throws on error
   */
  async function call(profile, op, args) {
    if (!profile || !profile.bridgeUrl || !profile.bridgeSecret) {
      throw new Error('Bridge non configuré (URL et secret requis)');
    }
    var ts    = Math.floor(Date.now() / 1000);
    var nonce = _randomNonce();
    var body  = { op: op, args: args || {}, ts: ts, nonce: nonce };
    body.sig = await signRequest(profile.bridgeSecret, ts, nonce, op, body.args);

    var MSG = (window.MyFb && window.MyFb.MSG && window.MyFb.MSG.DB_BRIDGE_CALL) || 'myfb:db-bridge-call';
    var resp = await new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: MSG, url: profile.bridgeUrl, body: body }, function (r) {
        resolve(r || { error: 'no response' });
      });
    });
    if (!resp || resp.error) throw new Error(resp && resp.error || 'fetch failed');
    if (!resp.body || resp.body.ok !== true) {
      throw new Error((resp.body && resp.body.error) || 'bridge returned an error');
    }
    return resp.body.data;
  }

  /** Convenience: fetch the full schema as Markdown. */
  async function fetchSchemaMd(profile) {
    var data = await call(profile, 'schema_md');
    return data && data.markdown || '';
  }

  window.MyFbDbBridge = {
    call:          call,
    fetchSchemaMd: fetchSchemaMd,
    signRequest:   signRequest,
    _canonArgs:    _canonArgs,
  };
})(window);
