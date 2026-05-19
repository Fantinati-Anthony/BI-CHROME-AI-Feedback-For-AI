/**
 * BIAIF DB-Secret Crypto
 *
 * Wraps WebCrypto to encrypt/decrypt the bridge HMAC secret stored in
 * chrome.storage.local. The AES-GCM 256-bit key is generated once and
 * stored in IndexedDB with `extractable: false` so no script in the
 * extension (including a future bug or injected code) can `exportKey()`
 * the material — only the crypto engine can use it.
 *
 * Threat model defended:
 *   - exfiltration of `chrome.storage.local` alone: useless (ciphertext only)
 *   - script-side key extraction: blocked by extractable=false
 *   - migrations between extension versions: the key persists in its own
 *     IndexedDB database, untouched by other modules
 *
 * Not defended (impossible without hardware-backed keys):
 *   - full Chrome profile directory exfiltration → IndexedDB contains the
 *     key material on disk. Trade-off accepted; we still raise the bar.
 *
 * Public API:
 *   await BIAIFDbSecretCrypto.encrypt(plaintext)  → { iv, ct } (base64)
 *   await BIAIFDbSecretCrypto.decrypt(envelope)   → plaintext
 *   await BIAIFDbSecretCrypto.ready()             → true once key is loaded
 */
(function (window) {
  'use strict';

  var DB_NAME    = 'biaif-secret-crypto';
  var STORE_NAME = 'keys';
  var KEY_ID     = 'master';
  var DB_VERSION = 1;
  var _dbPromise = null;
  var _keyPromise = null;

  function _openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
    });
    return _dbPromise;
  }

  function _getStoredKey() {
    return _openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var req = tx.objectStore(STORE_NAME).get(KEY_ID);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror   = function () { reject(req.error); };
      });
    });
  }

  function _putStoredKey(cryptoKey) {
    return _openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var req = tx.objectStore(STORE_NAME).put(cryptoKey, KEY_ID);
        req.onsuccess = function () { resolve(cryptoKey); };
        req.onerror   = function () { reject(req.error); };
      });
    });
  }

  /**
   * Returns the master CryptoKey, generating it on first call.
   * The key is non-extractable: a malicious script cannot exportKey() it.
   */
  function _key() {
    if (_keyPromise) return _keyPromise;
    _keyPromise = _getStoredKey().then(function (existing) {
      if (existing) return existing;
      return crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,                          // extractable: false — never leaves crypto engine
        ['encrypt', 'decrypt']
      ).then(_putStoredKey);
    });
    return _keyPromise;
  }

  // ── base64 helpers (URL-safe not needed — ciphertext is binary) ──────
  function _b64(bytes) {
    var s = '';
    var b = new Uint8Array(bytes);
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function _unb64(s) {
    var bin = atob(s);
    var a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  async function encrypt(plaintext) {
    if (typeof plaintext !== 'string') throw new Error('plaintext must be a string');
    if (plaintext.length === 0) return { iv: '', ct: '' };
    var key = await _key();
    var iv  = crypto.getRandomValues(new Uint8Array(12));
    var ct  = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      new TextEncoder().encode(plaintext)
    );
    return { iv: _b64(iv), ct: _b64(ct) };
  }

  async function decrypt(envelope) {
    if (!envelope || !envelope.iv || !envelope.ct) return '';
    var key = await _key();
    var iv  = _unb64(envelope.iv);
    var pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, _unb64(envelope.ct));
    return new TextDecoder().decode(pt);
  }

  /** Returns true once the master key is ready (creates on first call). */
  async function ready() {
    await _key();
    return true;
  }

  /** Returns true if the envelope looks like a valid {iv, ct} pair. */
  function isEnvelope(v) {
    return !!(v && typeof v === 'object' && typeof v.iv === 'string' &&
              typeof v.ct === 'string' && v.iv && v.ct);
  }

  window.BIAIFDbSecretCrypto = {
    encrypt:     encrypt,
    decrypt:     decrypt,
    ready:       ready,
    isEnvelope:  isEnvelope,
  };
})(window);
