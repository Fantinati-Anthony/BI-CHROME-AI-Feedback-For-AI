// @ts-check
/**
 * My-Feedbacks Event Catalog
 *
 * Every state mutation in the app is expressed as an immutable event. The
 * full state is derived by replaying these events through `reducer.js`. This
 * pattern (event sourcing) makes sync, undo, audit log, and multi-device
 * trivial — at the cost of having to design events upfront.
 *
 * Each event has a stable wrapper shape; the `payload` varies by `type`.
 *
 * ┌─ Wrapper ───────────────────────────────────────────────────────────┐
 * │ {                                                                    │
 * │   id:            string,    // UUIDv4 — globally unique               │
 * │   type:          string,    // see TYPES below                        │
 * │   payload:       object,    // varies per type                        │
 * │   ts:            number,    // wall-clock ms (display only)           │
 * │   lamportTs:     number,    // logical clock (sync order)             │
 * │   actorUuid:     string,    // who emitted this event                 │
 * │   schemaVersion: number,    // forward-compat: unknown versions skip  │
 * │ }                                                                    │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Ordering between two events for sync:
 *   (lamportTs ASC, id ASC) — deterministic and convergent across peers.
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};

  /** Current event schema version. Bump when changing the wrapper shape. */
  var SCHEMA_VERSION = 1;

  /**
   * Enum-like dictionary of every event type the app understands.
   * Adding a new type:
   *   1. Add an entry here
   *   2. Add a handler in reducer.js
   *   3. (Optional) Add a creator helper in this file
   */
  var TYPES = Object.freeze({
    // Workspace lifecycle
    WORKSPACE_CREATED:        'workspace.created',
    WORKSPACE_MEMBER_ADDED:   'workspace.member_added',
    WORKSPACE_MEMBER_REMOVED: 'workspace.member_removed',
    WORKSPACE_ROLE_CHANGED:   'workspace.role_changed',

    // Pairing (admin ↔ client, N:N)
    LINK_REQUESTED: 'link.requested',
    LINK_ACCEPTED:  'link.accepted',
    LINK_REVOKED:   'link.revoked',

    // Demande lifecycle
    DEMANDE_CREATED:           'demande.created',
    DEMANDE_TEXT_UPDATED:      'demande.text_updated',
    DEMANDE_DELETED:           'demande.deleted',
    DEMANDE_SUBMITTED:         'demande.submitted',
    DEMANDE_RESPONSE_RECEIVED: 'demande.response_received',
    DEMANDE_STATUS_CHANGED:    'demande.status_changed',
    DEMANDE_PRIORITY_CHANGED:  'demande.priority_changed',
    DEMANDE_ASSIGNED:          'demande.assigned',

    // Annotations
    DEMANDE_TAGGED:           'demande.tagged',
    DEMANDE_UNTAGGED:         'demande.untagged',
    DEMANDE_COMMENTED:        'demande.commented',
    DEMANDE_COMMENT_EDITED:   'demande.comment_edited',
    DEMANDE_COMMENT_DELETED:  'demande.comment_deleted',

    // Refs (element pick, screenshot, error, annotation)
    REF_ADDED:     'ref.added',
    REF_REMOVED:   'ref.removed',
    REF_ANNOTATED: 'ref.annotated',

    // Device
    DEVICE_CONNECTED:    'device.connected',
    DEVICE_META_UPDATED: 'device.meta_updated',

    // AI
    AI_SUMMARY_GENERATED:  'ai.summary_generated',
    AI_TRIAGE_SUGGESTED:   'ai.triage_suggested',

    // Sync internals
    SYNC_SNAPSHOT_CREATED: 'sync.snapshot_created',
  });

  /** Reverse lookup: is a given string a known event type? */
  var KNOWN_TYPES = new Set(Object.values(TYPES));

  /**
   * Generate a UUIDv4 using crypto.randomUUID() when available, fallback to
   * a Math.random()-based generator (only used in old test environments).
   * @returns {string}
   */
  function uuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Build an event wrapper around a typed payload. Validates the type and
   * stamps an id + ts + schemaVersion. The lamportTs must be provided by
   * the caller (typically via Lamport.tick()) so the clock stays
   * monotonic across the whole app.
   *
   * @param {string} type
   * @param {object} payload
   * @param {{ actorUuid: string, lamportTs: number, ts?: number, id?: string }} ctx
   * @returns {object} event
   */
  function makeEvent(type, payload, ctx) {
    if (!KNOWN_TYPES.has(type)) {
      throw new Error('[MyFb events] unknown event type: ' + type);
    }
    if (!ctx || typeof ctx.actorUuid !== 'string' || !ctx.actorUuid) {
      throw new Error('[MyFb events] makeEvent requires ctx.actorUuid');
    }
    if (!ctx || typeof ctx.lamportTs !== 'number') {
      throw new Error('[MyFb events] makeEvent requires ctx.lamportTs (number)');
    }
    return {
      id:            ctx.id || uuid(),
      type:          type,
      payload:       payload || {},
      ts:            typeof ctx.ts === 'number' ? ctx.ts : Date.now(),
      lamportTs:     ctx.lamportTs,
      actorUuid:     ctx.actorUuid,
      schemaVersion: SCHEMA_VERSION,
    };
  }

  /**
   * Deterministic comparator for sync ordering. Returns negative if `a`
   * comes before `b`, positive if after, 0 if equal.
   * @param {object} a
   * @param {object} b
   * @returns {number}
   */
  function compare(a, b) {
    if (a.lamportTs !== b.lamportTs) return a.lamportTs - b.lamportTs;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  }

  /**
   * Cheap shape validator. Returns true if the event has the minimum
   * fields the rest of the system relies on. Used at sync boundaries to
   * reject obviously corrupt input.
   * @param {*} e
   * @returns {boolean}
   */
  function isValidEvent(e) {
    return !!(e &&
      typeof e.id === 'string' && e.id.length > 0 &&
      typeof e.type === 'string' &&
      typeof e.lamportTs === 'number' &&
      typeof e.actorUuid === 'string' && e.actorUuid.length > 0 &&
      typeof e.schemaVersion === 'number' &&
      e.payload && typeof e.payload === 'object'
    );
  }

  root.MyFb.core.events = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    TYPES:          TYPES,
    KNOWN_TYPES:    KNOWN_TYPES,
    uuid:           uuid,
    makeEvent:      makeEvent,
    compare:        compare,
    isValidEvent:   isValidEvent,
  };

  // Node/test environment export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MyFb.core.events;
  }
})(typeof window !== 'undefined' ? window : globalThis);
