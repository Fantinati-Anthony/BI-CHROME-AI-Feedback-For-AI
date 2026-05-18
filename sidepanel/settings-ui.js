/**
 * My-Feedbacks Settings UI Controller (v1.9)
 *
 * Wires three new Settings sections introduced for v1.0.0 launch:
 *
 *   1. Cet appareil
 *      - Read-only UUID display + copy button
 *      - Live deviceMeta dump (browser, OS, viewport, network, etc.)
 *      - "Régénérer l'UUID" button (with confirmation)
 *      - "Refaire l'onboarding" button (re-opens the wizard)
 *
 *   2. Sync
 *      - Mode picker (Solo / Shared Folder / Self-hosted soon / Cloud soon)
 *      - Shared folder: "Choisir un dossier…" button using
 *        showDirectoryPicker(); persists the chosen handle for re-use
 *      - Sync status indicator (idle / syncing / offline / error)
 *
 *   3. Liaisons (Links / partners)
 *      - List of paired admin/client peers (from runtime.state.links)
 *      - Empty state explaining pairing arrives in v2.0
 *
 * All handlers are written so the panel works even if MyFb.runtime
 * hasn't booted (e.g. IndexedDB error) — falls back to disabled
 * states and friendly messages.
 */

(function (window) {
  'use strict';

  var t = function (k, fb) {
    return (window.MyFb && window.MyFb.utils && window.MyFb.utils.t)
      ? window.MyFb.utils.t(k, fb) : (fb || k);
  };

  function _toast(msg, kind, dur) {
    if (window.MyFbToast && window.MyFbToast.show) {
      window.MyFbToast.show(msg, kind || 'info', dur || 2200);
    }
  }

  // ── Bootstrap: re-render dynamic panels every time the user opens
  //    Settings (the panel itself is in sidepanel.html, we just inject
  //    content into placeholder blocks).
  function init() {
    document.addEventListener('click', _onClick, true);
    document.addEventListener('change', _onChange, true);
    _renderDevicePanel();
    _renderSyncPanel();
    _renderLinksPanel();
  }

  // ── Cet appareil ───────────────────────────────────────────────────

  function _renderDevicePanel() {
    var host = document.querySelector('[data-myfb-device-panel]');
    if (!host) return;
    var ctx  = window.MyFb && window.MyFb.runtime;
    var uuid = (ctx && ctx.uuid) || t('settings.device.unknown_uuid', 'Non disponible');
    var dm   = window.MyFb && window.MyFb.core && window.MyFb.core.deviceMeta;
    var meta = dm && dm.collectDeviceMeta ? dm.collectDeviceMeta() : {};

    host.innerHTML =
      '<div class="myfb-device-uuid-row">' +
        '<span class="myfb-device-uuid-label">UUID</span>' +
        '<code class="myfb-device-uuid">' + _esc(uuid) + '</code>' +
        '<button type="button" class="myfb-mini-btn" data-act="copy-uuid" title="' + t('settings.device.copy_uuid', 'Copier') + '">📋</button>' +
      '</div>' +
      '<div class="myfb-device-meta">' +
        _metaRow(t('settings.device.browser', 'Navigateur'), (meta.browser && (meta.browser.name + ' ' + (meta.browser.version || ''))) || '—') +
        _metaRow(t('settings.device.os', 'Système'),        (meta.os && (meta.os.name + ' ' + (meta.os.version || ''))) || '—') +
        _metaRow(t('settings.device.viewport', 'Viewport'), (meta.viewport && (meta.viewport.w + '×' + meta.viewport.h)) || '—') +
        _metaRow(t('settings.device.dpr', 'DPR'),           meta.dpr || '—') +
        _metaRow(t('settings.device.deviceClass', 'Catégorie'), meta.deviceClass || '—') +
        _metaRow(t('settings.device.language', 'Langue'),   (meta.locale && meta.locale.language) || '—') +
        _metaRow(t('settings.device.network', 'Réseau'),    (meta.network && meta.network.online ? 'en ligne' : 'hors ligne')) +
      '</div>' +
      '<div class="myfb-device-actions">' +
        '<button type="button" class="sp-action-btn" data-act="reopen-onboarding">' +
          t('settings.device.reopen_onboarding', '🔄 Refaire l\'onboarding') +
        '</button>' +
        '<button type="button" class="sp-action-btn sp-action-btn-danger" data-act="regen-uuid">' +
          t('settings.device.regen_uuid', '⚠ Régénérer l\'UUID') +
        '</button>' +
      '</div>';
  }

  function _metaRow(label, value) {
    return '<div class="myfb-device-meta-row">' +
      '<span class="myfb-device-meta-label">' + _esc(label) + '</span>' +
      '<span class="myfb-device-meta-value">' + _esc(String(value)) + '</span>' +
    '</div>';
  }

  // ── Sync ───────────────────────────────────────────────────────────

  var _sharedDirHandle = null;

  function _renderSyncPanel() {
    var host = document.querySelector('[data-myfb-sync-panel]');
    if (!host) return;
    var canFsa = typeof window.showDirectoryPicker === 'function';

    host.innerHTML =
      '<p class="sp-section-desc">' +
        t('settings.sync.desc', 'Choisissez comment My-Feedbacks synchronise vos demandes avec vos partenaires.') +
      '</p>' +
      '<div class="myfb-sync-modes">' +
        _modeRow('solo',          '🖥', t('settings.sync.mode_solo',  'Solo (par défaut)'),  t('settings.sync.mode_solo_hint',  'Tout reste sur cet appareil.')) +
        _modeRow('shared-folder', '📁', t('settings.sync.mode_folder','Dossier partagé'),    t('settings.sync.mode_folder_hint','Drive / Dropbox / OneDrive — gratuit, async.')) +
        _modeRow('self-hosted',   '🏠', t('settings.sync.mode_self',  'Serveur auto-hébergé'),t('settings.sync.mode_self_hint',  'Bientôt — v2.0.'), { disabled: true }) +
        _modeRow('cloud',         '☁',  t('settings.sync.mode_cloud', 'my-feedbacks.com'),    t('settings.sync.mode_cloud_hint', 'Bientôt — v2.0+.'),  { disabled: true }) +
      '</div>' +
      '<div class="myfb-sync-folder-config" data-myfb-folder-cfg' + (canFsa ? '' : ' hidden') + '>' +
        '<button type="button" class="sp-action-btn" data-act="pick-folder">' +
          (_sharedDirHandle
            ? t('settings.sync.change_folder', '📁 Changer de dossier')
            : t('settings.sync.pick_folder',   '📁 Choisir un dossier partagé…')) +
        '</button>' +
        (_sharedDirHandle
          ? '<p class="myfb-sync-current">' + t('settings.sync.current', 'Actuel :') + ' <code>' + _esc(_sharedDirHandle.name || '?') + '</code></p>'
          : '') +
      '</div>' +
      (canFsa ? '' :
        '<p class="myfb-sync-hint">' +
          t('settings.sync.fsa_unsupported', 'File System Access API non disponible dans ce navigateur. Mettez à jour Chrome ≥ 86.') +
        '</p>') +
      '<p class="myfb-sync-status">' +
        t('settings.sync.status_label', 'État') + ' : ' +
        '<span data-myfb-sync-status>' + _currentSyncStatus() + '</span>' +
      '</p>';

    _selectCurrentMode();
  }

  function _modeRow(id, icon, label, hint, opts) {
    var disabled = opts && opts.disabled;
    return '<label class="myfb-sync-mode' + (disabled ? ' is-disabled' : '') + '">' +
      '<input type="radio" name="myfb-sync-mode" value="' + id + '"' + (disabled ? ' disabled' : '') + ' />' +
      '<span class="myfb-sync-mode-icon">' + icon + '</span>' +
      '<span class="myfb-sync-mode-text">' +
        '<span class="myfb-sync-mode-label">' + _esc(label) + '</span>' +
        '<span class="myfb-sync-mode-hint">'  + _esc(hint)  + '</span>' +
      '</span>' +
    '</label>';
  }

  function _selectCurrentMode() {
    var mode = _readMode();
    var inp = document.querySelector('input[name=myfb-sync-mode][value="' + mode + '"]');
    if (inp) inp.checked = true;
  }

  function _readMode() {
    try {
      // chrome.storage.local is async — for first paint we read from a
      // synchronous cache if available; otherwise default solo.
      return (window.__MYFB_SYNC_MODE__) || 'solo';
    } catch (_) { return 'solo'; }
  }
  function _writeMode(mode) {
    window.__MYFB_SYNC_MODE__ = mode;
    try { chrome.storage.local.set({ 'myfb:sync:mode': mode }); } catch (_) {}
  }

  function _currentSyncStatus() {
    var ctx = window.MyFb && window.MyFb.runtime;
    if (!ctx || !ctx.transport || !ctx.transport.status) return 'idle';
    return ctx.transport.status().state || 'idle';
  }

  function _pickFolder() {
    if (typeof window.showDirectoryPicker !== 'function') {
      _toast(t('settings.sync.fsa_unsupported', 'File System Access API non disponible.'), 'error');
      return;
    }
    window.showDirectoryPicker({ mode: 'readwrite' }).then(function (handle) {
      _sharedDirHandle = handle;
      _renderSyncPanel();
      _toast(t('settings.sync.folder_set', 'Dossier sélectionné : ' + handle.name), 'success');
      _maybeWireSharedTransport();
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return; // user cancelled
      _toast(t('settings.sync.pick_failed', 'Échec : ' + e.message), 'error');
    });
  }

  function _maybeWireSharedTransport() {
    var T = window.MyFb && window.MyFb.core && window.MyFb.core.transports && window.MyFb.core.transports.sharedFolder;
    if (!T || !_sharedDirHandle) return;
    var tx = T.create();
    tx.init({ dirHandle: _sharedDirHandle }).then(function () {
      // Hand the transport over to the runtime if available
      var ctx = window.MyFb && window.MyFb.runtime;
      if (ctx) { ctx.transport = tx; }
      _renderSyncPanel(); // refresh status
    }).catch(function (e) {
      _toast(t('settings.sync.init_failed', 'Init transport KO : ' + e.message), 'error', 4500);
    });
  }

  // ── Liaisons ───────────────────────────────────────────────────────

  function _renderLinksPanel() {
    var host = document.querySelector('[data-myfb-links-panel]');
    if (!host) return;
    var ctx = window.MyFb && window.MyFb.runtime;
    var links = (ctx && ctx.state && ctx.state.links) || {};
    var rows = Object.values(links);
    if (rows.length === 0) {
      host.innerHTML =
        '<div class="myfb-links-empty">' +
          '<p>' + t('settings.links.empty', 'Aucun partenaire lié pour l\'instant.') + '</p>' +
          '<p class="sp-section-desc">' +
            t('settings.links.empty_hint', 'Le système de pairing direct (code court à partager) arrive en v2.0. En attendant, vos exports via boutons IA et bridge VS Code restent disponibles.') +
          '</p>' +
        '</div>';
      return;
    }
    host.innerHTML = '<div class="myfb-links-list">' + rows.map(function (l) {
      return '<div class="myfb-link-row">' +
        '<span class="myfb-link-label">' + _esc(l.peerLabel || l.peerUuid.slice(0, 8)) + '</span>' +
        '<span class="myfb-link-role">' + _esc(l.peerRole || '—') + '</span>' +
        '<span class="myfb-link-status myfb-link-status-' + _esc(l.status || 'pending') + '">' + _esc(l.status || 'pending') + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  // ── Click handler ──────────────────────────────────────────────────

  function _onClick(e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    if      (act === 'copy-uuid')           _copyUuid();
    else if (act === 'reopen-onboarding')   _reopenOnboarding();
    else if (act === 'regen-uuid')          _regenUuid();
    else if (act === 'pick-folder')         _pickFolder();
  }

  function _onChange(e) {
    var inp = e.target;
    if (!inp || inp.name !== 'myfb-sync-mode') return;
    var mode = inp.value;
    _writeMode(mode);
    if (mode === 'shared-folder') {
      _toast(t('settings.sync.tier2_picked', 'Choisissez votre dossier partagé pour activer la sync.'), 'info', 3500);
    } else if (mode === 'solo') {
      _toast(t('settings.sync.tier1_picked', 'Mode solo activé.'), 'info');
    }
  }

  function _copyUuid() {
    var uuid = (window.MyFb && window.MyFb.runtime && window.MyFb.runtime.uuid) || '';
    if (!uuid) { _toast(t('settings.device.no_uuid_copy', 'Aucun UUID disponible.'), 'warning'); return; }
    try {
      navigator.clipboard.writeText(uuid).then(function () {
        _toast(t('settings.device.uuid_copied', 'UUID copié.'), 'success', 1500);
      }, function () {
        _toast(t('settings.device.copy_failed', 'Copie échouée.'), 'error');
      });
    } catch (_) {}
  }

  function _reopenOnboarding() {
    var rb = window.MyFb && window.MyFb.runtimeBoot;
    if (rb && rb.reopenOnboarding) rb.reopenOnboarding();
  }

  function _regenUuid() {
    if (!confirm(t('settings.device.regen_confirm', 'Régénérer votre UUID ? Vos demandes existantes resteront, mais elles ne seront plus reliées à votre identité précédente pour vos partenaires.'))) return;
    var dm = window.MyFb && window.MyFb.core && window.MyFb.core.deviceMeta;
    if (!dm || !dm.regenerateUuid) return;
    dm.regenerateUuid().then(function (newUuid) {
      if (window.MyFb && window.MyFb.runtime) window.MyFb.runtime.uuid = newUuid;
      _renderDevicePanel();
      _toast(t('settings.device.regen_ok', 'UUID régénéré.'), 'success');
    }).catch(function (e) {
      _toast(t('settings.device.regen_failed', 'Échec : ' + e.message), 'error');
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Public API for testing
  window.MyFbSettingsUi = {
    init:                init,
    _renderDevicePanel:  _renderDevicePanel,
    _renderSyncPanel:    _renderSyncPanel,
    _renderLinksPanel:   _renderLinksPanel,
    _readMode:           _readMode,
    _writeMode:          _writeMode,
  };
})(window);
