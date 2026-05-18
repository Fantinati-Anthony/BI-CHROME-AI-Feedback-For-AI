// @ts-check
/**
 * MyFb BlobStore — IndexedDB-backed storage for screenshot dataUrls.
 *
 * Why: chrome.storage.local has a 10 MB hard quota and is meant for small
 * settings, not for blobs. A single full-page PNG can be 1–3 MB ; 5
 * captures saturate the quota and persist() fails. IndexedDB has a
 * browser-default of ~50% of free disk → effectively unlimited for our
 * use case.
 *
 * Strategy: dataUrls are stored externally under a key derived from
 * timestamp + random suffix. The persisted demande ref keeps a `blobId`
 * pointer instead of the inline `dataUrl`. On hydrate / render, refs are
 * resolved back to dataUrls in memory only.
 *
 * Public API:
 *   await MyFbBlobStore.put(dataUrl)       → blobId
 *   await MyFbBlobStore.get(blobId)        → dataUrl | null
 *   await MyFbBlobStore.remove(blobId)     → boolean
 *   await MyFbBlobStore.gc(activeIds)      → number removed
 *   await MyFbBlobStore.size()             → bytes
 */
(function (window) {
  'use strict';

  var DB_NAME    = 'myfb';
  var STORE_NAME = 'blobs';
  var DB_VERSION = 1;
  var _dbPromise = null;

  function _open() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
    });
    return _dbPromise;
  }

  function _withStore(mode, fn) {
    return _open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, mode);
        var store = tx.objectStore(STORE_NAME);
        var result;
        Promise.resolve(fn(store, function (v) { result = v; })).catch(reject);
        tx.oncomplete = function () { resolve(result); };
        tx.onerror    = function () { reject(tx.error); };
      });
    });
  }

  function _newId() {
    return 'blob-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /** @param {string} dataUrl */
  function put(dataUrl) {
    if (!dataUrl) return Promise.resolve(null);
    var id = _newId();
    return _withStore('readwrite', function (store) {
      store.put({ id: id, dataUrl: dataUrl, ts: Date.now() });
    }).then(function () { return id; });
  }

  /** @param {string} id */
  function get(id) {
    if (!id) return Promise.resolve(null);
    return _withStore('readonly', function (store, set) {
      return new Promise(function (resolve, reject) {
        var req = store.get(id);
        req.onsuccess = function () { set(req.result ? req.result.dataUrl : null); resolve(); };
        req.onerror   = function () { reject(req.error); };
      });
    });
  }

  /** @param {string} id */
  function remove(id) {
    if (!id) return Promise.resolve(false);
    return _withStore('readwrite', function (store) { store.delete(id); }).then(function () { return true; });
  }

  /**
   * Garbage-collect blobs that are no longer referenced.
   * @param {string[]} activeIds — blobIds still referenced by STATE
   * @returns {Promise<number>} number of blobs removed
   */
  function gc(activeIds) {
    var keep = new Set(activeIds || []);
    var removed = 0;
    return _withStore('readwrite', function (store, set) {
      return new Promise(function (resolve, reject) {
        var req = store.openCursor();
        req.onsuccess = function () {
          var cur = req.result;
          if (!cur) { set(removed); resolve(); return; }
          if (!keep.has(cur.value.id)) { cur.delete(); removed++; }
          cur.continue();
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  /** @returns {Promise<number>} approximate total bytes */
  function size() {
    return _withStore('readonly', function (store, set) {
      return new Promise(function (resolve, reject) {
        var bytes = 0;
        var req = store.openCursor();
        req.onsuccess = function () {
          var cur = req.result;
          if (!cur) { set(bytes); resolve(); return; }
          bytes += (cur.value.dataUrl || '').length;
          cur.continue();
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  /** Resolves all blobIds in a demande's refs to inline dataUrls (in-memory). */
  function rehydrateRefs(refs) {
    if (!Array.isArray(refs)) return Promise.resolve(refs);
    var jobs = refs.map(function (r) {
      if (!r || !r.blobId || r.dataUrl) return Promise.resolve(r);
      return get(r.blobId).then(function (url) { if (url) r.dataUrl = url; return r; });
    });
    return Promise.all(jobs).then(function () { return refs; });
  }

  window.MyFbBlobStore = {
    put: put, get: get, remove: remove, gc: gc, size: size,
    rehydrateRefs: rehydrateRefs,
  };
})(window);
