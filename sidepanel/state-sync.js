/**
 * My-Feedbacks Reverse Bridge: Event Store → Legacy STATE (v2.0)
 *
 * When the sync engine ingests a remote event from another peer, the
 * reducer updates ctx.state but the legacy renderer reads from
 * STATE.demandes (chrome.storage.local). This module subscribes to
 * the active transport via the engine and patches STATE.demandes in
 * place so the existing UI re-renders.
 *
 * To prevent feedback loops with legacy-event-bridge.js, we call
 * MyFbLegacyEventBridge.syncShadow(STATE) after each patch so the
 * forward bridge's diff thinks "no change".
 */

(function (window) {
  'use strict';

  var _attached = false;

  function attach() {
    if (_attached) return;
    var ctx = window.MyFb && window.MyFb.runtime;
    if (!ctx || !ctx.transport || typeof ctx.transport.subscribe !== 'function') {
      return false;
    }
    ctx.transport.subscribe(function (ev) {
      try { _applyRemoteEvent(ev); } catch (_) {}
    });
    _attached = true;
    return true;
  }

  function _applyRemoteEvent(ev) {
    var ctx = window.MyFb && window.MyFb.runtime;
    var bindings = window.MyFbBindings && window.MyFbBindings.ctx;
    var STATE = bindings && bindings.STATE;
    if (!ctx || !STATE || !ev || !ev.type) return;
    // Only relevant types — others (link.*, device.*, etc.) don't
    // affect the legacy demandes view.
    var p = ev.payload || {};
    if (ev.type === 'demande.created') {
      if (!Array.isArray(STATE.demandes)) STATE.demandes = [];
      if (STATE.demandes.some(function (d) { return d.id === p.id; })) return;
      STATE.demandes.push({
        id:   p.id,
        ts:   ev.ts || Date.now(),
        text: p.text || '',
        refs: [],
        url:  p.url || null,
      });
    } else if (ev.type === 'demande.text_updated') {
      var d1 = (STATE.demandes || []).find(function (x) { return x.id === p.id; });
      if (d1) d1.text = p.text || '';
    } else if (ev.type === 'demande.deleted') {
      var i = (STATE.demandes || []).findIndex(function (x) { return x.id === p.id; });
      if (i !== -1) STATE.demandes.splice(i, 1);
    } else if (ev.type === 'ref.added') {
      var d2 = (STATE.demandes || []).find(function (x) { return x.id === p.demandeId; });
      if (d2) {
        d2.refs = d2.refs || [];
        if (!d2.refs.some(function (r) { return r.id === p.ref.id; })) d2.refs.push(p.ref);
      }
    } else if (ev.type === 'ref.removed') {
      var d3 = (STATE.demandes || []).find(function (x) { return x.id === p.demandeId; });
      if (d3 && Array.isArray(d3.refs)) {
        d3.refs = d3.refs.filter(function (r) { return r.id !== p.refId; });
      }
    } else if (ev.type === 'demande.tagged') {
      var d4 = (STATE.demandes || []).find(function (x) { return x.id === p.id; });
      if (d4) {
        d4.tags = d4.tags || [];
        if (d4.tags.indexOf(p.tag) === -1) d4.tags.push(p.tag);
      }
    } else if (ev.type === 'demande.untagged') {
      var d5 = (STATE.demandes || []).find(function (x) { return x.id === p.id; });
      if (d5 && Array.isArray(d5.tags)) {
        d5.tags = d5.tags.filter(function (t) { return t !== p.tag; });
      }
    } else {
      return;  // not a legacy-affecting event
    }

    // Sync the forward-bridge shadow so it doesn't re-emit this
    if (window.MyFbLegacyEventBridge && window.MyFbLegacyEventBridge.syncShadow) {
      window.MyFbLegacyEventBridge.syncShadow(STATE);
    }
    // Persist + re-render
    if (window.MyFbStorage && window.MyFbStorage.persist) {
      window.MyFbStorage.persist(STATE, { skipUndo: true });
    }
    if (window.MyFbRenderer && window.MyFbRenderer.renderSegments) {
      window.MyFbRenderer.renderSegments();
    }
  }

  window.MyFbStateSync = {
    attach:            attach,
    _applyRemoteEvent: _applyRemoteEvent,
  };
})(window);
