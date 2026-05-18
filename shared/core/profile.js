// @ts-check
/**
 * My-Feedbacks Profile (user identity + role)
 *
 * The user picks a role at first run (admin/dev/agency OR client). This
 * file owns the data shape of that profile, its persistence (chrome.storage.sync
 * so it follows the user across their own Chromes), and the validation
 * rules.
 *
 * Linking (admin ↔ client) is intentionally NOT here — it's a separate
 * concern modelled as events (`link.requested`, `link.accepted`,
 * `link.revoked`) in the event store. This module only handles "who am I".
 *
 * Data shape:
 *   {
 *     uuid:        string,         // = STATE.deviceUuid, mirrored here for convenience
 *     role:        'admin' | 'client' | null,
 *     displayName: string,         // user-chosen, defaults to '' until wizard
 *     email:       string | null,  // optional, used for mailto: fallback only
 *     createdAt:   number,         // ms timestamp
 *     consent: {
 *       includeDeviceUuid:  boolean,  // opt-in to share UUID with peers
 *       includeDeviceMeta:  boolean,  // opt-in to share browser/OS/screen
 *       includeErrors:      boolean,  // opt-in to share JS errors
 *       includeBreadcrumbs: boolean,  // opt-in to share recent actions
 *       acceptedAt:         number | null,
 *     },
 *   }
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};

  var PROFILE_STORAGE_KEY = 'myfb:profile:v1';

  var VALID_ROLES = ['admin', 'client'];

  /**
   * Default consent for a fresh install. Admins (devs) get permissive
   * defaults since they're typically debugging their own work; clients
   * get a more restrictive default that excludes breadcrumbs (which
   * could leak workflow details from the page they're testing).
   *
   * @param {'admin'|'client'|null} role
   */
  function defaultConsent(role) {
    if (role === 'client') {
      return {
        includeDeviceUuid:  true,
        includeDeviceMeta:  true,
        includeErrors:      true,
        includeBreadcrumbs: false,
        acceptedAt:         null,
      };
    }
    // admin (or unknown) → all on, most context = best debugging
    return {
      includeDeviceUuid:  true,
      includeDeviceMeta:  true,
      includeErrors:      true,
      includeBreadcrumbs: true,
      acceptedAt:         null,
    };
  }

  /**
   * Build a fresh profile from a uuid and optional fields. Called by the
   * wizard on first run (or by tests).
   *
   * @param {{ uuid: string, role?: 'admin'|'client'|null, displayName?: string, email?: string|null, now?: () => number }} init
   */
  function create(init) {
    if (!init || typeof init.uuid !== 'string' || !init.uuid) {
      throw new Error('[MyFb profile] create() requires uuid');
    }
    var now = init.now || Date.now;
    var role = (init.role && VALID_ROLES.indexOf(init.role) >= 0) ? init.role : null;
    return {
      uuid:        init.uuid,
      role:        role,
      displayName: typeof init.displayName === 'string' ? init.displayName : '',
      email:       typeof init.email === 'string' ? init.email : null,
      createdAt:   now(),
      consent:     defaultConsent(role),
    };
  }

  /**
   * Validate an arbitrary value as a profile. Returns null if invalid,
   * or a clean normalized profile otherwise. Used when loading from
   * storage to defend against corrupted/older shapes.
   *
   * @param {any} candidate
   * @returns {object | null}
   */
  function validate(candidate) {
    if (!candidate || typeof candidate !== 'object') return null;
    if (typeof candidate.uuid !== 'string' || !candidate.uuid) return null;
    if (candidate.role !== null && VALID_ROLES.indexOf(candidate.role) < 0) return null;
    var consent = candidate.consent || {};
    return {
      uuid:        candidate.uuid,
      role:        candidate.role || null,
      displayName: typeof candidate.displayName === 'string' ? candidate.displayName : '',
      email:       typeof candidate.email === 'string' ? candidate.email : null,
      createdAt:   typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
      consent: {
        includeDeviceUuid:  consent.includeDeviceUuid  !== false,
        includeDeviceMeta:  consent.includeDeviceMeta  !== false,
        includeErrors:      consent.includeErrors      !== false,
        includeBreadcrumbs: !!consent.includeBreadcrumbs,
        acceptedAt:         typeof consent.acceptedAt === 'number' ? consent.acceptedAt : null,
      },
    };
  }

  /**
   * Apply a partial patch to a profile, validating the result.
   * Throws if the patch would produce an invalid profile.
   * @param {object} profile
   * @param {object} patch
   * @returns {object} the updated profile
   */
  function update(profile, patch) {
    if (!profile) throw new Error('[MyFb profile] update() requires base profile');
    var merged = Object.assign({}, profile, patch || {});
    if (patch && patch.consent) {
      merged.consent = Object.assign({}, profile.consent, patch.consent);
    }
    var v = validate(merged);
    if (!v) throw new Error('[MyFb profile] update() produced invalid profile');
    return v;
  }

  /**
   * Mark the consent screen as accepted with the given options.
   * @param {object} profile
   * @param {object} consentChoices
   */
  function acceptConsent(profile, consentChoices) {
    var next = Object.assign({}, profile.consent, consentChoices || {});
    next.acceptedAt = Date.now();
    return update(profile, { consent: next });
  }

  /** True if the user has been through the wizard (role + consent set). */
  function hasOnboarded(profile) {
    return !!(profile && profile.role && profile.consent && profile.consent.acceptedAt);
  }

  // ── chrome.storage.sync persistence ────────────────────────────────
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
   * Load the persisted profile from chrome.storage.sync (or undefined
   * if none yet — fresh install).
   * @returns {Promise<object | null>}
   */
  function load() {
    return _defaultImpl().get(PROFILE_STORAGE_KEY).then(function (out) {
      var raw = out && out[PROFILE_STORAGE_KEY];
      return raw ? validate(raw) : null;
    });
  }

  /**
   * Persist a profile. Caller is responsible for passing a validated
   * object (use create() or update() to build one).
   * @param {object} profile
   * @returns {Promise<void>}
   */
  function save(profile) {
    var v = validate(profile);
    if (!v) return Promise.reject(new Error('[MyFb profile] save() refused: invalid profile'));
    var toSet = {};
    toSet[PROFILE_STORAGE_KEY] = v;
    return _defaultImpl().set(toSet);
  }

  /**
   * Wipe the profile (used by the "régénérer mon identité" flow).
   * @returns {Promise<void>}
   */
  function clear() {
    return _defaultImpl().remove(PROFILE_STORAGE_KEY);
  }

  // ── Test seam ──────────────────────────────────────────────────────
  function __setStorageImpl(impl) { _impl = impl; }

  root.MyFb.core.profile = {
    PROFILE_STORAGE_KEY: PROFILE_STORAGE_KEY,
    VALID_ROLES:         VALID_ROLES,
    defaultConsent:      defaultConsent,
    create:              create,
    validate:            validate,
    update:              update,
    acceptConsent:       acceptConsent,
    hasOnboarded:        hasOnboarded,
    load:                load,
    save:                save,
    clear:               clear,
    __setStorageImpl:    __setStorageImpl,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MyFb.core.profile;
  }
})(typeof window !== 'undefined' ? window : globalThis);
