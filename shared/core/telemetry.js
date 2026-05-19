// @ts-check
/**
 * My-Feedbacks Telemetry (v2.0) — strictly opt-in, strictly anonymous.
 *
 * Helps the maintainer prioritise features by counting how often
 * certain actions are taken across the user base. NOTHING is sent
 * unless the user explicitly toggles "Partager des statistiques
 * anonymes" in Settings → Confidentialité.
 *
 * What IS collected when enabled :
 *   - Event name (a fixed string from a whitelist)
 *   - App version (manifest.version)
 *   - Browser name + OS name (no versions)
 *   - Aggregate counts (e.g. number of times "summarize" was clicked)
 *
 * What is NEVER collected, even when enabled :
 *   - UUID, device ids, IP (the endpoint sees IP but we don't store)
 *   - User text, demande content, ref payloads, screenshots
 *   - Page URLs visited, error messages, network failures
 *   - API keys, credentials, anything from chrome.storage
 *
 * Transport :
 *   - When endpoint is not configured (v2.0 ships without one), events
 *     are LOCAL-ONLY — they just increment counters in chrome.storage
 *     so the user can see their own activity via the future "stats"
 *     panel.
 *   - When endpoint is configured (future), events are POSTed as
 *     {name, version, browser, os, ts}. Batch every 60s.
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};

  var STORAGE_ENABLED  = 'myfb:telemetry:enabled';   // boolean, default false
  var STORAGE_COUNTERS = 'myfb:telemetry:counters';  // { [eventName]: number }

  /** Whitelist of event names we accept. */
  var EVENTS = Object.freeze({
    DEMANDE_CREATED:    'demande.created',
    DEMANDE_SUBMITTED:  'demande.submitted',
    PICKER_USED:        'picker.used',
    SCREENSHOT_TAKEN:   'screenshot.taken',
    AI_SUMMARIZE:       'ai.summarize',
    AI_TRIAGE_SUGGEST:  'ai.triage_suggest',
    EXPORT_TARGET:      'export.target',    // payload may include target id
    SYNC_MODE_CHANGED:  'sync.mode_changed',
    PAIRING_GENERATED:  'pairing.generated',
    PAIRING_VALIDATED:  'pairing.validated',
    ONBOARDING_DONE:    'onboarding.done',
  });

  // ── Storage (chrome.storage.local + in-memory fallback) ────────────
  var _impl = null;
  function _storage() {
    if (_impl) return _impl;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      var sl = /** @type {any} */ (chrome.storage.local);
      _impl = {
        get: function (key) { return new Promise(function (r) { sl.get(key, r); }); },
        set: function (obj) { return new Promise(function (r) { sl.set(obj, function () { r(); }); }); },
      };
    } else {
      var mem = {};
      _impl = {
        get: function (key) { var o = {}; if (mem[key] !== undefined) o[key] = mem[key]; return Promise.resolve(o); },
        set: function (obj) { Object.assign(mem, obj); return Promise.resolve(); },
      };
    }
    return _impl;
  }

  function isEnabled() {
    return _storage().get(STORAGE_ENABLED).then(function (o) { return !!o[STORAGE_ENABLED]; });
  }

  function setEnabled(v) {
    var obj = {}; obj[STORAGE_ENABLED] = !!v;
    return _storage().set(obj);
  }

  function getCounters() {
    return _storage().get(STORAGE_COUNTERS).then(function (o) { return o[STORAGE_COUNTERS] || {}; });
  }

  function resetCounters() {
    var obj = {}; obj[STORAGE_COUNTERS] = {};
    return _storage().set(obj);
  }

  /**
   * Record a telemetry event. No-op if disabled. Returns the new
   * counter value for that event (or null if disabled).
   *
   * @param {string} eventName  must be in EVENTS
   * @returns {Promise<number | null>}
   */
  function track(eventName) {
    var allowed = /** @type {string[]} */ (Object.values(EVENTS));
    if (allowed.indexOf(eventName) === -1) {
      return Promise.reject(new Error('[MyFb telemetry] unknown event: ' + eventName));
    }
    return isEnabled().then(function (on) {
      if (!on) return null;
      return getCounters().then(function (counters) {
        counters[eventName] = (counters[eventName] || 0) + 1;
        var obj = {}; obj[STORAGE_COUNTERS] = counters;
        return _storage().set(obj).then(function () { return counters[eventName]; });
      });
    });
  }

  // Test seam
  function __setStorageImpl(impl) { _impl = impl; }

  root.MyFb.core.telemetry = {
    EVENTS:           EVENTS,
    STORAGE_ENABLED:  STORAGE_ENABLED,
    STORAGE_COUNTERS: STORAGE_COUNTERS,
    isEnabled:        isEnabled,
    setEnabled:       setEnabled,
    getCounters:      getCounters,
    resetCounters:    resetCounters,
    track:            track,
    __setStorageImpl: __setStorageImpl,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MyFb.core.telemetry;
  }
})(typeof window !== 'undefined' ? window : globalThis);
