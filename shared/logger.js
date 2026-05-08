// @ts-check
/**
 * BIAIF Logger
 *
 * Levelled logger usable in service worker, side panel, and content scripts.
 * Default level is 'warn' so production stays quiet. Set
 *
 *   localStorage.BIAIF_LOG_LEVEL = 'debug'   // sidepanel / content world
 *
 * to enable verbose output. The SW reads `chrome.storage.local.biaif_log_level`
 * (set the same value via DevTools to debug background flows).
 *
 * API:
 *   BIAIF.log.debug(...args)
 *   BIAIF.log.info(...args)
 *   BIAIF.log.warn(...args)
 *   BIAIF.log.error(...args)
 *   BIAIF.log.setLevel('debug' | 'info' | 'warn' | 'error' | 'silent')
 *   BIAIF.log.scope('feature') → { debug, info, warn, error } prefixed
 */
(function (root) {
  'use strict';
  root.BIAIF = root.BIAIF || {};

  var LEVELS  = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
  var current = LEVELS.warn;

  function _readInitialLevel() {
    // 1) localStorage (sidepanel / content)
    try {
      if (typeof localStorage !== 'undefined' && localStorage.BIAIF_LOG_LEVEL) {
        var lvl = String(localStorage.BIAIF_LOG_LEVEL).toLowerCase();
        if (LEVELS[lvl] !== undefined) current = LEVELS[lvl];
      }
    } catch (_) {}
    // 2) chrome.storage (any context — async, non-blocking)
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['biaif_log_level']).then(function (o) {
          var v = o && o.biaif_log_level;
          if (v && LEVELS[String(v).toLowerCase()] !== undefined) {
            current = LEVELS[String(v).toLowerCase()];
          }
        }).catch(function () {});
      }
    } catch (_) {}
  }
  _readInitialLevel();

  function _emit(method, level, args) {
    if (level < current) return;
    if (typeof console === 'undefined' || !console[method]) return;
    // Prefix every line with [BIAIF] for easy filtering
    try { console[method].apply(console, ['[BIAIF]'].concat(Array.prototype.slice.call(args))); }
    catch (_) {}
  }

  function setLevel(name) {
    var lvl = LEVELS[String(name || '').toLowerCase()];
    if (lvl !== undefined) current = lvl;
  }

  function scope(prefix) {
    var tag = '[' + prefix + ']';
    return {
      debug: function () { _emit('debug', LEVELS.debug, [tag].concat(Array.prototype.slice.call(arguments))); },
      info:  function () { _emit('info',  LEVELS.info,  [tag].concat(Array.prototype.slice.call(arguments))); },
      warn:  function () { _emit('warn',  LEVELS.warn,  [tag].concat(Array.prototype.slice.call(arguments))); },
      error: function () { _emit('error', LEVELS.error, [tag].concat(Array.prototype.slice.call(arguments))); },
    };
  }

  root.BIAIF.log = {
    debug: function () { _emit('debug', LEVELS.debug, arguments); },
    info:  function () { _emit('info',  LEVELS.info,  arguments); },
    warn:  function () { _emit('warn',  LEVELS.warn,  arguments); },
    error: function () { _emit('error', LEVELS.error, arguments); },
    setLevel: setLevel,
    scope:    scope,
    // Expose levels for introspection / tests
    LEVELS:   LEVELS,
  };

})(typeof window !== 'undefined' ? window : self);
