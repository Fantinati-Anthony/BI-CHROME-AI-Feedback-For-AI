// @ts-check
/**
 * MyFb Scrub
 *
 * Privacy filter — masks PII / secrets in user-supplied text BEFORE it
 * lands in storage or in an export. Patterns:
 *
 *   email      → [email]
 *   IBAN       → [iban]
 *   credit card (Luhn-validated) → [card]
 *   JWT        → [jwt]
 *   Bearer/sk- API keys → [token]
 *   IPv4 / IPv6 → kept (not strictly PII)
 *
 * Toggle via STATE.privacyScrub (default true). Designed to be cheap:
 * each pattern is a single regex pass. Luhn check filters CC false-positives.
 *
 *   MyFbScrub.scrubText(s)           → cleaned string
 *   MyFbScrub.scrubRef(ref)          → mutates ref text fields
 *   MyFbScrub.scrubDemande(d)        → mutates d.text + every ref
 *   MyFbScrub.isEnabled(STATE)       → respects STATE.privacyScrub flag
 */
(function (root) {
  'use strict';
  root.MyFb = root.MyFb || {};

  // -- Patterns -------------------------------------------------------
  var EMAIL_RE  = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  var IBAN_RE   = /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g;
  // Bearer / sk- / pk- / xox*- / ghp_ / gho_ / etc.
  var TOKEN_RE  = /\b(?:Bearer\s+|sk-|pk-|xox[abprs]-|ghp_|gho_|ghs_|ghu_|hf_|nvapi-)[A-Za-z0-9_\-.]{16,}\b/g;
  var JWT_RE    = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
  // 13-19 digit groups (with optional spaces/dashes) — validated by Luhn
  var CC_RE     = /\b(?:\d[ -]?){13,19}\b/g;

  function _luhnOk(num) {
    var digits = String(num).replace(/[^\d]/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    var sum = 0, alt = false;
    for (var i = digits.length - 1; i >= 0; i--) {
      var n = +digits[i];
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }

  function scrubText(s) {
    if (typeof s !== 'string' || !s) return s;
    var out = s
      .replace(EMAIL_RE, '[email]')
      .replace(JWT_RE,   '[jwt]')
      .replace(TOKEN_RE, '[token]')
      .replace(IBAN_RE,  '[iban]');
    out = out.replace(CC_RE, function (m) { return _luhnOk(m) ? '[card]' : m; });
    return out;
  }

  function scrubRef(ref) {
    if (!ref || typeof ref !== 'object') return ref;
    if (typeof ref.text === 'string')      ref.text = scrubText(ref.text);
    if (typeof ref.title === 'string')     ref.title = scrubText(ref.title);
    if (typeof ref.snippet === 'string')   ref.snippet = scrubText(ref.snippet);
    if (typeof ref.outerHTML === 'string') ref.outerHTML = scrubText(ref.outerHTML);
    if (typeof ref.message === 'string')   ref.message = scrubText(ref.message);
    return ref;
  }

  function scrubDemande(d) {
    if (!d || typeof d !== 'object') return d;
    if (typeof d.text === 'string') d.text = scrubText(d.text);
    if (Array.isArray(d.refs)) d.refs.forEach(scrubRef);
    return d;
  }

  function isEnabled(STATE) {
    // Default ON — opt-out, not opt-in. Matches the "credible by default"
    // posture for a tool used by professionals.
    return !STATE || STATE.privacyScrub !== false;
  }

  var api = {
    scrubText:    scrubText,
    scrubRef:     scrubRef,
    scrubDemande: scrubDemande,
    isEnabled:    isEnabled,
    _luhnOk:      _luhnOk,
  };
  root.MyFbScrub = api;
  // Soft ESM: expose as CommonJS export when running in Node (Vitest)
  // — no-op in browsers, lets tests do `import` via vite-node.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
