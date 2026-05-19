// @ts-check
/**
 * My-Feedbacks State Reducer
 *
 * Pure function that derives the current application state from an
 * ordered sequence of events. No side effects, no I/O — given the same
 * events in the same order, always returns the same state.
 *
 * State shape:
 * {
 *   workspaces: { [id]: { id, slug, plan, createdAt, members: { [uuid]: 'admin'|'client'|'viewer' } } },
 *   demandes:   { [id]: {
 *     id, text, createdBy, createdAt, updatedAt,
 *     status:   'new'|'accepted'|'rejected'|'shipped',
 *     priority: 'low'|'medium'|'high'|'critical',
 *     assignee: string|null,
 *     tags:     string[],
 *     refs:     { [refId]: object },
 *     comments: { [commentId]: { authorUuid, text, ts, edited?, deleted? } },
 *     deleted:  boolean,
 *     deletedAt?: number,
 *     submittedAt?: number,
 *     submittedTo?: string,
 *     responseReceivedAt?: number,
 *     aiSummary?: string,
 *     aiTriage?:  object,
 *   } },
 *   devices: { [uuid]: { uuid, meta, firstSeenAt, lastSeenAt } },
 *   links:   { [peerUuid]: { peerUuid, peerRole, peerLabel, status:'pending'|'accepted'|'revoked', requestedAt, acceptedAt? } },
 * }
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};

  var TYPES = (root.MyFb.core.events && root.MyFb.core.events.TYPES) || null;
  // Fallback in case ordering is wonky in test envs — re-import lazily.
  function _T() {
    if (TYPES) return TYPES;
    TYPES = root.MyFb.core.events.TYPES;
    return TYPES;
  }

  function emptyState() {
    return {
      workspaces: {},
      demandes:   {},
      devices:    {},
      links:      {},
    };
  }

  // --- helpers ---------------------------------------------------------

  function _ensureDemande(state, id, e) {
    if (state.demandes[id]) return state.demandes[id];
    state.demandes[id] = {
      id:        id,
      text:      '',
      createdBy: e.actorUuid,
      createdAt: e.ts,
      updatedAt: e.ts,
      status:    'new',
      priority:  'medium',
      assignee:  null,
      tags:      [],
      refs:      {},
      comments:  {},
      deleted:   false,
    };
    return state.demandes[id];
  }

  // --- main reducer ----------------------------------------------------

  /**
   * Apply a single event to a state, returning a NEW state. Unknown event
   * types are silently passed through (forward-compatibility: an older
   * client receiving newer events shouldn't crash). Events with unknown
   * schemaVersion are also passed through.
   *
   * @param {object} state
   * @param {object} e   event wrapper
   * @returns {object} next state
   */
  function applyEvent(state, e) {
    var T = _T();
    if (!T) return state;
    // Forward-compat: skip events from a future schema we don't understand.
    if (typeof e.schemaVersion === 'number' && e.schemaVersion > 1) return state;

    // Clone shallow at top level; per-entity we'll mutate the clone — this
    // is internal data, not a public immutable interface.
    var s = {
      workspaces: Object.assign({}, state.workspaces),
      demandes:   Object.assign({}, state.demandes),
      devices:    Object.assign({}, state.devices),
      links:      Object.assign({}, state.links),
    };
    var p = e.payload || {};

    switch (e.type) {
      // ── Workspace ──────────────────────────────────────────────────
      case T.WORKSPACE_CREATED:
        s.workspaces[p.id] = {
          id:        p.id,
          slug:      p.slug || null,
          plan:      p.plan || 'free',
          createdAt: e.ts,
          members:   {},
        };
        if (e.actorUuid) s.workspaces[p.id].members[e.actorUuid] = 'admin';
        break;

      case T.WORKSPACE_MEMBER_ADDED:
        if (s.workspaces[p.workspaceId]) {
          s.workspaces[p.workspaceId] = Object.assign({}, s.workspaces[p.workspaceId]);
          s.workspaces[p.workspaceId].members = Object.assign({}, s.workspaces[p.workspaceId].members);
          s.workspaces[p.workspaceId].members[p.userUuid] = p.role || 'client';
        }
        break;

      case T.WORKSPACE_MEMBER_REMOVED:
        if (s.workspaces[p.workspaceId] && s.workspaces[p.workspaceId].members[p.userUuid]) {
          s.workspaces[p.workspaceId] = Object.assign({}, s.workspaces[p.workspaceId]);
          s.workspaces[p.workspaceId].members = Object.assign({}, s.workspaces[p.workspaceId].members);
          delete s.workspaces[p.workspaceId].members[p.userUuid];
        }
        break;

      case T.WORKSPACE_ROLE_CHANGED:
        if (s.workspaces[p.workspaceId]) {
          s.workspaces[p.workspaceId] = Object.assign({}, s.workspaces[p.workspaceId]);
          s.workspaces[p.workspaceId].members = Object.assign({}, s.workspaces[p.workspaceId].members);
          s.workspaces[p.workspaceId].members[p.userUuid] = p.role;
        }
        break;

      // ── Links ──────────────────────────────────────────────────────
      case T.LINK_REQUESTED:
        s.links[p.peerUuid] = {
          peerUuid:    p.peerUuid,
          peerRole:    p.peerRole || null,
          peerLabel:   p.peerLabel || null,
          status:      'pending',
          requestedAt: e.ts,
        };
        break;

      case T.LINK_ACCEPTED:
        if (s.links[p.peerUuid]) {
          s.links[p.peerUuid] = Object.assign({}, s.links[p.peerUuid], {
            status:     'accepted',
            acceptedAt: e.ts,
          });
        }
        break;

      case T.LINK_REVOKED:
        if (s.links[p.peerUuid]) {
          s.links[p.peerUuid] = Object.assign({}, s.links[p.peerUuid], { status: 'revoked' });
        }
        break;

      // ── Demande lifecycle ─────────────────────────────────────────
      case T.DEMANDE_CREATED: {
        var d = _ensureDemande(s, p.id, e);
        d.text     = p.text || '';
        d.url      = p.url  || null;
        break;
      }
      case T.DEMANDE_TEXT_UPDATED:
        if (s.demandes[p.id]) {
          s.demandes[p.id] = Object.assign({}, s.demandes[p.id], { text: p.text, updatedAt: e.ts });
        }
        break;

      case T.DEMANDE_DELETED:
        if (s.demandes[p.id]) {
          s.demandes[p.id] = Object.assign({}, s.demandes[p.id], { deleted: true, deletedAt: e.ts });
        }
        break;

      case T.DEMANDE_SUBMITTED:
        if (s.demandes[p.id]) {
          s.demandes[p.id] = Object.assign({}, s.demandes[p.id], {
            submittedAt: e.ts,
            submittedTo: p.target || null,
          });
        }
        break;

      case T.DEMANDE_RESPONSE_RECEIVED:
        if (s.demandes[p.id]) {
          s.demandes[p.id] = Object.assign({}, s.demandes[p.id], { responseReceivedAt: e.ts });
        }
        break;

      case T.DEMANDE_STATUS_CHANGED:
        if (s.demandes[p.id]) {
          s.demandes[p.id] = Object.assign({}, s.demandes[p.id], { status: p.status, updatedAt: e.ts });
        }
        break;

      case T.DEMANDE_PRIORITY_CHANGED:
        if (s.demandes[p.id]) {
          s.demandes[p.id] = Object.assign({}, s.demandes[p.id], { priority: p.priority, updatedAt: e.ts });
        }
        break;

      case T.DEMANDE_ASSIGNED:
        if (s.demandes[p.id]) {
          s.demandes[p.id] = Object.assign({}, s.demandes[p.id], { assignee: p.assignee, updatedAt: e.ts });
        }
        break;

      // ── Annotations ────────────────────────────────────────────────
      case T.DEMANDE_TAGGED:
        if (s.demandes[p.id]) {
          var tagsAdd = (s.demandes[p.id].tags || []).slice();
          if (tagsAdd.indexOf(p.tag) === -1) tagsAdd.push(p.tag);
          s.demandes[p.id] = Object.assign({}, s.demandes[p.id], { tags: tagsAdd, updatedAt: e.ts });
        }
        break;

      case T.DEMANDE_UNTAGGED:
        if (s.demandes[p.id]) {
          var tagsRem = (s.demandes[p.id].tags || []).filter(function (t) { return t !== p.tag; });
          s.demandes[p.id] = Object.assign({}, s.demandes[p.id], { tags: tagsRem, updatedAt: e.ts });
        }
        break;

      case T.DEMANDE_COMMENTED: {
        if (s.demandes[p.demandeId]) {
          var dc = Object.assign({}, s.demandes[p.demandeId]);
          dc.comments = Object.assign({}, dc.comments);
          dc.comments[p.commentId] = {
            authorUuid: e.actorUuid,
            text:       p.text || '',
            ts:         e.ts,
            // v2.5 — rich segment conversation (optional fields)
            mentions:    Array.isArray(p.mentions) ? p.mentions.slice() : undefined,
            target:      p.target || undefined,
            proposeText: typeof p.proposeText === 'string' && p.proposeText ? p.proposeText : undefined,
          };
          s.demandes[p.demandeId] = dc;
        }
        break;
      }

      case T.DEMANDE_COMMENT_EDITED:
        if (s.demandes[p.demandeId] && s.demandes[p.demandeId].comments[p.commentId]) {
          var de = Object.assign({}, s.demandes[p.demandeId]);
          de.comments = Object.assign({}, de.comments);
          var prev = de.comments[p.commentId];
          var patch = {};
          // Text-only edit (legacy + UI manual edit)
          if (typeof p.text === 'string') {
            patch.text = p.text;
            patch.edited = true;
          }
          // v2.5 — proposal lifecycle (accept / refuse). The reducer
          // accepts a flag-only payload so the proposal status can be
          // mutated without touching the comment body.
          if (p.proposalStatus === 'accepted' || p.proposalStatus === 'refused') {
            patch.proposalStatus = p.proposalStatus;
            if (p.proposalStatus === 'accepted') patch.acceptedBy = e.actorUuid;
            if (p.proposalStatus === 'refused')  patch.refusedBy  = e.actorUuid;
            patch.proposalResolvedAt = e.ts;
          }
          de.comments[p.commentId] = Object.assign({}, prev, patch);
          s.demandes[p.demandeId] = de;
        }
        break;

      case T.DEMANDE_COMMENT_DELETED:
        if (s.demandes[p.demandeId] && s.demandes[p.demandeId].comments[p.commentId]) {
          var dd = Object.assign({}, s.demandes[p.demandeId]);
          dd.comments = Object.assign({}, dd.comments);
          dd.comments[p.commentId] = Object.assign({}, dd.comments[p.commentId], { deleted: true });
          s.demandes[p.demandeId] = dd;
        }
        break;

      // ── Refs ───────────────────────────────────────────────────────
      case T.REF_ADDED: {
        if (s.demandes[p.demandeId]) {
          var dr = Object.assign({}, s.demandes[p.demandeId]);
          dr.refs = Object.assign({}, dr.refs);
          dr.refs[p.ref.id] = p.ref;
          dr.updatedAt = e.ts;
          s.demandes[p.demandeId] = dr;
        }
        break;
      }

      case T.REF_REMOVED:
        if (s.demandes[p.demandeId] && s.demandes[p.demandeId].refs[p.refId]) {
          var drr = Object.assign({}, s.demandes[p.demandeId]);
          drr.refs = Object.assign({}, drr.refs);
          delete drr.refs[p.refId];
          drr.updatedAt = e.ts;
          s.demandes[p.demandeId] = drr;
        }
        break;

      case T.REF_ANNOTATED:
        if (s.demandes[p.demandeId] && s.demandes[p.demandeId].refs[p.refId]) {
          var dra = Object.assign({}, s.demandes[p.demandeId]);
          dra.refs = Object.assign({}, dra.refs);
          dra.refs[p.refId] = Object.assign({}, dra.refs[p.refId], { annotations: p.annotations });
          s.demandes[p.demandeId] = dra;
        }
        break;

      // ── Devices ────────────────────────────────────────────────────
      case T.DEVICE_CONNECTED:
        if (!s.devices[p.uuid]) {
          s.devices[p.uuid] = {
            uuid:        p.uuid,
            meta:        p.meta || {},
            firstSeenAt: e.ts,
            lastSeenAt:  e.ts,
          };
        }
        break;

      case T.DEVICE_META_UPDATED:
        if (s.devices[p.uuid]) {
          s.devices[p.uuid] = Object.assign({}, s.devices[p.uuid], {
            meta:       p.meta,
            lastSeenAt: e.ts,
          });
        }
        break;

      // ── AI ─────────────────────────────────────────────────────────
      case T.AI_SUMMARY_GENERATED:
        if (s.demandes[p.demandeId]) {
          s.demandes[p.demandeId] = Object.assign({}, s.demandes[p.demandeId], { aiSummary: p.summary });
        }
        break;

      case T.AI_TRIAGE_SUGGESTED:
        if (s.demandes[p.demandeId]) {
          s.demandes[p.demandeId] = Object.assign({}, s.demandes[p.demandeId], { aiTriage: p.triage });
        }
        break;

      // ── Sync internals ─────────────────────────────────────────────
      case T.SYNC_SNAPSHOT_CREATED:
        // No state change — snapshots are materialization checkpoints
        // consumed by the sync layer, not the reducer.
        break;

      default:
        // Unknown event type — pass through (forward compat)
        break;
    }

    return s;
  }

  /**
   * Replay an entire event log to derive the current state.
   * Events MUST be passed in canonical order (see events.compare).
   * @param {object[]} events
   * @returns {object} state
   */
  function replay(events) {
    var s = emptyState();
    if (!events || !events.length) return s;
    for (var i = 0; i < events.length; i++) {
      s = applyEvent(s, events[i]);
    }
    return s;
  }

  root.MyFb.core.reducer = {
    emptyState: emptyState,
    applyEvent: applyEvent,
    replay:     replay,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MyFb.core.reducer;
  }
})(typeof window !== 'undefined' ? window : globalThis);
