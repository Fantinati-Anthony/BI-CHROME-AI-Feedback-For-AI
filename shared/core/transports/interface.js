// @ts-check
/**
 * My-Feedbacks Transport Interface (contract documentation)
 *
 * Every sync mode (solo, shared-folder, self-hosted, cloud) implements
 * this same surface so the rest of the app can be transport-agnostic. The
 * UI talks to ONE transport at a time, picked by the user in Settings →
 * Sync.
 *
 * This file is documentation only — it defines the JSDoc typedefs that
 * concrete transports must satisfy. Use a transport like:
 *
 *   var tx = window.MyFb.core.transports.solo.create(config);
 *   await tx.init();
 *   tx.subscribe(function (e) { reducer.applyEvent(state, e); });
 *   await tx.push([event]);
 *
 * @typedef {Object} TransportStatus
 * @property {'idle'|'syncing'|'offline'|'error'} state
 * @property {string} [detail]
 *
 * @typedef {Object} Transport
 * @property {(config: object) => Promise<void>} init
 *     Set up connections, load the local last-known cursor, etc. Idempotent.
 * @property {(events: object[]) => Promise<void>} push
 *     Send local events to remote peers/server. MUST be idempotent on the
 *     receiving end (use event.id for dedup).
 * @property {(since: number) => Promise<object[]>} pull
 *     Fetch all events with lamportTs > since. Returns them in canonical
 *     order.
 * @property {(cb: (e: object) => void) => () => void} subscribe
 *     Register a listener for incoming events (push from peers or polled
 *     fetch). Returns an unsubscribe function.
 * @property {() => TransportStatus} status
 *     Synchronous snapshot of current sync health.
 * @property {() => Promise<void>} dispose
 *     Tear down (close connections, cancel timers). Idempotent.
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};
  root.MyFb.core.transports = root.MyFb.core.transports || {};

  /**
   * Canonical list of transport identifiers. Used by Settings UI to render
   * the radio group, and by the storage layer to remember the user's pick.
   */
  var TRANSPORTS = Object.freeze({
    SOLO:          'solo',
    SHARED_FOLDER: 'shared-folder',
    SELF_HOSTED:   'self-hosted',
    CLOUD:         'cloud',
  });

  root.MyFb.core.transports.TRANSPORTS = TRANSPORTS;
  root.MyFb.core.transports.interface  = {
    // Just the constants — the typedef above is the real contract.
    TRANSPORTS: TRANSPORTS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TRANSPORTS: TRANSPORTS };
  }
})(typeof window !== 'undefined' ? window : globalThis);
