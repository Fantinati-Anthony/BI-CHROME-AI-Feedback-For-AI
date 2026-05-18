/**
 * My-Feedbacks Triage API
 *
 * High-level convenience methods over the event-sourced runtime ctx
 * (see sidepanel/runtime.js) for the triage workflow:
 *   - statuses    (new / accepted / rejected / shipped)
 *   - priorities  (low / medium / high / critical)
 *   - assignment  (to a workspace member uuid)
 *   - tags        (free-form, multi-color)
 *   - comments    (threaded discussion admin ↔ client)
 *
 * Each setter emits one event through runtime.ctx.emit() and returns the
 * resulting event. Reads go through runtime.ctx.state (the materialized
 * view derived from the event log).
 *
 * All operations are no-ops if the runtime isn't booted yet — the UI
 * should keep working in legacy mode. This module intentionally has NO
 * DOM dependencies so it can be tested headlessly.
 */

(function (window) {
  'use strict';

  var STATUSES   = Object.freeze(['new', 'accepted', 'rejected', 'shipped']);
  var PRIORITIES = Object.freeze(['low', 'medium', 'high', 'critical']);

  function _ctx() {
    return (window.MyFb && window.MyFb.runtime) || null;
  }
  function _types() {
    var e = window.MyFb && window.MyFb.core && window.MyFb.core.events;
    return e ? e.TYPES : null;
  }

  function _requireDemandeExists(demandeId) {
    var ctx = _ctx();
    if (!ctx || !ctx.state || !ctx.state.demandes) return false;
    return !!ctx.state.demandes[demandeId];
  }

  // ── Status ──────────────────────────────────────────────────────────

  function setStatus(demandeId, status) {
    if (STATUSES.indexOf(status) < 0) {
      return Promise.reject(new Error('[MyFb triage] invalid status: ' + status));
    }
    var ctx = _ctx(); var T = _types();
    if (!ctx || !T) return Promise.resolve(null);
    if (!_requireDemandeExists(demandeId)) {
      return Promise.reject(new Error('[MyFb triage] unknown demande: ' + demandeId));
    }
    return ctx.emit(T.DEMANDE_STATUS_CHANGED, { id: demandeId, status: status });
  }

  function getStatus(demandeId) {
    var ctx = _ctx();
    if (!ctx || !ctx.state.demandes[demandeId]) return null;
    return ctx.state.demandes[demandeId].status || 'new';
  }

  // ── Priority ────────────────────────────────────────────────────────

  function setPriority(demandeId, priority) {
    if (PRIORITIES.indexOf(priority) < 0) {
      return Promise.reject(new Error('[MyFb triage] invalid priority: ' + priority));
    }
    var ctx = _ctx(); var T = _types();
    if (!ctx || !T) return Promise.resolve(null);
    if (!_requireDemandeExists(demandeId)) {
      return Promise.reject(new Error('[MyFb triage] unknown demande: ' + demandeId));
    }
    return ctx.emit(T.DEMANDE_PRIORITY_CHANGED, { id: demandeId, priority: priority });
  }

  function getPriority(demandeId) {
    var ctx = _ctx();
    if (!ctx || !ctx.state.demandes[demandeId]) return null;
    return ctx.state.demandes[demandeId].priority || 'medium';
  }

  // ── Assignment ──────────────────────────────────────────────────────

  function setAssignee(demandeId, assigneeUuid /* nullable */) {
    var ctx = _ctx(); var T = _types();
    if (!ctx || !T) return Promise.resolve(null);
    if (!_requireDemandeExists(demandeId)) {
      return Promise.reject(new Error('[MyFb triage] unknown demande: ' + demandeId));
    }
    return ctx.emit(T.DEMANDE_ASSIGNED, { id: demandeId, assignee: assigneeUuid || null });
  }

  function getAssignee(demandeId) {
    var ctx = _ctx();
    if (!ctx || !ctx.state.demandes[demandeId]) return null;
    return ctx.state.demandes[demandeId].assignee || null;
  }

  // ── Tags ────────────────────────────────────────────────────────────

  function addTag(demandeId, tag) {
    var clean = _normalizeTag(tag);
    if (!clean) return Promise.reject(new Error('[MyFb triage] tag is empty'));
    var ctx = _ctx(); var T = _types();
    if (!ctx || !T) return Promise.resolve(null);
    if (!_requireDemandeExists(demandeId)) {
      return Promise.reject(new Error('[MyFb triage] unknown demande: ' + demandeId));
    }
    return ctx.emit(T.DEMANDE_TAGGED, { id: demandeId, tag: clean });
  }

  function removeTag(demandeId, tag) {
    var clean = _normalizeTag(tag);
    if (!clean) return Promise.reject(new Error('[MyFb triage] tag is empty'));
    var ctx = _ctx(); var T = _types();
    if (!ctx || !T) return Promise.resolve(null);
    if (!_requireDemandeExists(demandeId)) {
      return Promise.reject(new Error('[MyFb triage] unknown demande: ' + demandeId));
    }
    return ctx.emit(T.DEMANDE_UNTAGGED, { id: demandeId, tag: clean });
  }

  function getTags(demandeId) {
    var ctx = _ctx();
    if (!ctx || !ctx.state.demandes[demandeId]) return [];
    return (ctx.state.demandes[demandeId].tags || []).slice();
  }

  function _normalizeTag(tag) {
    if (typeof tag !== 'string') return null;
    var t = tag.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40);
    return t.length ? t : null;
  }

  // ── Comments ────────────────────────────────────────────────────────

  function addComment(demandeId, text) {
    var clean = (text || '').toString().trim();
    if (!clean) return Promise.reject(new Error('[MyFb triage] comment is empty'));
    var ctx = _ctx(); var T = _types(); var ev = window.MyFb && window.MyFb.core && window.MyFb.core.events;
    if (!ctx || !T || !ev) return Promise.resolve(null);
    if (!_requireDemandeExists(demandeId)) {
      return Promise.reject(new Error('[MyFb triage] unknown demande: ' + demandeId));
    }
    var commentId = 'cmt-' + ev.uuid();
    return ctx.emit(T.DEMANDE_COMMENTED, {
      demandeId: demandeId,
      commentId: commentId,
      text:      clean.slice(0, 2000),
    });
  }

  function editComment(demandeId, commentId, newText) {
    var clean = (newText || '').toString().trim();
    if (!clean) return Promise.reject(new Error('[MyFb triage] new comment text is empty'));
    var ctx = _ctx(); var T = _types();
    if (!ctx || !T) return Promise.resolve(null);
    var d = ctx.state.demandes[demandeId];
    if (!d || !d.comments || !d.comments[commentId]) {
      return Promise.reject(new Error('[MyFb triage] unknown comment'));
    }
    return ctx.emit(T.DEMANDE_COMMENT_EDITED, {
      demandeId: demandeId,
      commentId: commentId,
      text:      clean.slice(0, 2000),
    });
  }

  function deleteComment(demandeId, commentId) {
    var ctx = _ctx(); var T = _types();
    if (!ctx || !T) return Promise.resolve(null);
    var d = ctx.state.demandes[demandeId];
    if (!d || !d.comments || !d.comments[commentId]) {
      return Promise.reject(new Error('[MyFb triage] unknown comment'));
    }
    return ctx.emit(T.DEMANDE_COMMENT_DELETED, { demandeId: demandeId, commentId: commentId });
  }

  function listComments(demandeId) {
    var ctx = _ctx();
    if (!ctx || !ctx.state.demandes[demandeId]) return [];
    var bag = ctx.state.demandes[demandeId].comments || {};
    return Object.keys(bag).map(function (k) {
      return Object.assign({ id: k }, bag[k]);
    }).filter(function (c) { return !c.deleted; })
      .sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
  }

  // ── Filters / queries ───────────────────────────────────────────────

  function listByStatus(status) {
    var ctx = _ctx();
    if (!ctx) return [];
    return Object.values(ctx.state.demandes || {})
      .filter(function (d) { return !d.deleted && (d.status || 'new') === status; });
  }

  function listByPriority(priority) {
    var ctx = _ctx();
    if (!ctx) return [];
    return Object.values(ctx.state.demandes || {})
      .filter(function (d) { return !d.deleted && (d.priority || 'medium') === priority; });
  }

  function listByAssignee(assigneeUuid) {
    var ctx = _ctx();
    if (!ctx) return [];
    return Object.values(ctx.state.demandes || {})
      .filter(function (d) { return !d.deleted && d.assignee === assigneeUuid; });
  }

  function listByTag(tag) {
    var clean = _normalizeTag(tag);
    if (!clean) return [];
    var ctx = _ctx();
    if (!ctx) return [];
    return Object.values(ctx.state.demandes || {})
      .filter(function (d) { return !d.deleted && (d.tags || []).indexOf(clean) >= 0; });
  }

  /**
   * Aggregate count by status for a kanban-style header. Returns an
   * object { new, accepted, rejected, shipped } where each value is
   * the count of non-deleted demandes in that status.
   */
  function statusCounts() {
    var out = { new: 0, accepted: 0, rejected: 0, shipped: 0 };
    var ctx = _ctx();
    if (!ctx) return out;
    var ds = ctx.state.demandes || {};
    Object.keys(ds).forEach(function (k) {
      var d = ds[k];
      if (d.deleted) return;
      var s = d.status || 'new';
      if (out[s] !== undefined) out[s] += 1;
    });
    return out;
  }

  window.MyFbTriage = {
    STATUSES:       STATUSES,
    PRIORITIES:     PRIORITIES,
    setStatus:      setStatus,
    getStatus:      getStatus,
    setPriority:    setPriority,
    getPriority:    getPriority,
    setAssignee:    setAssignee,
    getAssignee:    getAssignee,
    addTag:         addTag,
    removeTag:      removeTag,
    getTags:        getTags,
    addComment:     addComment,
    editComment:    editComment,
    deleteComment:  deleteComment,
    listComments:   listComments,
    listByStatus:   listByStatus,
    listByPriority: listByPriority,
    listByAssignee: listByAssignee,
    listByTag:      listByTag,
    statusCounts:   statusCounts,
    _normalizeTag:  _normalizeTag,
  };
})(window);
