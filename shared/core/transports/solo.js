// @ts-check
/**
 * My-Feedbacks Transport — Solo
 *
 * The no-sync transport. Events are stored locally only. push() is a
 * no-op (events written to the local store by the caller, not by this
 * transport). pull() always returns []. subscribe() never fires.
 *
 * Use this as the default for tier 1 (solo user, no pairing). It exists
 * so the rest of the app can treat all 4 tiers uniformly — no special
 * cases for "no transport".
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};
  root.MyFb.core.transports = root.MyFb.core.transports || {};

  /**
   * @param {object} [_config] reserved for future config (e.g. retention)
   * @returns {import('./interface.js').Transport}
   */
  function create(_config) {
    /** @type {{ state: 'idle'|'syncing'|'offline'|'error', detail?: string }} */
    var _state = { state: 'idle' };

    return {
      init: function () {
        _state = { state: 'idle' };
        return Promise.resolve();
      },
      push: function (_events) {
        // No-op: solo mode doesn't ship events anywhere.
        return Promise.resolve();
      },
      pull: function (_since) {
        // No remote peers => nothing to pull.
        return Promise.resolve([]);
      },
      subscribe: function (_cb) {
        // No remote events will ever arrive. Return a no-op unsubscriber.
        return function () {};
      },
      status: function () {
        return _state;
      },
      dispose: function () {
        _state = { state: 'idle' };
        return Promise.resolve();
      },
    };
  }

  root.MyFb.core.transports.solo = { create: create };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { create: create };
  }
})(typeof window !== 'undefined' ? window : globalThis);
