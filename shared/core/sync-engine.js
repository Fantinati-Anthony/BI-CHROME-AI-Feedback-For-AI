// @ts-check
/**
 * My-Feedbacks Sync Engine
 *
 * Bridges the local event store (IndexedDB) with the active transport
 * (solo / shared-folder / self-hosted / cloud). Responsibilities :
 *
 *   - Subscribe to the transport — every remote event arriving via
 *     subscribe() is dedupped, appended to the local store, applied to
 *     the in-memory state, and the lamport clock is bumped via observe.
 *   - Pull on demand — `syncNow()` triggers an immediate fetch from the
 *     transport since the last known cursor.
 *   - Auto-pull at fixed interval (configurable, default 30 s) so the
 *     UI sees remote changes without manual action.
 *   - Push on emit — wraps ctx.emit() so newly emitted events are also
 *     pushed to the transport (already done by ctx.emit, but the engine
 *     adds error recovery + status reporting).
 *
 * Status surface :
 *   { state: 'idle'|'syncing'|'offline'|'error', lastPullAt, lastPushAt,
 *     pendingPush, lastError, peerCursor }
 *
 * Lifecycle :
 *   var engine = MyFb.core.syncEngine.create(ctx);
 *   await engine.start();
 *   …
 *   await engine.stop();
 *
 * Tests use a dependency-injected transport + store; production wires
 * to MyFb.runtime.
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};

  var DEFAULT_AUTO_PULL_MS = 30_000;
  var CURSOR_META_KEY      = 'sync.peerCursor';

  /**
   * @param {{
   *   store:     any,
   *   transport: any,
   *   lamport:   any,
   *   reducer:   any,
   *   eventsApi: any,
   *   getState:  () => object,
   *   setState:  (s: object) => void,
   * }} deps
   * @param {{ autoPullMs?: number }} [opts]
   */
  function create(deps, opts) {
    var st = {
      state:       'idle',
      lastPullAt:  null,
      lastPushAt:  null,
      pendingPush: 0,
      lastError:   null,
      peerCursor:  -1,
    };
    var _autoMs = (opts && opts.autoPullMs) || DEFAULT_AUTO_PULL_MS;
    var _autoTimer = null;
    var _unsub = null;
    var _seen = new Set();

    function _setStatus(state, err) {
      st.state = state;
      st.lastError = err || null;
    }

    /**
     * Ingest an incoming event from a remote peer. Idempotent —
     * dedupes against an in-memory seen-set AND the persistent store
     * (which also rejects duplicate ids).
     * @param {object} ev
     */
    function ingest(ev) {
      if (!ev || !deps.eventsApi.isValidEvent(ev)) return Promise.resolve();
      if (_seen.has(ev.id)) return Promise.resolve();
      _seen.add(ev.id);
      return deps.store.append([ev]).then(function (out) {
        if (out.inserted === 0) return; // store already had it
        deps.lamport.observe(ev.lamportTs);
        var nextState = deps.reducer.applyEvent(deps.getState(), ev);
        deps.setState(nextState);
        if (ev.lamportTs > st.peerCursor) st.peerCursor = ev.lamportTs;
      });
    }

    /**
     * Pull all events from the transport with lamportTs > peerCursor,
     * ingest them. Returns the count of events that were actually new.
     */
    function syncNow() {
      if (!deps.transport || typeof deps.transport.pull !== 'function') return Promise.resolve(0);
      _setStatus('syncing');
      return deps.transport.pull(st.peerCursor).then(function (events) {
        if (!Array.isArray(events) || events.length === 0) {
          _setStatus('idle');
          st.lastPullAt = Date.now();
          return 0;
        }
        // Sort canonical order, then ingest sequentially so the state
        // mutates correctly through the reducer.
        events.sort(deps.eventsApi.compare);
        return events.reduce(function (p, ev) {
          return p.then(function () { return ingest(ev); });
        }, Promise.resolve()).then(function () {
          // Persist updated peer cursor in the store meta for restart.
          return deps.store.metaSet(CURSOR_META_KEY, st.peerCursor);
        }).then(function () {
          st.lastPullAt = Date.now();
          _setStatus('idle');
          return events.length;
        });
      }).catch(function (err) {
        _setStatus('error', String(err && err.message || err));
        throw err;
      });
    }

    /**
     * Send a locally-emitted event through the transport. Called by the
     * engine's wrapper around ctx.emit (see attach()). Errors are
     * swallowed and surfaced in status — never throw to the UI.
     * @param {object} ev
     */
    function pushOne(ev) {
      if (!deps.transport || typeof deps.transport.push !== 'function') return Promise.resolve();
      st.pendingPush += 1;
      _setStatus('syncing');
      return deps.transport.push([ev]).then(function () {
        st.pendingPush = Math.max(0, st.pendingPush - 1);
        st.lastPushAt = Date.now();
        if (st.pendingPush === 0) _setStatus('idle');
      }).catch(function (err) {
        st.pendingPush = Math.max(0, st.pendingPush - 1);
        _setStatus('error', String(err && err.message || err));
      });
    }

    /**
     * Start the engine — wire transport.subscribe and start the auto-
     * pull timer. Idempotent.
     */
    function start() {
      if (_unsub) return Promise.resolve(); // already started
      if (deps.transport && typeof deps.transport.subscribe === 'function') {
        _unsub = deps.transport.subscribe(function (ev) { ingest(ev); });
      }
      // Restore cursor from meta + warm-up pull
      return deps.store.metaGet(CURSOR_META_KEY).then(function (saved) {
        if (typeof saved === 'number') st.peerCursor = saved;
        return syncNow().catch(function () {});
      }).then(function () {
        if (_autoMs > 0 && !_autoTimer) {
          _autoTimer = setInterval(function () { syncNow().catch(function () {}); }, _autoMs);
        }
      });
    }

    function stop() {
      if (_unsub) { try { _unsub(); } catch (_) {} _unsub = null; }
      if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; }
      _setStatus('idle');
      return Promise.resolve();
    }

    function status() {
      return Object.assign({}, st);
    }

    return {
      ingest:  ingest,
      syncNow: syncNow,
      pushOne: pushOne,
      start:   start,
      stop:    stop,
      status:  status,
      CURSOR_META_KEY: CURSOR_META_KEY,
    };
  }

  /**
   * Higher-level helper: wrap a runtime ctx (from bootstrap.init()) so
   * its emit() also pushes to the engine. Returns the engine instance.
   *
   * @param {object} ctx
   * @param {{ autoPullMs?: number }} [opts]
   */
  function attach(ctx, opts) {
    if (!ctx || !ctx.store || !ctx.transport || !ctx.lamport) {
      throw new Error('[MyFb sync-engine] attach() requires a booted ctx');
    }
    var reducer = root.MyFb && root.MyFb.core && root.MyFb.core.reducer;
    var events  = root.MyFb && root.MyFb.core && root.MyFb.core.events;
    if (!reducer || !events) throw new Error('[MyFb sync-engine] core modules not loaded');

    var engine = create({
      store:     ctx.store,
      transport: ctx.transport,
      lamport:   ctx.lamport,
      reducer:   reducer,
      eventsApi: events,
      getState:  function () { return ctx.state; },
      setState:  function (s) { ctx.state = s; },
    }, opts);

    // Wrap ctx.emit so locally-emitted events also push to remote
    var origEmit = ctx.emit;
    ctx.emit = function (type, payload) {
      return origEmit.call(ctx, type, payload).then(function (ev) {
        engine.pushOne(ev);
        return ev;
      });
    };

    ctx.engine = engine;
    return engine;
  }

  root.MyFb.core.syncEngine = {
    create: create,
    attach: attach,
    DEFAULT_AUTO_PULL_MS: DEFAULT_AUTO_PULL_MS,
    CURSOR_META_KEY:      CURSOR_META_KEY,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MyFb.core.syncEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
