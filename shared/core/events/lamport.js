// @ts-check
/**
 * My-Feedbacks Lamport Clock
 *
 * A logical clock that gives a partial-to-total order on events across
 * multiple peers without needing synchronized wall clocks.
 *
 * Rules (Lamport 1978):
 *   - tick(): increment the local counter and return the new value
 *     (used when EMITTING a new event)
 *   - observe(remoteTs): set counter = max(local, remote) + 1
 *     (used when RECEIVING an event from another peer)
 *
 * The clock is persisted by the caller (typically in chrome.storage.local)
 * so it survives reloads. The current implementation only holds an
 * in-memory counter — wire up persistence at the integration layer.
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};

  /**
   * Create a fresh lamport clock starting at `initial`.
   * @param {number} [initial=0]
   */
  function create(initial) {
    var counter = (typeof initial === 'number' && initial >= 0) ? Math.floor(initial) : 0;

    return {
      /** Current logical timestamp (read-only). */
      now: function () {
        return counter;
      },
      /**
       * Increment and return — call EXACTLY ONCE before emitting an event.
       * @returns {number}
       */
      tick: function () {
        counter += 1;
        return counter;
      },
      /**
       * Merge a remote timestamp. Call when RECEIVING an event. Bumps the
       * counter to be at least one past the remote's lamportTs so any
       * subsequent emit happens-after that observation.
       * @param {number} remoteTs
       * @returns {number} the new local counter
       */
      observe: function (remoteTs) {
        if (typeof remoteTs !== 'number' || remoteTs < 0) return counter;
        if (remoteTs >= counter) counter = remoteTs + 1;
        return counter;
      },
      /**
       * Force the counter to a specific value (used when hydrating from
       * persistence on startup). Refuses to go backward to avoid breaking
       * causal ordering.
       * @param {number} value
       */
      hydrate: function (value) {
        if (typeof value !== 'number' || value < 0) return;
        if (Math.floor(value) > counter) counter = Math.floor(value);
      },
    };
  }

  root.MyFb.core.lamport = { create: create };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MyFb.core.lamport;
  }
})(typeof window !== 'undefined' ? window : globalThis);
