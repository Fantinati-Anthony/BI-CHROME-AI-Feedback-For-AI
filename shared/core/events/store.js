// @ts-check
/**
 * My-Feedbacks Event Store (IndexedDB-backed)
 *
 * Append-only, indexed by `lamportTs`. Uses raw IndexedDB to keep zero
 * runtime dependencies — Dexie would buy us migrations and prettier API
 * but is overkill at this stage (~50 lines of code is fine).
 *
 * Schema (object stores):
 *   - events   : keyPath 'id', index 'lamport' on 'lamportTs'
 *   - meta     : keyPath 'k' — small key/value store for clock state etc.
 *
 * Idempotent put(): a duplicate id is silently ignored. This makes sync
 * conflict-free since two peers can push the same event without anyone
 * needing to coordinate.
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};

  var DB_NAME    = 'my-feedbacks';
  var DB_VERSION = 1;

  /**
   * Open the IndexedDB database. Idempotent: returns the same connection
   * for subsequent calls within a session.
   * @param {string} [dbName]
   * @returns {Promise<IDBDatabase>}
   */
  function openDb(dbName) {
    var name = dbName || DB_NAME;
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(name, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('events')) {
          var s = db.createObjectStore('events', { keyPath: 'id' });
          s.createIndex('lamport', 'lamportTs', { unique: false });
          s.createIndex('type',    'type',      { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'k' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
    });
  }

  function _txStore(db, storeName, mode) {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function _wrap(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
    });
  }

  /**
   * Create a store instance bound to an open db handle. Caller owns the
   * lifecycle (call openDb once at startup, reuse the handle).
   * @param {IDBDatabase} db
   */
  function create(db) {
    return {
      /**
       * Append events to the log. Existing ids are silently skipped
       * (idempotent — safe to replay any incoming sync batch).
       * @param {object[]} events
       * @returns {Promise<{ inserted: number, skipped: number }>}
       */
      append: function (events) {
        if (!Array.isArray(events) || events.length === 0) {
          return Promise.resolve({ inserted: 0, skipped: 0 });
        }
        return new Promise(function (resolve, reject) {
          var tx = db.transaction('events', 'readwrite');
          var store = tx.objectStore('events');
          var inserted = 0;
          var skipped  = 0;
          var pending  = events.length;
          if (pending === 0) return resolve({ inserted: 0, skipped: 0 });
          events.forEach(function (e) {
            var req = store.add(e);
            req.onsuccess = function () {
              inserted += 1;
              if (--pending === 0) resolve({ inserted: inserted, skipped: skipped });
            };
            req.onerror = function (ev) {
              // ConstraintError = duplicate id; ignore. Anything else bubbles.
              if (req.error && req.error.name === 'ConstraintError') {
                skipped += 1;
                ev.preventDefault();
                ev.stopPropagation();
                if (--pending === 0) resolve({ inserted: inserted, skipped: skipped });
                return;
              }
              reject(req.error);
            };
          });
          tx.onerror = function () { reject(tx.error); };
        });
      },

      /**
       * Read all events with lamportTs > since, ordered ascending by
       * (lamportTs, id). Use since=-1 to read everything.
       * @param {number} since
       * @returns {Promise<object[]>}
       */
      readSince: function (since) {
        var cutoff = typeof since === 'number' ? since : -1;
        return new Promise(function (resolve, reject) {
          var out = [];
          var tx = db.transaction('events', 'readonly');
          var idx = tx.objectStore('events').index('lamport');
          // IDBKeyRange.lowerBound(cutoff, true) means exclusive of cutoff
          var range = cutoff >= 0 ? IDBKeyRange.lowerBound(cutoff, true) : null;
          var req = idx.openCursor(range);
          req.onsuccess = function () {
            var cur = req.result;
            if (cur) { out.push(cur.value); cur.continue(); }
            else {
              // Index orders by lamportTs only; sort by (lamportTs, id) for
              // determinism when two events share the same lamportTs.
              out.sort(function (a, b) {
                if (a.lamportTs !== b.lamportTs) return a.lamportTs - b.lamportTs;
                if (a.id < b.id) return -1;
                if (a.id > b.id) return 1;
                return 0;
              });
              resolve(out);
            }
          };
          req.onerror = function () { reject(req.error); };
        });
      },

      /**
       * Total event count (cheap — uses IndexedDB count()).
       * @returns {Promise<number>}
       */
      count: function () {
        return _wrap(_txStore(db, 'events', 'readonly').count());
      },

      /**
       * Drop everything (events + meta). Used by tests and by the
       * "reset module" flow.
       * @returns {Promise<void>}
       */
      clear: function () {
        return Promise.all([
          _wrap(_txStore(db, 'events', 'readwrite').clear()),
          _wrap(_txStore(db, 'meta',   'readwrite').clear()),
        ]).then(function () {});
      },

      /**
       * KV helpers on the `meta` store (e.g. lamport clock persistence,
       * lastSyncedEventId per peer).
       */
      metaGet: function (k) {
        return _wrap(_txStore(db, 'meta', 'readonly').get(k)).then(function (row) {
          return row ? row.v : undefined;
        });
      },
      metaSet: function (k, v) {
        return _wrap(_txStore(db, 'meta', 'readwrite').put({ k: k, v: v })).then(function () {});
      },
    };
  }

  root.MyFb.core.store = {
    DB_NAME:    DB_NAME,
    DB_VERSION: DB_VERSION,
    openDb:     openDb,
    create:     create,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MyFb.core.store;
  }
})(typeof window !== 'undefined' ? window : globalThis);
