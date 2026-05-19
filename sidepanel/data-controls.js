/**
 * My-Feedbacks Data Controls (v1.14)
 *
 * RGPD-mandated user controls :
 *   1. Export bundle — download a JSON file with EVERYTHING (events,
 *      profile, settings, blob references) so the user can move to
 *      another install or keep a backup.
 *   2. Reset profile — wipe chrome.storage.sync `myfb:profile:v1` and
 *      regenerate UUID. Keeps demandes (events) but the new identity is
 *      fresh for partners.
 *   3. Delete-my-data — nuclear option. Wipes IndexedDB (events store +
 *      blob store + meta), chrome.storage.sync, chrome.storage.local.
 *      Reloads the side panel after to start fresh.
 *
 * All operations confirm explicitly via window.confirm() with a clear
 * message. UI lives in a new Settings → "Vos données" section.
 */

(function (window) {
  'use strict';

  var t = function (k, fb) {
    return (window.MyFb && window.MyFb.utils && window.MyFb.utils.t)
      ? window.MyFb.utils.t(k, fb) : (fb || k);
  };

  function _toast(m, k, d) {
    if (window.MyFbToast && window.MyFbToast.show) window.MyFbToast.show(m, k || 'info', d || 2500);
  }

  function init() {
    document.addEventListener('click', _onClick, true);
  }

  function _onClick(e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-myfb-data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-myfb-data-act');
    if      (act === 'export-bundle')  exportBundle();
    else if (act === 'reset-profile')  resetProfile();
    else if (act === 'delete-all')     deleteAll();
  }

  // ── Export bundle ───────────────────────────────────────────────────

  /**
   * Build a full data bundle and download it as JSON.
   * @returns {Promise<object>}
   */
  function exportBundle() {
    return _collectBundle().then(function (bundle) {
      var json = JSON.stringify(bundle, null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      var ts   = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = 'my-feedbacks-bundle-' + ts + '.json';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      _toast(t('data.export_ok', 'Bundle téléchargé.'), 'success');
      return bundle;
    }).catch(function (err) {
      _toast(t('data.export_failed', 'Échec : ' + (err && err.message)), 'error', 4500);
      throw err;
    });
  }

  /**
   * Assemble a portable bundle from every source the extension uses.
   * Exposed for tests.
   */
  function _collectBundle() {
    var jobs = [
      _safeReadStorage('local'),
      _safeReadStorage('sync'),
      _safeReadEvents(),
    ];
    return Promise.all(jobs).then(function (out) {
      var bundle = {
        _myfb:        'bundle',
        _schemaVersion: 1,
        _exportedAt:  new Date().toISOString(),
        _appVersion:  (chrome && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().version) || 'unknown',
        chromeStorageLocal: out[0],
        chromeStorageSync:  out[1],
        events:             out[2],
      };
      return bundle;
    });
  }

  function _safeReadStorage(area) {
    return new Promise(function (resolve) {
      try {
        chrome.storage[area].get(null, function (out) { resolve(out || {}); });
      } catch (_) { resolve({}); }
    });
  }

  function _safeReadEvents() {
    var ctx = window.MyFb && window.MyFb.runtime;
    if (ctx && ctx.store && ctx.store.readSince) {
      return ctx.store.readSince(-1).catch(function () { return []; });
    }
    return Promise.resolve([]);
  }

  // ── Reset profile (keeps demandes) ──────────────────────────────────

  function resetProfile() {
    if (!confirm(t('data.reset_profile_confirm',
      'Réinitialiser votre profil ? Votre UUID, rôle, nom et consentement RGPD seront supprimés. Vos demandes (feedbacks) restent intactes. L\'onboarding s\'ouvrira au prochain rechargement.'
    ))) return Promise.resolve();
    var jobs = [];
    var P  = window.MyFb && window.MyFb.core && window.MyFb.core.profile;
    var dm = window.MyFb && window.MyFb.core && window.MyFb.core.deviceMeta;
    if (P  && P.clear)  jobs.push(P.clear().catch(function () {}));
    if (dm && dm.regenerateUuid) jobs.push(dm.regenerateUuid().catch(function () {}));
    return Promise.all(jobs).then(function () {
      _toast(t('data.reset_profile_ok', 'Profil réinitialisé. Rechargez l\'extension.'), 'success', 4000);
    });
  }

  // ── Delete everything ───────────────────────────────────────────────

  function deleteAll() {
    var msg = t('data.delete_all_confirm_1',
      'SUPPRIMER TOUTES VOS DONNÉES ?\n\nIrréversible. Cela efface :\n• Toutes vos demandes\n• Tous vos screenshots\n• Votre profil + UUID\n• Vos templates\n• Vos réglages\n\nVoulez-vous d\'abord exporter un bundle de sauvegarde ?');
    var first = confirm(msg);
    if (!first) return Promise.resolve();

    // Suggest export first
    var doExport = confirm(t('data.delete_all_confirm_export',
      'OK — voulez-vous d\'abord télécharger un bundle de sauvegarde ?'));
    var pre = doExport ? exportBundle().catch(function () { return null; }) : Promise.resolve();

    return pre.then(function () {
      var second = confirm(t('data.delete_all_confirm_final',
        '⚠ DERNIÈRE CONFIRMATION ⚠\n\nSuppression définitive de toutes les données My-Feedbacks. Continuer ?'));
      if (!second) return;
      return _wipeEverything().then(function () {
        _toast(t('data.delete_all_ok', 'Tout effacé. Rechargement…'), 'success', 2500);
        setTimeout(function () { location.reload(); }, 2000);
      });
    });
  }

  function _wipeEverything() {
    var jobs = [];
    function _safe(fn) {
      return new Promise(function (resolve) {
        try { fn(resolve); } catch (_) { resolve(); }
      });
    }
    // 1. chrome.storage local + sync
    jobs.push(_safe(function (r) { chrome.storage.local.clear(function () { r(); }); }));
    jobs.push(_safe(function (r) { chrome.storage.sync.clear(function ()  { r(); }); }));
    // 2. IndexedDB (my-feedbacks db)
    jobs.push(_safe(function (r) {
      var req = indexedDB.deleteDatabase('my-feedbacks');
      req.onsuccess = req.onerror = req.onblocked = function () { r(); };
    }));
    // 3. Legacy blob-store db
    jobs.push(_safe(function (r) {
      var req = indexedDB.deleteDatabase('myfb');
      req.onsuccess = req.onerror = req.onblocked = function () { r(); };
    }));
    return Promise.all(jobs);
  }

  // Public surface (also used by tests)
  window.MyFbDataControls = {
    init:           init,
    exportBundle:   exportBundle,
    resetProfile:   resetProfile,
    deleteAll:      deleteAll,
    _collectBundle: _collectBundle,
    _wipeEverything: _wipeEverything,
  };
})(window);
