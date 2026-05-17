/**
 * MyFb Storage
 *
 * Handles hydration, persistence, and versioned migration.
 *
 * Version model:
 *   - The storage KEY itself includes a version (`myfb:v1:state`).
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

  var KEY        = (window.MyFb && window.MyFb.STORAGE_KEY)        || 'myfb:v1:state';
  var LEGACY     = (window.MyFb && window.MyFb.STORAGE_LEGACY_KEYS) || ['myfb:v03:state'];
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
        if (window.MyFb && window.MyFb.log) {
          window.MyFb.log.info('[storage] migrated v' + step.from + ' → v' + step.to);
        }
      } catch (e) {
        // Migration failed — keep the data as-is to avoid corruption.
        console.warn('[MyFb Storage] migration v' + step.from + ' → v' + step.to + ' failed:', e && e.message);
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
      if (saved.theme === 'dark' || saved.theme === 'light' || saved.theme === 'auto') STATE.theme = saved.theme;
      if (Array.isArray(saved.templates)) STATE.templates = saved.templates;
      if (typeof saved.privacyScrub === 'boolean') STATE.privacyScrub = saved.privacyScrub;
      if (typeof saved.syncEnabled  === 'boolean') STATE.syncEnabled  = saved.syncEnabled;

    } catch (e) {
      console.warn('[MyFb Storage] hydrate failed', e && e.message);
    }
    // Hand control back to the caller IMMEDIATELY so the panel renders
    // (with skeleton placeholders for screenshots). Rehydrate IndexedDB
    // blobs in the background and re-render when they're ready.
    if (onDone) onDone();
    if (window.MyFbBlobStore) {
      try {
        var allRefs = (STATE.demandes || []).reduce(function (acc, d) {
          return acc.concat(d.refs || []);
        }, (STATE.currentDemande && STATE.currentDemande.refs) || []);
        var hadBlobIds = allRefs.some(function (r) { return r && r.blobId && !r.dataUrl; });
        if (hadBlobIds) {
          window.MyFbBlobStore.rehydrateRefs(allRefs).then(function () {
            // Re-render to swap skeletons for the actual thumbnails.
            if (window.MyFbRenderer) {
              if (window.MyFbRenderer.renderSegments)         window.MyFbRenderer.renderSegments();
              if (window.MyFbRenderer.renderDemandeRefsStrip) window.MyFbRenderer.renderDemandeRefsStrip();
            }
          }).catch(function () {});
        }
        // GC blobs that no longer have a referencing ref in STATE.
        var alive = allRefs.map(function (r) { return r && r.blobId; }).filter(Boolean);
        window.MyFbBlobStore.gc(alive).catch(function () {});
      } catch (_) {}
    }
  }

  // -----------------------------------------------------------------------
  // Persist (with undo snapshot + quota fallback)
  // -----------------------------------------------------------------------
  function persist(STATE, opts) {
    // Push undo snapshot before saving (skipped during undo replay).
    if (window.MyFbUndo && (!opts || !opts.skipUndo)) {
      window.MyFbUndo.push({
        demandes:       JSON.parse(JSON.stringify(STATE.demandes)),
        currentDemande: JSON.parse(JSON.stringify(STATE.currentDemande)),
      });
    }

    var payload = _buildPayload(STATE);
    // For refs that have an IndexedDB blobId, drop the inline dataUrl
    // before persist. We re-resolve on hydrate.
    payload = _externalizeBlobs(payload);

    chrome.storage.local.set({ [KEY]: payload }).then(function () {
      _checkQuota();
    }).catch(function () {
      // Fallback: strip screenshot dataUrls to save space
      var slim = _stripDataUrls(payload);
      chrome.storage.local.set({ [KEY]: slim }).catch(function () {
        console.warn('[MyFb Storage] persist failed even after stripping images');
      });
    });

    // Cross-device sync (settings + templates only — never blobs).
    if (STATE.syncEnabled && chrome.storage.sync) {
      var syncPayload = _buildSyncPayload(STATE);
      _setSyncDot('syncing');
      chrome.storage.sync.set({ [SYNC_KEY]: syncPayload })
        .then(function () { _setSyncDot('ok'); })
        .catch(function (err) {
          console.warn('[MyFb Storage] sync failed:', err && err.message);
          _setSyncDot('error');
        });
    } else if (!STATE.syncEnabled) {
      _setSyncDot('off');
    }

    // Remove legacy keys silently
    chrome.storage.local.remove(LEGACY).catch(function () {});
  }

  // ─── Cross-device sync (chrome.storage.sync) ─────────────────────
  // Quota: 100 KB total, 8 KB per item. We cap templates and exclude
  // all heavy/transient data. Keep this list small and human-curated.

  function _setSyncDot(status) {
    var dot = document.getElementById('sync-dot');
    if (dot) dot.dataset.status = status;
  }

  var SYNC_KEY = 'myfb:sync';
  var SYNC_KEYS_WHITELIST = [
    'lang','uiLang','sortOrder','segFontSize','visibleButtons',
    'autoOpenOnKnownActive','autoOpenOnKnownDone','autoOpenOnAiPage',
    'hideAiTextarea','autoSubmitAfterInject','archiveExpanded',
    'showConsoleBtn','topbarPosition','theme','privacyScrub',
  ];
  function _buildSyncPayload(STATE) {
    var out = { _v: CURRENT_VERSION, _ts: Date.now() };
    SYNC_KEYS_WHITELIST.forEach(function (k) {
      if (STATE[k] !== undefined) out[k] = STATE[k];
    });
    // Templates capped at first ~20 entries to stay well under 8 KB
    if (Array.isArray(STATE.templates)) out.templates = STATE.templates.slice(0, 20);
    return out;
  }
  function pullFromSync(STATE) {
    if (!chrome.storage.sync) return Promise.resolve(false);
    return chrome.storage.sync.get(SYNC_KEY).then(function (obj) {
      var d = obj && obj[SYNC_KEY];
      if (!d) return false;
      SYNC_KEYS_WHITELIST.forEach(function (k) { if (d[k] !== undefined) STATE[k] = d[k]; });
      if (Array.isArray(d.templates)) STATE.templates = d.templates;
      return true;
    });
  }

  // Live cross-device sync — listen for changes pushed from another machine
  // and merge them into STATE without losing local-only fields. Last-write
  // wins for any whitelisted key; for templates we replace wholesale (the
  // sync payload always carries the full list).
  function watchSync(STATE, onPulled) {
    if (!chrome.storage || !chrome.storage.onChanged) return function () {};
    var lastTs = 0;
    var listener = function (changes, area) {
      if (area !== 'sync' || !changes[SYNC_KEY]) return;
      var d = changes[SYNC_KEY].newValue;
      if (!d || typeof d !== 'object') return;
      // Ignore the change we just wrote ourselves (loop-back)
      if (d._ts && d._ts <= lastTs) return;
      lastTs = d._ts || Date.now();
      var changed = false;
      SYNC_KEYS_WHITELIST.forEach(function (k) {
        if (d[k] !== undefined && JSON.stringify(STATE[k]) !== JSON.stringify(d[k])) {
          STATE[k] = d[k]; changed = true;
        }
      });
      if (Array.isArray(d.templates) && JSON.stringify(STATE.templates) !== JSON.stringify(d.templates)) {
        STATE.templates = d.templates; changed = true;
      }
      if (changed && typeof onPulled === 'function') onPulled();
    };
    chrome.storage.onChanged.addListener(listener);
    return function () { chrome.storage.onChanged.removeListener(listener); };
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
      theme:                 STATE.theme,
      templates:             STATE.templates,
      privacyScrub:          STATE.privacyScrub,
      syncEnabled:           STATE.syncEnabled,
    };
  }

  // Strip inline dataUrls only from refs that have a blobId pointer.
  // The bytes already live in IndexedDB → no info loss.
  function _externalizeBlobs(payload) {
    function externalize(refs) {
      return (refs || []).map(function (r) {
        if (r && r.blobId && r.dataUrl) return Object.assign({}, r, { dataUrl: null });
        return r;
      });
    }
    return Object.assign({}, payload, {
      demandes: (payload.demandes || []).map(function (d) {
        return Object.assign({}, d, { refs: externalize(d.refs) });
      }),
      currentDemande: Object.assign({}, payload.currentDemande, {
        refs: externalize(payload.currentDemande && payload.currentDemande.refs),
      }),
    });
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
        console.log('[MyFb Storage] migrating from', LEGACY[i], '→', KEY);
        return obj[LEGACY[i]];
      }
    }
    return null;
  }

  async function _checkQuota() {
    try {
      var usage = await chrome.storage.local.getBytesInUse(null);
      if (usage > MAX_BYTES) {
        console.warn('[MyFb Storage] quota warning: ' + Math.round(usage / 1024) + ' KB used');
        if (window.MyFbToast) {
          var mb = Math.round(usage / 1024 / 1024 * 10) / 10;
          var msg = (window.MyFbI18n && window.MyFbI18n.t)
            ? window.MyFbI18n.t('toast.storage_warning', { mb: mb })
            : 'Stockage presque plein (' + mb + ' MB).';
          window.MyFbToast.show(msg, 'error', 8000);
        }
      }
    } catch (_) {}
  }

  // -----------------------------------------------------------------------
  // Export / Import (community feature — share configs & histories)
  // -----------------------------------------------------------------------
  function exportToFile(STATE, opts) {
    opts = opts || {};
    var payload = _buildPayload(STATE);
    // Deep-clone so scrubbing/stripping doesn't mutate the live STATE
    payload = JSON.parse(JSON.stringify(payload));
    var bundle  = {
      _myfb:    'export',
      _version:  CURRENT_VERSION,
      _exportTs: Date.now(),
      _stripDataUrls: !!opts.stripDataUrls,
      _scrubbed: !!(window.MyFbScrub && window.MyFbScrub.isEnabled(STATE)),
      data:      payload,
    };
    // SCRUB: redact PII/secrets if enabled (default ON)
    if (bundle._scrubbed && bundle.data.demandes) {
      bundle.data.demandes.forEach(window.MyFbScrub.scrubDemande);
      if (bundle.data.currentDemande) window.MyFbScrub.scrubDemande(bundle.data.currentDemande);
    }
    if (opts.stripDataUrls && bundle.data.demandes) {
      bundle.data.demandes = bundle.data.demandes.map(function (d) {
        return Object.assign({}, d, { refs: (d.refs || []).map(function (r) {
          return r && r.dataUrl ? Object.assign({}, r, { dataUrl: null, _stripped: true }) : r;
        }) });
      });
    }
    var json = JSON.stringify(bundle, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);
    var ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    var a    = document.createElement('a');
    a.href = url; a.download = 'myfb-export-' + ts + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    return bundle;
  }

  // ─── Schema validation ────────────────────────────────────────────
  var MAX_TEXT       = 50000;
  var MAX_REFS_PER   = 100;
  var MAX_DEMANDES   = 5000;
  var MAX_TEMPLATES  = 1000;
  var URL_RE         = /^(https?:\/\/|file:\/\/|chrome:\/\/)/i;
  var DATAURL_RE     = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i;

  function _isStr(v, max)  { return typeof v === 'string' && v.length <= (max || MAX_TEXT); }
  function _isUrl(v)       { return v == null || (typeof v === 'string' && v.length < 2048 && (URL_RE.test(v) || v === '')); }
  function _isDataUrl(v)   { return v == null || (typeof v === 'string' && (DATAURL_RE.test(v) || v.length === 0)); }

  function _validRef(r) {
    if (!r || typeof r !== 'object') return false;
    if (typeof r.type !== 'string' || r.type.length > 32) return false;
    if (r.dataUrl !== undefined && !_isDataUrl(r.dataUrl)) return false;
    if (r.tabUrl !== undefined && !_isUrl(r.tabUrl)) return false;
    if (r.srcUrl !== undefined && !_isUrl(r.srcUrl)) return false;
    if (r.selector !== undefined && !_isStr(r.selector, 2000)) return false;
    return true;
  }
  function _validDemande(d) {
    if (!d || typeof d !== 'object') return false;
    if (typeof d.text !== 'string' || d.text.length > MAX_TEXT) return false;
    if (!Array.isArray(d.refs) || d.refs.length > MAX_REFS_PER) return false;
    if (!d.refs.every(_validRef)) return false;
    if (d.url !== undefined && !_isUrl(d.url)) return false;
    if (d.conversationUrl !== undefined && !_isUrl(d.conversationUrl)) return false;
    if (d.tags !== undefined) {
      if (!Array.isArray(d.tags) || d.tags.length > 10) return false;
      if (!d.tags.every(function (t) { return typeof t === 'string' && t.length <= 32; })) return false;
    }
    return true;
  }
  function _validTemplate(t) {
    if (!t || typeof t !== 'object') return false;
    if (!_isStr(t.name, 200)) return false;
    if (!_isStr(t.body, 4000)) return false;
    return true;
  }
  function _validateBundle(bundle) {
    if (!bundle || typeof bundle !== 'object') return { ok: false, error: 'not-an-object' };
    if (bundle._myfb !== 'export')              return { ok: false, error: 'wrong-magic' };
    if (typeof bundle._version !== 'number')     return { ok: false, error: 'bad-version' };
    if (!bundle.data || typeof bundle.data !== 'object') return { ok: false, error: 'no-data' };
    var d = bundle.data;
    if (d.demandes !== undefined) {
      if (!Array.isArray(d.demandes) || d.demandes.length > MAX_DEMANDES) return { ok: false, error: 'demandes-shape' };
      if (!d.demandes.every(_validDemande))                                return { ok: false, error: 'demandes-invalid' };
    }
    if (d.templates !== undefined) {
      if (!Array.isArray(d.templates) || d.templates.length > MAX_TEMPLATES) return { ok: false, error: 'templates-shape' };
      if (!d.templates.every(_validTemplate))                                 return { ok: false, error: 'templates-invalid' };
    }
    return { ok: true };
  }

  /**
   * Import a JSON bundle previously produced by exportToFile.
   * @param {object} STATE  — current state (will be mutated)
   * @param {object} bundle — parsed JSON (validated by schema first)
   * @param {object} [opts] — { mode: 'replace' | 'merge' }  default 'replace'
   * @returns {{ ok: boolean, error?: string, imported?: number }}
   */
  function importBundle(STATE, bundle, opts) {
    opts = opts || {};
    var v = _validateBundle(bundle);
    if (!v.ok) return { ok: false, error: v.error };
    var data = bundle.data;
    var mode = opts.mode === 'merge' ? 'merge' : 'replace';

    if (mode === 'replace') {
      if (Array.isArray(data.demandes))   STATE.demandes      = data.demandes;
      if (data.currentDemande && _validDemande(data.currentDemande)) STATE.currentDemande = data.currentDemande;
    } else {
      if (Array.isArray(data.demandes))   STATE.demandes = (STATE.demandes || []).concat(data.demandes);
    }
    if (Array.isArray(data.templates))    STATE.templates = data.templates;
    // Whitelist of importable settings (no arbitrary keys)
    var SAFE_SETTINGS = ['lang','micDeviceId','sortOrder','segFontSize','visibleButtons','uiLang',
      'autoOpenOnKnownActive','autoOpenOnKnownDone','autoOpenOnAiPage','hideAiTextarea',
      'autoSubmitAfterInject','archiveExpanded','showConsoleBtn','topbarPosition','theme'];
    SAFE_SETTINGS.forEach(function (k) {
      if (data[k] !== undefined) STATE[k] = data[k];
    });
    return { ok: true, imported: (data.demandes || []).length };
  }

  window.MyFbStorage = {
    hydrate:      hydrate,
    persist:      persist,
    exportToFile: exportToFile,
    importBundle: importBundle,
    pullFromSync: pullFromSync,
    watchSync:    watchSync,
  };

})(window);
