// @ts-check
/**
 * My-Feedbacks Pairing Handler (v1.17)
 *
 * Reactive layer that watches the runtime event stream and:
 *
 *  1. When a `link.requested` event arrives with a `payload.fingerprint`
 *     that matches OUR uuid's fingerprint, AND we haven't already
 *     accepted it, automatically emit `link.accepted` with our full
 *     uuid + displayName so the requester can resolve the placeholder
 *     `pending:<fingerprint>` peer reference.
 *
 *  2. When a `link.accepted` arrives whose payload references a peer
 *     we have a pending request for, swap the local link entry to point
 *     at the resolved full UUID.
 *
 * This module sits BETWEEN the sync-engine (which feeds events in) and
 * the reducer (which materialises the state). It hooks via a pass-
 * through wrapper on ctx.emit + a poll of state.links.
 *
 * Pure logic, headless-testable.
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};

  /**
   * Given a fresh runtime ctx, attach the pairing handler. Returns
   * detach() so callers can tear down.
   *
   * @param {object} ctx
   * @returns {() => void}
   */
  function attach(ctx) {
    var pairing = root.MyFb.core.pairing;
    var events  = root.MyFb.core.events;
    if (!pairing || !events || !ctx || !ctx.uuid) {
      throw new Error('[MyFb pairing-handler] attach() requires ctx with uuid and core modules');
    }
    var myFingerprint = pairing.fingerprintOf(ctx.uuid);
    var T = events.TYPES;
    var accepted = new Set();   // peerUuids we've already responded to
    var pollTimer = null;

    function _scan() {
      var links = (ctx.state && ctx.state.links) || {};
      Object.keys(links).forEach(function (peerUuid) {
        var l = links[peerUuid];
        if (!l || l.status !== 'pending') return;
        // Case A : we're the admin being requested
        if (l.fingerprint === myFingerprint && peerUuid !== ctx.uuid && !accepted.has(peerUuid)) {
          accepted.add(peerUuid);
          ctx.emit(T.LINK_ACCEPTED, {
            peerUuid:    peerUuid,
            acceptedBy:  ctx.uuid,
            displayName: (ctx.profile && ctx.profile.displayName) || null,
          }).catch(function () { accepted.delete(peerUuid); });
        }
      });
    }

    // Quick poll — sync-engine ingests events asynchronously, this
    // catches them without us having to subscribe to the store.
    pollTimer = setInterval(_scan, 2_000);
    _scan();

    return function detach() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      accepted.clear();
    };
  }

  /**
   * Resolve placeholder "pending:<fingerprint>" peer references in
   * ctx.state.links by walking the event log and finding the matching
   * link.accepted event. Returns a new links object (caller decides
   * whether to commit it).
   *
   * Pure function — used by tests + a future "resolve links" UI op.
   *
   * @param {object} links
   * @param {object[]} events
   * @returns {object} resolved links keyed by full uuid
   */
  function resolvePlaceholders(links, events) {
    var byFingerprint = {};
    (events || []).forEach(function (e) {
      if (e && e.type === 'link.accepted' && e.payload && e.payload.acceptedBy) {
        var fp = root.MyFb.core.pairing.fingerprintOf(e.payload.acceptedBy);
        byFingerprint[fp] = e.payload.acceptedBy;
      }
    });
    var out = {};
    Object.keys(links || {}).forEach(function (key) {
      var l = links[key];
      if (key.indexOf('pending:') === 0) {
        var fp = key.slice('pending:'.length);
        var resolved = byFingerprint[fp];
        if (resolved) {
          out[resolved] = Object.assign({}, l, { peerUuid: resolved, status: 'accepted' });
          return;
        }
      }
      out[key] = l;
    });
    return out;
  }

  root.MyFb.core.pairingHandler = {
    attach:              attach,
    resolvePlaceholders: resolvePlaceholders,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MyFb.core.pairingHandler;
  }
})(typeof window !== 'undefined' ? window : globalThis);
