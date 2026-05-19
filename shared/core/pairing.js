// @ts-check
/**
 * My-Feedbacks Pairing (v1.15)
 *
 * Lightweight pairing protocol for admin ↔ client when both sides use
 * tier 1 (solo) or tier 2 (shared folder) and have no central server
 * to negotiate a peer-id exchange.
 *
 * Flow :
 *   1. Admin generates a 6-char code (e.g. `MYFB-A3F2`) tied to their
 *      UUID + display name. Code is encoded as a base32-ish string
 *      with a checksum so manual typos can be caught client-side.
 *   2. Admin shares the code with the client (email / chat / whatever).
 *   3. Client opens "Lier un partenaire" → pastes the code → the
 *      extension decodes it, validates checksum, then emits a
 *      `link.requested` event referencing the admin's UUID. Admin's
 *      next sync pulls it and emits `link.accepted`.
 *
 * Why this works pre-v2.0 backend :
 *   - The link.requested / link.accepted events ride the same event
 *     stream as the demandes — so tier 2 shared folder transports
 *     them too. Pure P2P, no separate signaling.
 *
 * Code format :
 *   MYFB-XXXXXX where XXXXXX = 5 chars of base32 + 1 char checksum.
 *   Payload encoded : 80 bits of the admin UUID (10 bytes from the
 *   front) plus a small role/label hint. Truncated UUID is OK for the
 *   purpose of recognition — the client will use the full UUID once
 *   the admin's link.accepted event arrives via sync.
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};

  var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // Crockford-ish base32
  var PREFIX   = 'MYFB-';

  /**
   * Encode an integer 0..31 to a single base32 char.
   * @param {number} n
   * @returns {string}
   */
  function _b32(n) { return ALPHABET.charAt(n & 31); }

  /**
   * Decode a single base32 char to its 5-bit value, returns -1 if
   * invalid.
   * @param {string} ch
   * @returns {number}
   */
  function _unb32(ch) {
    var i = ALPHABET.indexOf((ch || '').toUpperCase());
    return i;
  }

  /**
   * Compute a single-char checksum over a payload (sum of char codes
   * mod 32) encoded as base32.
   * @param {string} payload
   * @returns {string}
   */
  function _checksum(payload) {
    var sum = 0;
    for (var i = 0; i < payload.length; i++) sum += payload.charCodeAt(i);
    return _b32(sum);
  }

  /**
   * Generate a 6-char pairing code from an admin profile. The code
   * encodes 5 chars derived from the UUID (deterministic hash) + a
   * checksum char. The full UUID is NOT in the code — it's transferred
   * via the event stream once the client emits link.requested with a
   * pending hint.
   *
   * @param {{ uuid: string, displayName?: string }} adminProfile
   * @returns {string} e.g. "MYFB-A3F2K7"
   */
  function generateCode(adminProfile) {
    if (!adminProfile || typeof adminProfile.uuid !== 'string') {
      throw new Error('[MyFb pairing] generateCode requires { uuid }');
    }
    var hash = _hashUuid(adminProfile.uuid);
    var payload = '';
    for (var i = 0; i < 5; i++) {
      payload += _b32((hash >>> (i * 5)) & 31);
    }
    return PREFIX + payload + _checksum(payload);
  }

  /**
   * Tiny 32-bit hash of a UUID string. Not cryptographic — just enough
   * to make collisions across two installs improbable in practice.
   * @param {string} s
   * @returns {number}
   */
  function _hashUuid(s) {
    var h = 0x811c9dc5; // FNV-1a 32-bit
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
    }
    return h >>> 0;
  }

  /**
   * Validate a user-input code, returning { ok, payload, fingerprint }
   * if it looks well-formed, or { ok: false, reason } otherwise.
   *
   * @param {string} input
   * @returns {{ ok: true, fingerprint: string } | { ok: false, reason: string }}
   */
  function parseCode(input) {
    if (typeof input !== 'string') return { ok: false, reason: 'empty' };
    var clean = input.trim().toUpperCase().replace(/^MYFB[- :\s]+/, '').replace(/\s+/g, '');
    if (!/^[A-Z2-7]{6}$/.test(clean)) {
      return { ok: false, reason: 'format' };
    }
    var payload  = clean.slice(0, 5);
    var checksum = clean.slice(5);
    if (_checksum(payload) !== checksum) {
      return { ok: false, reason: 'checksum' };
    }
    // payload is the fingerprint we'll compare against the admin's
    // generateCode() once we receive their link.accepted event.
    return { ok: true, fingerprint: payload };
  }

  /**
   * @param {string} adminUuid
   * @returns {string} the 5-char fingerprint derived from adminUuid
   */
  function fingerprintOf(adminUuid) {
    var hash = _hashUuid(adminUuid);
    var p = '';
    for (var i = 0; i < 5; i++) p += _b32((hash >>> (i * 5)) & 31);
    return p;
  }

  // ── Public API ──────────────────────────────────────────────────────
  root.MyFb.core.pairing = {
    PREFIX:        PREFIX,
    generateCode:  generateCode,
    parseCode:     parseCode,
    fingerprintOf: fingerprintOf,
    _checksum:     _checksum,
    _hashUuid:     _hashUuid,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MyFb.core.pairing;
  }
})(typeof window !== 'undefined' ? window : globalThis);
