/**
 * BIAIF Storage
 * Handles hydration, persistence, and versioned migration.
 * Storage quota guard: strips dataUrls from screenshots when the full save fails.
 */
(function (window) {
  'use strict';

  var KEY        = (window.BIAIF && window.BIAIF.STORAGE_KEY)        || 'biaif:v04:state';
  var LEGACY     = (window.BIAIF && window.BIAIF.STORAGE_LEGACY_KEYS) || ['biaif:v03:state'];
  var MAX_BYTES  = 8 * 1024 * 1024; // warn at 8 MB (limit is 10 MB)

  // -----------------------------------------------------------------------
  // Hydrate
  // -----------------------------------------------------------------------
  async function hydrate(STATE, onDone) {
    try {
      var obj  = await chrome.storage.local.get([KEY].concat(LEGACY));
      var saved = obj[KEY] || _migrateLegacy(obj);
      if (!saved) { if (onDone) onDone(); return; }

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

    } catch (e) {
      console.warn('[BIAIF Storage] hydrate failed', e && e.message);
    }
    if (onDone) onDone();
  }

  // -----------------------------------------------------------------------
  // Persist (with undo snapshot + quota fallback)
  // -----------------------------------------------------------------------
  function persist(STATE) {
    // Push undo snapshot before saving
    if (window.BIAIFUndo) {
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
      demandes:       STATE.demandes,
      currentDemande: STATE.currentDemande,
      lang:           STATE.lang,
      micDeviceId:    STATE.micDeviceId,
      sortOrder:      STATE.sortOrder,
      segFontSize:    STATE.segFontSize,
      visibleButtons: STATE.visibleButtons,
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
          window.BIAIFToast.show(
            'Stockage presque plein (' + Math.round(usage / 1024 / 1024 * 10) / 10 + ' MB). Videz l\'historique pour libérer de l\'espace.',
            'error', 8000
          );
        }
      }
    } catch (_) {}
  }

  window.BIAIFStorage = { hydrate: hydrate, persist: persist };

})(window);
