// @ts-check
/**
 * My-Feedbacks Runtime — boot orchestration
 *
 * Single entry point called from the side panel on DOMContentLoaded.
 * Wires together:
 *   1. Core bootstrap (event store + lamport + uuid + profile)
 *   2. First-launch onboarding (if no profile yet)
 *   3. Exposes the runtime ctx at window.MyFb.runtime
 *
 * Idempotent — calling boot() twice is a no-op.
 *
 * This file deliberately does NOT touch the existing legacy state /
 * sidepanel/storage.js / sidepanel/session.js code paths. Those continue
 * to work exactly as before. The runtime is purely additive for v1.0.0,
 * and the legacy layer will migrate to consume the runtime in v1.2+.
 */

(function (window) {
  'use strict';

  var _booted = false;
  var _bootPromise = null;

  /**
   * Boot the runtime. Returns a promise that resolves with the ctx.
   * Calling multiple times returns the same promise.
   *
   * Errors are caught and logged — the rest of the side panel continues
   * to work via the legacy code path. This is critical: a broken IDB or
   * a missing API must NEVER prevent the user from using the extension.
   *
   * @returns {Promise<object|null>}
   */
  function boot() {
    if (_bootPromise) return _bootPromise;
    _booted = true;
    _bootPromise = _doBoot().catch(function (e) {
      // Best-effort: log and degrade gracefully.
      try { console.warn('[MyFb runtime] boot failed, falling back to legacy:', e && e.message); } catch (_) {}
      return null;
    });
    return _bootPromise;
  }

  function _doBoot() {
    var bootstrapMod = window.MyFb && window.MyFb.core && window.MyFb.core.bootstrap;
    if (!bootstrapMod) {
      return Promise.reject(new Error('core.bootstrap not loaded'));
    }
    return bootstrapMod.init().then(function (ctx) {
      // Stash on the namespace so other modules can reach it.
      window.MyFb.runtime = ctx;
      // Wire the sync engine — wraps ctx.emit so locally-emitted
      // events also push to the transport, and subscribes to remote
      // events from the transport.
      var syncMod = window.MyFb.core && window.MyFb.core.syncEngine;
      if (syncMod) {
        try {
          var engine = syncMod.attach(ctx);
          // Start the engine in the background — failures are surfaced
          // in engine.status() and the UI shows them in Settings → Sync.
          engine.start().catch(function () {});
        } catch (_) { /* solo transport may not need the engine; ignore */ }
      }
      // Pairing handler — auto-accepts link.requested events whose
      // fingerprint matches our UUID.
      var pairingHandlerMod = window.MyFb.core && window.MyFb.core.pairingHandler;
      if (pairingHandlerMod && ctx.uuid) {
        try { pairingHandlerMod.attach(ctx); } catch (_) {}
      }
      // First-launch onboarding gate.
      if (window.MyFbOnboarding && window.MyFbOnboarding.shouldOpen(ctx.profile)) {
        // Defer to next frame so the panel has rendered first.
        requestAnimationFrame(function () {
          window.MyFbOnboarding.open(ctx, function () {
            // After onboarding closes, reload the profile and update ctx
            var P = window.MyFb && window.MyFb.core && window.MyFb.core.profile;
            if (P) {
              P.load().then(function (profile) {
                if (ctx) ctx.profile = profile;
              }).catch(function () {});
            }
          });
        });
      }
      return ctx;
    });
  }

  /**
   * Re-open the onboarding manually (from a "Reset onboarding" button in
   * Settings, for instance).
   */
  function reopenOnboarding() {
    var ctx = window.MyFb && window.MyFb.runtime;
    if (!ctx || !window.MyFbOnboarding) return;
    window.MyFbOnboarding.open(ctx, function () {});
  }

  /** True once boot() has been called (regardless of success). */
  function isBooted() { return _booted; }

  window.MyFb = window.MyFb || {};
  window.MyFb.runtimeBoot = {
    boot:             boot,
    reopenOnboarding: reopenOnboarding,
    isBooted:         isBooted,
  };
})(window);
