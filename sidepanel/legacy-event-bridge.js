/**
 * My-Feedbacks Legacy ↔ Event Store Bridge (v2.0)
 *
 * Bridges the legacy STATE.demandes (managed by sidepanel/session.js,
 * sidepanel/storage.js and friends) with the event-sourced runtime
 * (MyFb.runtime). Without this bridge, the v1.* modules (sync engine,
 * triage API, AI features) only see what's emitted via ctx.emit() —
 * which is nothing for users still creating demandes through the
 * legacy "submit" flow.
 *
 * Mechanism :
 *   - Wrap MyFbStorage.persist(STATE) so AFTER it runs, we diff a
 *     shadow snapshot against the current STATE and emit the
 *     corresponding events (demande.created / .deleted / .text_updated /
 *     ref.added / .removed / .tagged / .untagged).
 *   - Idempotent : if an event was originally EMITTED by ctx.emit
 *     (and reflected back into STATE by the reverse bridge in
 *     state-sync.js), the shadow already contains the new entries —
 *     diff is empty, no double emit.
 *   - Errors swallowed : the legacy persist must always succeed
 *     regardless of event store health.
 */

(function (window) {
  'use strict';

  var _shadow = null;     // last snapshot we've already emitted events for
  var _attached = false;

  function attach() {
    if (_attached) return;
    if (!window.MyFbStorage || typeof window.MyFbStorage.persist !== 'function') {
      return false;
    }
    var origPersist = window.MyFbStorage.persist.bind(window.MyFbStorage);
    window.MyFbStorage.persist = function (STATE, opts) {
      var ret = origPersist(STATE, opts);
      try { _diffAndEmit(STATE); } catch (_) {}
      return ret;
    };
    _attached = true;
    return true;
  }

  function _ctx() {
    return (window.MyFb && window.MyFb.runtime) || null;
  }

  function _types() {
    var e = window.MyFb && window.MyFb.core && window.MyFb.core.events;
    return e ? e.TYPES : null;
  }

  function _snapshot(STATE) {
    if (!STATE || !Array.isArray(STATE.demandes)) return { byId: {}, ids: [] };
    var byId = {};
    var ids = [];
    STATE.demandes.forEach(function (d) {
      if (!d || !d.id) return;
      ids.push(d.id);
      byId[d.id] = {
        id:   d.id,
        text: d.text || '',
        url:  d.url  || null,
        refs: (d.refs || []).map(function (r, i) {
          // Refs may not have ids in legacy data — synthesise one based
          // on demande id + index so we can track adds/removes.
          var refId = r.id || ('legacy:' + d.id + ':' + i);
          return { id: refId, type: r.type, selector: r.selector || null, box: r.box || null, ts: r.ts };
        }),
        tags: (d.tags || []).slice(),
      };
    });
    return { byId: byId, ids: ids };
  }

  function _diffAndEmit(STATE) {
    var ctx = _ctx();
    var T   = _types();
    if (!ctx || !ctx.emit || !T) return;

    var next = _snapshot(STATE);
    var prev = _shadow;
    _shadow  = next;

    if (!prev) return;  // first call : just record baseline, no diff

    var emits = [];

    // 1. Created or updated demandes
    next.ids.forEach(function (id) {
      var n = next.byId[id];
      var p = prev.byId[id];
      if (!p) {
        // newly created
        emits.push({ type: T.DEMANDE_CREATED, payload: { id: id, text: n.text, url: n.url } });
        n.refs.forEach(function (r) {
          emits.push({ type: T.REF_ADDED, payload: { demandeId: id, ref: r } });
        });
        n.tags.forEach(function (tg) {
          emits.push({ type: T.DEMANDE_TAGGED, payload: { id: id, tag: tg } });
        });
      } else {
        if (n.text !== p.text) {
          emits.push({ type: T.DEMANDE_TEXT_UPDATED, payload: { id: id, text: n.text } });
        }
        // ref diff
        var pRefIds = new Set(p.refs.map(function (r) { return r.id; }));
        var nRefIds = new Set(n.refs.map(function (r) { return r.id; }));
        n.refs.forEach(function (r) {
          if (!pRefIds.has(r.id)) emits.push({ type: T.REF_ADDED, payload: { demandeId: id, ref: r } });
        });
        p.refs.forEach(function (r) {
          if (!nRefIds.has(r.id)) emits.push({ type: T.REF_REMOVED, payload: { demandeId: id, refId: r.id } });
        });
        // tag diff
        var pTags = new Set(p.tags);
        var nTags = new Set(n.tags);
        n.tags.forEach(function (tg) {
          if (!pTags.has(tg)) emits.push({ type: T.DEMANDE_TAGGED, payload: { id: id, tag: tg } });
        });
        p.tags.forEach(function (tg) {
          if (!nTags.has(tg)) emits.push({ type: T.DEMANDE_UNTAGGED, payload: { id: id, tag: tg } });
        });
      }
    });

    // 2. Deleted demandes
    prev.ids.forEach(function (id) {
      if (!next.byId[id]) {
        emits.push({ type: T.DEMANDE_DELETED, payload: { id: id } });
      }
    });

    // Fire each emit synchronously — ctx.emit increments the lamport
    // clock synchronously then persists async. Returning the array of
    // emit() promises lets tests await all of them.
    var promises = emits.map(function (e) {
      try { return ctx.emit(e.type, e.payload).catch(function () {}); }
      catch (_) { return Promise.resolve(); }
    });
    return Promise.all(promises);
  }

  /**
   * Reset the shadow snapshot to the current STATE without emitting
   * events. Used by the reverse bridge after applying a remote event
   * to legacy STATE — prevents a feedback loop.
   */
  function syncShadow(STATE) {
    _shadow = _snapshot(STATE);
  }

  window.MyFbLegacyEventBridge = {
    attach:      attach,
    _snapshot:   _snapshot,
    _diffAndEmit: _diffAndEmit,
    syncShadow:  syncShadow,
  };
})(window);
