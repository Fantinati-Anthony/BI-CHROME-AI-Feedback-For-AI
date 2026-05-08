/**
 * BIAIF Storage
 *
 * Handles hydration, persistence, and versioned migration.
 *
 * Version model:
 *   - The storage KEY itself includes a version (`biaif:v04:state`).
 *   - The persisted payload also carries a `_v` field with the integer
 *     version of the schema. New persists always stamp the current
 *     version. Old payloads without `_v` are treated as v1.
 *
 * Migration pipeline:
 *   - `_MIGRATIONS` is an ordered registry [{ from, to, run }, ...]. On
 *     hydrate, if the saved `_v` is older than `CURRENT_VERSION`, the
 *     pipeline runs each step in order. Each step receives and returns
 *     a payload object — pure transformation, no side effects.
 *
 * Quota guard: strips dataUrls from screenshots when the full save fails.
 */
(function (window) {
  'use strict';

  var KEY        = (window.BIAIF && window.BIAIF.STORAGE_KEY)        || 'biaif:v04:state';
  var LEGACY     = (window.BIAIF && window.BIAIF.STORAGE_LEGACY_KEYS) || ['biaif:v03:state'];
  var MAX_BYTES  = 8 * 1024 * 1024; // warn at 8 MB (limit is 10 MB)

  // ── Schema version ───────────────────────────────────────────────────────
  // Bump on every breaking change to the persisted shape. Add a corresponding
  // entry to _MIGRATIONS that transforms `from` → `to`.
  var CURRENT_VERSION = 1;

  // Registry of migrations between schema versions. Each step:
  //   { from: <int>, to: <int>, run: (payload) => payload }
  // Steps must be idempotent and must not mutate their input — return a new
  // object. Order matters: applied in array order.
  var _MIGRATIONS = [
    // Example for the future:
    //   { from: 1, to: 2, run: function (p) { return Object.assign({}, p, { newField: defaultValue }); } },
  ];

  function _runMigrations(saved) {
    var currentV = (saved && typeof saved._v === 'number') ? saved._v : 1;
    if (currentV === CURRENT_VERSION) return saved;
    var p = saved;
    for (var i = 0; i < _MIGRATIONS.length; i++) {
      var step = _MIGRATIONS[i];
      if (currentV !== step.from) continue;
      try {
        p = step.run(p) || p;
        currentV = step.to;
        if (window.BIAIF && window.BIAIF.log) {
          window.BIAIF.log.info('[storage] migrated v' + step.from + ' → v' + step.to);
        }
      } catch (e) {
        // Migration failed — keep the data as-is to avoid corruption.
        console.warn('[BIAIF Storage] migration v' + step.from + ' → v' + step.to + ' failed:', e && e.message);
        break;
      }
    }
    p = Object.assign({}, p, { _v: currentV });
    return p;
  }

  // -----------------------------------------------------------------------
  // Hydrate
  // -----------------------------------------------------------------------
  async function hydrate(STATE, onDone) {
    try {
      var obj  = await chrome.storage.local.get([KEY].concat(LEGACY));
      var saved = obj[KEY] || _migrateLegacy(obj);
      if (!saved) { if (onDone) onDone(); return; }

      // Run any registered schema migrations in order before applying.
      saved = _runMigrations(saved);

      if (Array.isArray(saved.demandes))             STATE.demandes       = saved.demandes;
      if (saved.currentDemande && typeof saved.currentDemande.text === 'string') {
        STATE.currentDemande = {
          text:    saved.currentDemande.text,
          refs:    Array.isArray(saved.currentDemande.refs) ? saved.currentDemande.refs : [],
          pageUrl: saved.currentDemande.pageUrl || null,
        };
      }
      if (typeof saved.lang       === 'string')      STATE.lang           = saved.lang;
      if (typeof saved.micDeviceId === 'string')     STATE.micDeviceId    = saved.micDeviceId;
      if (saved.sortOrder === 'asc' || saved.sortOrder === 'desc') STATE.sortOrder = saved.sortOrder;
      if (typeof saved.segFontSize === 'number' && saved.segFontSize >= 8 && saved.segFontSize <= 16)
        STATE.segFontSize = saved.segFontSize;
      if (saved.visibleButtons && typeof saved.visibleButtons === 'object')
        STATE.visibleButtons = Object.assign({}, STATE.visibleButtons, saved.visibleButtons);
      if (typeof saved.uiLang === 'string' && saved.uiLang) STATE.uiLang = saved.uiLang;
      if (typeof saved.autoOpenOnKnownActive  === 'boolean') STATE.autoOpenOnKnownActive  = saved.autoOpenOnKnownActive;
      if (typeof saved.autoOpenOnKnownDone    === 'boolean') STATE.autoOpenOnKnownDone    = saved.autoOpenOnKnownDone;
      if (typeof saved.autoOpenOnAiPage       === 'boolean') STATE.autoOpenOnAiPage       = saved.autoOpenOnAiPage;
      if (typeof saved.hideAiTextarea         === 'boolean') STATE.hideAiTextarea         = saved.hideAiTextarea;
      if (typeof saved.autoSubmitAfterInject  === 'boolean') STATE.autoSubmitAfterInject  = saved.autoSubmitAfterInject;
      if (typeof saved.archiveExpanded        === 'boolean') STATE.archiveExpanded        = saved.archiveExpanded;
      if (typeof saved.showConsoleBtn         === 'boolean') STATE.showConsoleBtn         = saved.showConsoleBtn;
      if (saved.topbarPosition === 'top' || saved.topbarPosition === 'bottom') STATE.topbarPosition = saved.topbarPosition;

    } catch (e) {
      console.warn('[BIAIF Storage] hydrate failed', e && e.message);
    }
    if (onDone) onDone();
  }

  // -----------------------------------------------------------------------
  // Persist (with undo snapshot + quota fallback)
  // -----------------------------------------------------------------------
  function persist(STATE, opts) {
    // Push undo snapshot before saving (skipped during undo replay).
    if (window.BIAIFUndo && (!opts || !opts.skipUndo)) {
      window.BIAIFUndo.push({
        demandes:       JSON.parse(JSON.stringify(STATE.demandes)),
        currentDemande: JSON.parse(JSON.stringify(STATE.currentDemande)),
      });
    }

    var payload = _buildPayload(STATE);

    chrome.storage.local.set({ [KEY]: payload }).then(function () {
      _checkQuota();
    }).catch(function () {
      // Fallback: strip screenshot dataUrls to save space
      var slim = _stripDataUrls(payload);
      chrome.storage.local.set({ [KEY]: slim }).catch(function () {
        console.warn('[BIAIF Storage] persist failed even after stripping images');
      });
    });

    // Remove legacy keys silently
    chrome.storage.local.remove(LEGACY).catch(function () {});
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  function _buildPayload(STATE) {
    return {
      _v:                    CURRENT_VERSION,
      demandes:              STATE.demandes,
      currentDemande:        STATE.currentDemande,
      lang:                  STATE.lang,
      micDeviceId:           STATE.micDeviceId,
      sortOrder:             STATE.sortOrder,
      segFontSize:           STATE.segFontSize,
      visibleButtons:        STATE.visibleButtons,
      uiLang:                STATE.uiLang,
      autoOpenOnKnownActive: STATE.autoOpenOnKnownActive,
      autoOpenOnKnownDone:   STATE.autoOpenOnKnownDone,
      autoOpenOnAiPage:      STATE.autoOpenOnAiPage,
      hideAiTextarea:        STATE.hideAiTextarea,
      autoSubmitAfterInject: STATE.autoSubmitAfterInject,
      archiveExpanded:       STATE.archiveExpanded,
      showConsoleBtn:        STATE.showConsoleBtn,
      topbarPosition:        STATE.topbarPosition,
    };
  }

  function _stripDataUrls(payload) {
    function stripRefs(refs) {
      return (refs || []).map(function (r) {
        return r.type === 'screenshot' ? Object.assign({}, r, { dataUrl: null }) : r;
      });
    }
    return Object.assign({}, payload, {
      demandes: (payload.demandes || []).map(function (d) {
        return Object.assign({}, d, { refs: stripRefs(d.refs) });
      }),
      currentDemande: Object.assign({}, payload.currentDemande, {
        refs: stripRefs(payload.currentDemande && payload.currentDemande.refs),
      }),
    });
  }

  function _migrateLegacy(obj) {
    for (var i = 0; i < LEGACY.length; i++) {
      if (obj[LEGACY[i]]) {
        console.log('[BIAIF Storage] migrating from', LEGACY[i], '→', KEY);
        return obj[LEGACY[i]];
      }
    }
    return null;
  }

  async function _checkQuota() {
    try {
      var usage = await chrome.storage.local.getBytesInUse(null);
      if (usage > MAX_BYTES) {
        console.warn('[BIAIF Storage] quota warning: ' + Math.round(usage / 1024) + ' KB used');
        if (window.BIAIFToast) {
          var mb = Math.round(usage / 1024 / 1024 * 10) / 10;
          var msg = (window.BIAIFi18n && window.BIAIFi18n.t)
            ? window.BIAIFi18n.t('toast.storage_warning', { mb: mb })
            : 'Stockage presque plein (' + mb + ' MB).';
          window.BIAIFToast.show(msg, 'error', 8000);
        }
      }
    } catch (_) {}
  }

  window.BIAIFStorage = { hydrate: hydrate, persist: persist };

})(window);
