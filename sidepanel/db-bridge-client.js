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

  // Minimum bridge protocol version this client speaks. Bumped when
  // the client requires a new response field. Bridges older than this
  // produce a clear "upgrade myfb-bridge.php" error rather than a
  // mysterious schema mismatch downstream.
  var MIN_BRIDGE_VERSION = '1.1.0';

  // Compares two semver-ish strings. Returns -1 / 0 / 1.
  function _cmpVer(a, b) {
    var pa = String(a || '0').split('.').map(function (x) { return parseInt(x, 10) || 0; });
    var pb = String(b || '0').split('.').map(function (x) { return parseInt(x, 10) || 0; });
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var va = pa[i] || 0, vb = pb[i] || 0;
      if (va < vb) return -1;
      if (va > vb) return  1;
    }
    return 0;
  }

  // Maps HTTP status + raw error string to a user-actionable message.
  // Keep messages short — they end up in toasts and the form status row.
  function _humanizeError(httpStatus, raw) {
    raw = String(raw || '').toLowerCase();
    if (httpStatus === 0)   return 'Bridge inaccessible (réseau / DNS / CORS)';
    if (httpStatus === 404) return 'Endpoint introuvable — vérifie l\'URL du bridge';
    if (httpStatus === 401) {
      if (raw.indexOf('replay') >= 0) return 'Nonce déjà utilisé — horloge décalée ?';
      if (raw.indexOf('stale')  >= 0) return 'Horloge client/serveur décalée (> 60s)';
      if (raw.indexOf('nonce')  >= 0) return 'Nonce invalide';
      return 'Signature HMAC invalide — secret incorrect ?';
    }
    if (httpStatus === 403) return 'Table non exposée par la config du bridge';
    if (httpStatus === 405) return 'Méthode HTTP refusée — bridge mal configuré';
    if (httpStatus >= 500)  return 'Erreur interne du bridge — vérifie audit.log';
    return raw || ('Erreur HTTP ' + httpStatus);
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

    // SW-level failure (CORS, DNS, etc.) — body is null
    if (!resp || resp.error) {
      throw new Error(_humanizeError(0, resp && resp.error));
    }
    // HTTP error or malformed JSON
    if (!resp.body || typeof resp.body !== 'object') {
      throw new Error(_humanizeError(resp.status || 0, resp.raw || 'malformed response'));
    }
    // Application-level error (bridge returned ok:false)
    if (resp.body.ok !== true) {
      throw new Error(_humanizeError(resp.status || 0, resp.body.error || 'bridge error'));
    }

    // Version check — protect downstream against missing fields a newer
    // op might require. Allows the bridge to be NEWER than the client
    // (forward-compat) but not OLDER than MIN_BRIDGE_VERSION.
    var bv = resp.body.version;
    if (bv && _cmpVer(bv, MIN_BRIDGE_VERSION) < 0) {
      throw new Error('Bridge trop ancien (' + bv + ' < ' + MIN_BRIDGE_VERSION +
                      ') — mets à jour myfb-bridge.php');
    }

    return resp.body.data;
  }

  /** Convenience: fetch the full schema as Markdown. */
  async function fetchSchemaMd(profile) {
    var data = await call(profile, 'schema_md');
    return data && data.markdown || '';
  }

  window.MyFbDbBridge = {
    call:               call,
    fetchSchemaMd:      fetchSchemaMd,
    signRequest:        signRequest,
    MIN_BRIDGE_VERSION: MIN_BRIDGE_VERSION,
    _canonArgs:         _canonArgs,
    _cmpVer:            _cmpVer,
    _humanizeError:     _humanizeError,
  };
})(window);
