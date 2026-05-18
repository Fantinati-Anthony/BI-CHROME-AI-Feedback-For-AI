// @ts-check
/**
 * My-Feedbacks E2E Crypto — keypair management (v2.0)
 *
 * Each install generates an ECDH P-256 keypair on first use. The
 * public key is published in the event log via a `device.connected`
 * (or `device.meta_updated`) event so peers can encrypt events
 * destined for us. The private key never leaves this install.
 *
 * Storage : IndexedDB store `meta` under key `crypto.privateJwk`.
 *   (chrome.storage.sync would propagate the key across the user's
 *    own Chromes which is fine BUT it has a 8 KB per-item limit; a
 *    JWK is ~250 bytes so it'd fit, but IndexedDB is safer.)
 *
 * Notes :
 *   - Uses Web Crypto SubtleCrypto. Available in all Chrome MV3
 *     contexts (side panel, content scripts, service worker).
 *   - Algorithm : ECDH P-256 for key agreement, AES-GCM-256 for
 *     payload symmetric encryption (deriveKey).
 *   - Encryption is OPT-IN — controlled by a Settings toggle. Default
 *     OFF in v2.0 to avoid breaking existing test setups. When OFF,
 *     events go through unchanged.
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};
  root.MyFb.core.crypto = root.MyFb.core.crypto || {};

  var META_PRIVATE = 'crypto.privateJwk';
  var META_PUBLIC  = 'crypto.publicJwk';

  function _subtle() {
    if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle;
    return null;
  }

  /**
   * Generate a fresh ECDH P-256 keypair. Returns { publicJwk, privateJwk }.
   * @returns {Promise<{ publicJwk: any, privateJwk: any }>}
   */
  function generate() {
    var subtle = _subtle();
    if (!subtle) return Promise.reject(new Error('SubtleCrypto unavailable'));
    return subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,  // extractable
      ['deriveKey', 'deriveBits']
    ).then(function (pair) {
      return Promise.all([
        subtle.exportKey('jwk', pair.publicKey),
        subtle.exportKey('jwk', pair.privateKey),
      ]).then(function (out) {
        return { publicJwk: out[0], privateJwk: out[1] };
      });
    });
  }

  /**
   * Load (or create on first call) the local keypair, persist in the
   * runtime's meta store. Returns { publicJwk, privateJwk }.
   *
   * @param {{ metaGet: (k:string) => Promise<any>, metaSet: (k:string, v:any) => Promise<void> }} store
   * @returns {Promise<{ publicJwk: any, privateJwk: any }>}
   */
  function loadOrCreate(store) {
    if (!store || !store.metaGet || !store.metaSet) {
      return Promise.reject(new Error('loadOrCreate requires a store with metaGet/metaSet'));
    }
    return Promise.all([store.metaGet(META_PRIVATE), store.metaGet(META_PUBLIC)]).then(function (out) {
      var priv = out[0];
      var pub  = out[1];
      if (priv && pub) return { publicJwk: pub, privateJwk: priv };
      return generate().then(function (fresh) {
        return Promise.all([
          store.metaSet(META_PRIVATE, fresh.privateJwk),
          store.metaSet(META_PUBLIC,  fresh.publicJwk),
        ]).then(function () { return fresh; });
      });
    });
  }

  /**
   * Derive a shared AES-GCM-256 key with a peer's public JWK.
   * @param {any} privateJwk
   * @param {any} peerPublicJwk
   * @returns {Promise<CryptoKey>}
   */
  function deriveSharedKey(privateJwk, peerPublicJwk) {
    var subtle = _subtle();
    if (!subtle) return Promise.reject(new Error('SubtleCrypto unavailable'));
    return Promise.all([
      subtle.importKey('jwk', privateJwk,    { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']),
      subtle.importKey('jwk', peerPublicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []),
    ]).then(function (keys) {
      return subtle.deriveKey(
        { name: 'ECDH', public: keys[1] },
        keys[0],
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    });
  }

  /**
   * Encrypt a JS object as a string using a derived AES-GCM-256 key.
   * Returns a base64 envelope "iv:ct" (iv is 12 bytes, ciphertext
   * including auth tag).
   * @param {CryptoKey} key
   * @param {any} payload
   * @returns {Promise<string>}
   */
  function encrypt(key, payload) {
    var subtle = _subtle();
    if (!subtle) return Promise.reject(new Error('SubtleCrypto unavailable'));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var plain = new TextEncoder().encode(JSON.stringify(payload));
    return subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plain).then(function (ctBuf) {
      var ct = new Uint8Array(ctBuf);
      return _b64(iv) + ':' + _b64(ct);
    });
  }

  /**
   * Decrypt an "iv:ct" envelope back to the original JS object.
   * @param {CryptoKey} key
   * @param {string} envelope
   * @returns {Promise<any>}
   */
  function decrypt(key, envelope) {
    var subtle = _subtle();
    if (!subtle) return Promise.reject(new Error('SubtleCrypto unavailable'));
    var parts = String(envelope || '').split(':');
    if (parts.length !== 2) return Promise.reject(new Error('Bad envelope format'));
    var iv = _b64dec(parts[0]);
    var ct = _b64dec(parts[1]);
    return subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct).then(function (plainBuf) {
      var txt = new TextDecoder().decode(plainBuf);
      return JSON.parse(txt);
    });
  }

  function _b64(u8) {
    var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }
  function _b64dec(s) {
    var bin = atob(s);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  root.MyFb.core.crypto.keypair = {
    META_PRIVATE:    META_PRIVATE,
    META_PUBLIC:     META_PUBLIC,
    generate:        generate,
    loadOrCreate:    loadOrCreate,
    deriveSharedKey: deriveSharedKey,
    encrypt:         encrypt,
    decrypt:         decrypt,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MyFb.core.crypto.keypair;
  }
})(typeof window !== 'undefined' ? window : globalThis);
