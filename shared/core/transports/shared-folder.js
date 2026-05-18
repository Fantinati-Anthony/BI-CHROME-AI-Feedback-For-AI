// @ts-check
/**
 * My-Feedbacks Transport — Shared Folder (tier 2, gratuit)
 *
 * Both admin and client point their extension at the SAME folder
 * (typically a shared Google Drive / Dropbox / OneDrive directory).
 * Each install reads/writes an append-only JSONL file in that folder
 * to sync events.
 *
 * File layout:
 *   <user-chosen-folder>/
 *   ├─ events.jsonl        # one JSON event per line, append-only
 *   └─ meta.json           # optional sync cursors, written by each peer
 *
 * Sync algorithm:
 *   - Pull: read the entire JSONL, return entries with id not in our
 *     local "seen ids" set.
 *   - Push: append each new event as a line. Idempotent because
 *     consumers dedup by event.id.
 *   - Subscribe: poll every 10 seconds (configurable).
 *
 * Requires:
 *   - window.showDirectoryPicker (File System Access API)
 *   - Chrome 86+ (we ship Chrome MV3, so guaranteed)
 *   - Persisted handle via IndexedDB (Chrome 122+) recommended; we
 *     re-ask on every session otherwise.
 *
 * This implementation is INTENTIONALLY conservative: best-effort error
 * handling, no fancy locking, no merge conflict UI. The append-only
 * JSONL + idempotent event ids gives us conflict-freedom for free.
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};
  root.MyFb.core.transports = root.MyFb.core.transports || {};

  var EVENTS_FILE = 'events.jsonl';
  var POLL_MS     = 10_000;

  /**
   * @returns {import('./interface.js').Transport}
   */
  function create() {
    /** @type {{ state: 'idle'|'syncing'|'offline'|'error', detail?: string }} */
    var _status = { state: 'idle' };
    /** @type {any} */
    var _dirHandle = null;
    /** @type {Set<string>} */
    var _seenIds = new Set();
    /** @type {((e: object) => void) | null} */
    var _subscriber = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    var _pollHandle = null;
    /** @type {{ poll?: number, dirHandle?: any, fileName?: string }} */
    var _config = {};

    function _setStatus(state, detail) {
      _status = detail ? { state: state, detail: detail } : { state: state };
    }

    function _events() {
      return root.MyFb && root.MyFb.core && root.MyFb.core.events;
    }

    /**
     * @param {{ poll?: number, dirHandle?: any, fileName?: string }} [config]
     */
    function init(config) {
      _config = config || {};
      _dirHandle = _config.dirHandle || null;
      if (!_dirHandle) {
        _setStatus('error', 'no directory handle');
        return Promise.reject(new Error('shared-folder transport requires a dirHandle in config'));
      }
      _setStatus('idle');
      // Kick off initial pull + start polling.
      return pull(-1).then(function (events) {
        if (_subscriber && events.length) events.forEach(_subscriber);
        _startPolling();
      });
    }

    function _startPolling() {
      if (_pollHandle) return;
      var interval = _config.poll || POLL_MS;
      _pollHandle = setInterval(function () {
        if (!_subscriber) return;
        _setStatus('syncing');
        pull(-1).then(function (events) {
          events.forEach(_subscriber);
          _setStatus('idle');
        }).catch(function (err) {
          _setStatus('error', String(err && err.message || err));
        });
      }, interval);
    }

    /**
     * Append events to events.jsonl. Idempotent on the receiver side via
     * event.id dedup, so we don't bother filtering here.
     * @param {object[]} events
     */
    function push(events) {
      if (!Array.isArray(events) || events.length === 0) return Promise.resolve();
      if (!_dirHandle) return Promise.reject(new Error('not initialized'));
      _setStatus('syncing');
      return _appendLines(events.map(function (e) { return JSON.stringify(e); }))
        .then(function () {
          events.forEach(function (e) { if (e && e.id) _seenIds.add(e.id); });
          _setStatus('idle');
        })
        .catch(function (err) {
          _setStatus('error', String(err && err.message || err));
          throw err;
        });
    }

    /**
     * Read the JSONL file and return events with lamportTs > since
     * (and not already seen).
     * @param {number} since
     * @returns {Promise<object[]>}
     */
    function pull(since) {
      if (!_dirHandle) return Promise.resolve([]);
      var cutoff = typeof since === 'number' ? since : -1;
      var ev = _events();
      return _readAllLines().then(function (lines) {
        var out = [];
        lines.forEach(function (line) {
          if (!line) return;
          var entry;
          try { entry = JSON.parse(line); } catch (_) { return; }
          if (!entry || !entry.id) return;
          if (_seenIds.has(entry.id)) return;
          if (ev && !ev.isValidEvent(entry)) return;
          if (cutoff >= 0 && entry.lamportTs <= cutoff) {
            // Still mark as seen so we don't re-process on subsequent polls.
            _seenIds.add(entry.id);
            return;
          }
          _seenIds.add(entry.id);
          out.push(entry);
        });
        if (ev) out.sort(ev.compare);
        return out;
      });
    }

    /**
     * @param {(e: object) => void} cb
     */
    function subscribe(cb) {
      _subscriber = cb;
      return function () { _subscriber = null; };
    }

    function status() { return _status; }

    function dispose() {
      if (_pollHandle) { clearInterval(_pollHandle); _pollHandle = null; }
      _subscriber = null;
      _seenIds = new Set();
      _setStatus('idle');
      return Promise.resolve();
    }

    // ── Low-level file I/O via File System Access API ────────────────

    function _fileName() { return _config.fileName || EVENTS_FILE; }

    function _appendLines(lines) {
      return _dirHandle.getFileHandle(_fileName(), { create: true }).then(function (fh) {
        return fh.getFile().then(function (existing) {
          return existing.text();
        }).then(function (prev) {
          var combined = (prev || '') + lines.join('\n') + '\n';
          return fh.createWritable().then(function (w) {
            return w.write(combined).then(function () { return w.close(); });
          });
        });
      });
    }

    function _readAllLines() {
      return _dirHandle.getFileHandle(_fileName(), { create: true }).then(function (fh) {
        return fh.getFile();
      }).then(function (file) {
        return file.text();
      }).then(function (txt) {
        return (txt || '').split(/\r?\n/);
      }).catch(function () { return []; });
    }

    return {
      init:      init,
      push:      push,
      pull:      pull,
      subscribe: subscribe,
      status:    status,
      dispose:   dispose,
    };
  }

  root.MyFb.core.transports.sharedFolder = { create: create, EVENTS_FILE: EVENTS_FILE };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { create: create, EVENTS_FILE: EVENTS_FILE };
  }
})(typeof window !== 'undefined' ? window : globalThis);
