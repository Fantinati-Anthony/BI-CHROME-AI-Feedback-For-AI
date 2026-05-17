// @ts-check
/**
 * My-Feedbacks Bootstrap
 *
 * Wires together the event-sourcing core, the device identity, and the
 * profile at startup. Single entry point that returns a fully-prepared
 * runtime context to the UI layer.
 *
 *   var ctx = await window.MyFb.core.bootstrap.init();
 *   // ctx = { uuid, profile, db, store, lamport, transport,
 *   //         emit(type, payload) → Promise<event>,
 *   //         state }
 *
 * Side effects on first run:
 *   - Generates and persists a device UUID
 *   - Emits a `device.connected` event with the current deviceMeta
 *   - Opens the IndexedDB connection
 *   - Hydrates the lamport clock from previous session
 *   - Picks transport: 'solo' until the user configures otherwise
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};

  var LAMPORT_META_KEY = 'lamport.counter';

  /**
   * @param {{ transport?: string, now?: () => number, dbName?: string }} [opts]
   */
  function init(opts) {
    var deviceMeta = root.MyFb.core.deviceMeta;
    var profileMod = root.MyFb.core.profile;
    var storeMod   = root.MyFb.core.store;
    var lamportMod = root.MyFb.core.lamport;
    var eventsMod  = root.MyFb.core.events;
    var reducerMod = root.MyFb.core.reducer;
    var transports = root.MyFb.core.transports;

    if (!deviceMeta || !profileMod || !storeMod || !lamportMod || !eventsMod || !reducerMod || !transports) {
      return Promise.reject(new Error('[MyFb bootstrap] core modules not loaded'));
    }

    var now = (opts && opts.now) || Date.now;
    var dbName = (opts && opts.dbName) || undefined;

    // 1. Open the IndexedDB connection
    return storeMod.openDb(dbName).then(function (db) {
      var store = storeMod.create(db);

      // 2. Hydrate the lamport clock from the last session
      return store.metaGet(LAMPORT_META_KEY).then(function (savedCounter) {
        var lamport = lamportMod.create(typeof savedCounter === 'number' ? savedCounter : 0);

        // 3. Resolve device UUID + load profile in parallel
        return Promise.all([
          deviceMeta.getOrCreateUuid(),
          profileMod.load(),
        ]).then(function (results) {
          var uuid    = results[0];
          var profile = results[1];

          // 4. If no profile exists yet, the wizard will create one. For
          //    now we just keep `profile = null` so the UI can detect it.

          // 5. Replay all events to derive current state
          return store.readSince(-1).then(function (events) {
            var state = reducerMod.replay(events);

            // 6. Emit device.connected on first run for this UUID
            var alreadyKnown = state.devices && state.devices[uuid];
            var emits = [];
            if (!alreadyKnown) {
              var meta = deviceMeta.collectDeviceMeta({ now: now });
              meta.uuid = uuid;
              var connectEvent = eventsMod.makeEvent(
                eventsMod.TYPES.DEVICE_CONNECTED,
                { uuid: uuid, meta: meta },
                { actorUuid: uuid, lamportTs: lamport.tick(), ts: now() }
              );
              emits.push(connectEvent);
            }

            return store.append(emits).then(function () {
              // 7. Apply locally-emitted events to state too
              var finalState = state;
              for (var i = 0; i < emits.length; i++) finalState = reducerMod.applyEvent(finalState, emits[i]);

              // 8. Persist the lamport counter
              return store.metaSet(LAMPORT_META_KEY, lamport.now()).then(function () {
                // 9. Pick a transport (default: solo)
                var transportName = (opts && opts.transport) || transports.TRANSPORTS.SOLO;
                var transport = _createTransport(transports, transportName);

                return {
                  uuid:      uuid,
                  profile:   profile,
                  db:        db,
                  store:     store,
                  lamport:   lamport,
                  transport: transport,
                  state:     finalState,
                  /**
                   * Emit a new event: build wrapper, persist, apply to
                   * state, push to transport. Returns the resulting event.
                   * @param {string} type
                   * @param {object} payload
                   * @returns {Promise<object>}
                   */
                  emit: function (type, payload) {
                    var e = eventsMod.makeEvent(type, payload, {
                      actorUuid: uuid,
                      lamportTs: lamport.tick(),
                      ts:        now(),
                    });
                    return store.append([e]).then(function () {
                      return store.metaSet(LAMPORT_META_KEY, lamport.now());
                    }).then(function () {
                      this.state = reducerMod.applyEvent(this.state, e);
                      return transport.push([e]).catch(function () { /* best-effort */ });
                    }.bind(this)).then(function () { return e; });
                  },
                };
              });
            });
          });
        });
      });
    });
  }

  function _createTransport(transports, name) {
    switch (name) {
      case transports.TRANSPORTS.SOLO:
        return transports.solo.create();
      case transports.TRANSPORTS.SHARED_FOLDER:
      case transports.TRANSPORTS.SELF_HOSTED:
      case transports.TRANSPORTS.CLOUD:
        // Not implemented yet (v1.2 / v1.3 / v2.0) — fall back to solo
        // so the UI keeps working instead of crashing.
        return transports.solo.create();
      default:
        return transports.solo.create();
    }
  }

  root.MyFb.core.bootstrap = {
    LAMPORT_META_KEY: LAMPORT_META_KEY,
    init:             init,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MyFb.core.bootstrap;
  }
})(typeof window !== 'undefined' ? window : globalThis);
