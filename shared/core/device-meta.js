// @ts-check
/**
 * My-Feedbacks Device Identity & Metadata
 *
 * Each install gets a persistent UUID stored in chrome.storage.sync (so
 * it follows the user across their own Chromes) — this is the device's
 * stable identifier across all events the install emits.
 *
 * On every demande submit, a rich `deviceMeta` snapshot is collected so
 * the receiving end (admin reading a client's feedback) sees the full
 * environment context : browser, OS, viewport, network, preferences,
 * etc. Far richer than what the addon captured before — see PRIVACY.md
 * for what's collected vs not.
 *
 * Data shape:
 *
 *   {
 *     uuid, capturedAt,
 *     browser:     { name, version },
 *     os:          { name, version },
 *     viewport:    { w, h },
 *     dpr,
 *     deviceClass: 'desktop' | 'tablet' | 'mobile',
 *     screen:      { w, h, colorDepth, orientation },
 *     hardware:    { memory, cores, maxTouchPoints },
 *     preferences: { colorScheme, reducedMotion, zoom },
 *     network:     { online, type, downlink, saveData },
 *     locale:      { language, languages, timezone, timezoneOffset },
 *     performance: { usedJSHeap?, totalJSHeap?, jsHeapLimit?, navTiming? },
 *   }
 *
 * Everything is collected from synchronous browser APIs except the UUID
 * fetch which is async (chrome.storage.sync.get).
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};

  var UUID_STORAGE_KEY = 'myfb:device:uuid';

  /**
   * Generate a fresh UUIDv4. Same helper as in events/catalog.js but kept
   * private here to avoid a load-order dependency at content-script time.
   * @returns {string}
   */
  function _uuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ── chrome.storage.sync abstraction (testable) ──────────────────────
  // Tests can override via __setStorageImpl(); production uses chrome.storage.sync.
  var _impl = null;
  function _defaultImpl() {
    if (_impl) return _impl;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      _impl = {
        get: function (key) {
          return new Promise(function (resolve) {
            chrome.storage.sync.get(key, function (out) { resolve(out); });
          });
        },
        set: function (obj) {
          return new Promise(function (resolve) {
            chrome.storage.sync.set(obj, function () { resolve(); });
          });
        },
        remove: function (key) {
          return new Promise(function (resolve) {
            chrome.storage.sync.remove(key, function () { resolve(); });
          });
        },
      };
    } else {
      // Fallback: in-memory (tests / non-extension envs)
      var mem = {};
      _impl = {
        get: function (key) {
          var out = {};
          if (mem[key] !== undefined) out[key] = mem[key];
          return Promise.resolve(out);
        },
        set: function (obj) {
          Object.keys(obj).forEach(function (k) { mem[k] = obj[k]; });
          return Promise.resolve();
        },
        remove: function (key) {
          delete mem[key];
          return Promise.resolve();
        },
      };
    }
    return _impl;
  }

  /**
   * Return the persistent device UUID, generating + persisting it on
   * first call. Calls after the first return the same value within the
   * session (cached in memory) AND across sessions (chrome.storage.sync).
   *
   * @returns {Promise<string>}
   */
  var _cachedUuid = null;
  function getOrCreateUuid() {
    if (_cachedUuid) return Promise.resolve(_cachedUuid);
    var impl = _defaultImpl();
    return impl.get(UUID_STORAGE_KEY).then(function (out) {
      var existing = out && out[UUID_STORAGE_KEY];
      if (typeof existing === 'string' && existing.length > 0) {
        _cachedUuid = existing;
        return existing;
      }
      var fresh = _uuid();
      _cachedUuid = fresh;
      var toSet = {};
      toSet[UUID_STORAGE_KEY] = fresh;
      return impl.set(toSet).then(function () { return fresh; });
    });
  }

  /**
   * Force regenerate the UUID (user explicitly asked, e.g. "anonymous
   * mode" or "I'm handing this laptop over").
   * @returns {Promise<string>}
   */
  function regenerateUuid() {
    var fresh = _uuid();
    _cachedUuid = fresh;
    var toSet = {};
    toSet[UUID_STORAGE_KEY] = fresh;
    return _defaultImpl().set(toSet).then(function () { return fresh; });
  }

  // ── UA parsing (browser + OS) ──────────────────────────────────────
  // Conservative heuristics — enough for "Chrome 120 · macOS 14" labels,
  // not for fingerprinting precision. The full UA is also stored for
  // edge cases.

  /** @returns {{ name: string, version: string }} */
  function _detectBrowser(ua) {
    if (/Edg\//.test(ua))            return { name: 'Edge',    version: (ua.match(/Edg\/([\d.]+)/)    || [])[1] || '' };
    if (/OPR\//.test(ua))            return { name: 'Opera',   version: (ua.match(/OPR\/([\d.]+)/)    || [])[1] || '' };
    if (/Brave/i.test(ua))           return { name: 'Brave',   version: (ua.match(/Chrome\/([\d.]+)/) || [])[1] || '' };
    if (/Chrome\//.test(ua))         return { name: 'Chrome',  version: (ua.match(/Chrome\/([\d.]+)/) || [])[1] || '' };
    if (/Firefox\//.test(ua))        return { name: 'Firefox', version: (ua.match(/Firefox\/([\d.]+)/)|| [])[1] || '' };
    if (/Safari\//.test(ua))         return { name: 'Safari',  version: (ua.match(/Version\/([\d.]+)/)|| [])[1] || '' };
    return { name: 'Unknown', version: '' };
  }

  /** @returns {{ name: string, version: string }} */
  function _detectOS(ua) {
    if (/Windows NT 10/.test(ua))    return { name: 'Windows', version: '10/11' };
    if (/Windows NT 6.3/.test(ua))   return { name: 'Windows', version: '8.1'   };
    if (/Windows NT/.test(ua))       return { name: 'Windows', version: '?'     };
    if (/Mac OS X/.test(ua))         return { name: 'macOS',   version: (ua.match(/Mac OS X ([\d_.]+)/) || [])[1]?.replace(/_/g, '.') || '' };
    if (/Android/.test(ua))          return { name: 'Android', version: (ua.match(/Android ([\d.]+)/)   || [])[1] || '' };
    if (/iPhone|iPad|iPod/.test(ua)) return { name: 'iOS',     version: (ua.match(/OS ([\d_]+)/)        || [])[1]?.replace(/_/g, '.') || '' };
    if (/Linux/.test(ua))            return { name: 'Linux',   version: '' };
    return { name: 'Unknown', version: '' };
  }

  /** @returns {'desktop' | 'tablet' | 'mobile'} */
  function _detectDeviceClass(ua, viewportW, touchPoints) {
    if (/Mobi|Android.*Mobile|iPhone/.test(ua)) return 'mobile';
    if (/iPad|Tablet|Android(?!.*Mobile)/.test(ua)) return 'tablet';
    if (touchPoints > 0 && viewportW < 900)      return 'mobile';
    if (touchPoints > 0 && viewportW < 1280)     return 'tablet';
    return 'desktop';
  }

  // ── Safe accessors for optional/proprietary APIs ───────────────────

  function _safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (_) { return fallback; }
  }

  function _orientation() {
    return _safe(function () {
      if (screen.orientation && screen.orientation.type) return screen.orientation.type;
      return undefined;
    }, undefined);
  }

  function _colorScheme() {
    return _safe(function () {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
      return 'no-preference';
    }, 'no-preference');
  }

  function _reducedMotion() {
    return _safe(function () {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }, false);
  }

  function _zoom() {
    return _safe(function () {
      // outerWidth/innerWidth ratio approximates browser zoom (with caveats).
      if (!window.outerWidth || !window.innerWidth) return 1;
      var z = window.outerWidth / window.innerWidth;
      // Round to 2 decimals for stability
      return Math.round(z * 100) / 100;
    }, 1);
  }

  function _connection() {
    return _safe(function () {
      var nav = /** @type {any} */ (navigator);
      var c = nav.connection || nav.mozConnection || nav.webkitConnection;
      if (!c) return undefined;
      return {
        type:      c.effectiveType || null,
        downlink:  typeof c.downlink === 'number' ? c.downlink : null,
        saveData:  !!c.saveData,
      };
    }, undefined);
  }

  function _performanceSnapshot() {
    return _safe(function () {
      var out = {};
      var p = /** @type {any} */ (performance);
      if (p && p.memory) {
        out.usedJSHeap   = p.memory.usedJSHeapSize;
        out.totalJSHeap  = p.memory.totalJSHeapSize;
        out.jsHeapLimit  = p.memory.jsHeapSizeLimit;
      }
      if (p && typeof p.getEntriesByType === 'function') {
        var nav = p.getEntriesByType('navigation')[0];
        if (nav) {
          out.navTiming = {
            ttfb:     Math.round(nav.responseStart),
            domReady: Math.round(nav.domContentLoadedEventEnd),
            loaded:   Math.round(nav.loadEventEnd),
          };
        }
      }
      return Object.keys(out).length ? out : undefined;
    }, undefined);
  }

  /**
   * Collect a full device metadata snapshot. Synchronous — call from the
   * point where you need it (e.g. just before persisting a demande). The
   * UUID is NOT included here on purpose — call getOrCreateUuid()
   * separately, since it's async.
   *
   * @param {{ now?: () => number }} [opts]
   * @returns {object}
   */
  function collectDeviceMeta(opts) {
    var now = (opts && opts.now) || Date.now;
    var ua  = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    var browser = _detectBrowser(ua);
    var os      = _detectOS(ua);

    var viewport = {
      w: _safe(function () { return window.innerWidth;  }, 0),
      h: _safe(function () { return window.innerHeight; }, 0),
    };
    var dpr = _safe(function () { return window.devicePixelRatio || 1; }, 1);
    var maxTouchPoints = _safe(function () { return navigator.maxTouchPoints || 0; }, 0);
    var deviceClass = _detectDeviceClass(ua, viewport.w, maxTouchPoints);

    var meta = {
      capturedAt: now(),
      browser:    browser,
      os:         os,
      viewport:   viewport,
      dpr:        dpr,
      deviceClass: deviceClass,
      screen: {
        w:           _safe(function () { return screen.width;       }, 0),
        h:           _safe(function () { return screen.height;      }, 0),
        colorDepth:  _safe(function () { return screen.colorDepth;  }, 24),
        orientation: _orientation(),
      },
      hardware: {
        memory:         _safe(function () { return (/** @type {any} */ (navigator)).deviceMemory; }, undefined),
        cores:          _safe(function () { return navigator.hardwareConcurrency; }, undefined),
        maxTouchPoints: maxTouchPoints,
      },
      preferences: {
        colorScheme:   _colorScheme(),
        reducedMotion: _reducedMotion(),
        zoom:          _zoom(),
      },
      network: Object.assign(
        { online: _safe(function () { return navigator.onLine; }, true) },
        _connection() || {}
      ),
      locale: {
        language:       _safe(function () { return navigator.language;             }, ''),
        languages:      _safe(function () { return Array.from(navigator.languages || []); }, []),
        timezone:       _safe(function () { return Intl.DateTimeFormat().resolvedOptions().timeZone; }, ''),
        timezoneOffset: _safe(function () { return new Date().getTimezoneOffset();  }, 0),
      },
      performance: _performanceSnapshot(),
      ua:          ua,
    };

    // Strip undefined leaves so the JSON stays compact.
    if (meta.performance === undefined) delete meta.performance;
    if (meta.hardware.memory === undefined) delete meta.hardware.memory;
    if (meta.hardware.cores  === undefined) delete meta.hardware.cores;
    if (meta.screen.orientation === undefined) delete meta.screen.orientation;

    return meta;
  }

  /**
   * Anonymized variant — strips identifying fields. Used when the user
   * opts into "anonymous feedback" mode.
   * @param {object} meta
   * @returns {object}
   */
  function anonymize(meta) {
    if (!meta) return meta;
    var copy = JSON.parse(JSON.stringify(meta));
    if (copy.locale)  delete copy.locale.timezone;
    if (copy.locale)  delete copy.locale.timezoneOffset;
    if (copy.locale)  delete copy.locale.languages;
    if (copy.network) { delete copy.network.downlink; delete copy.network.type; }
    if (copy.hardware) delete copy.hardware.memory;
    if (copy.preferences) delete copy.preferences.zoom;
    if (copy.performance) delete copy.performance;
    delete copy.ua;
    delete copy.screen;
    return copy;
  }

  // ── Test seam ──────────────────────────────────────────────────────
  function __setStorageImpl(impl) {
    _impl = impl;
    _cachedUuid = null;
  }
  function __resetCache() { _cachedUuid = null; }

  root.MyFb.core.deviceMeta = {
    UUID_STORAGE_KEY:  UUID_STORAGE_KEY,
    getOrCreateUuid:   getOrCreateUuid,
    regenerateUuid:    regenerateUuid,
    collectDeviceMeta: collectDeviceMeta,
    anonymize:         anonymize,
    __setStorageImpl:  __setStorageImpl,
    __resetCache:      __resetCache,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MyFb.core.deviceMeta;
  }
})(typeof window !== 'undefined' ? window : globalThis);
