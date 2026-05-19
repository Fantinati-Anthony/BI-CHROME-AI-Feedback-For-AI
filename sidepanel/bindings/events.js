/**
 * MyFb Bindings — UI events
 *
 * All click / change / input listeners on the side panel UI. Grouped by
 * concern. Search by `_bindXxx` to jump.
 *
 * Sub-modules (live in their own files, called from bind() below):
 *   - events-templates.js   →  templates popover (open / list / save)
 *
 * Sections in this file (in declaration order):
 *
 *   ── Session ─────────────────────────────────
 *   _autoArm, _bindSessionButtons, _bindTools, _bindFooter,
 *   _bindLangSelect, _bindShotButtons, _bindFileImport,
 *   _bindErrorsButton
 *
 *   ── Topbar tools ────────────────────────────
 *   _bindSortToggle, _bindSearchToggle, _bindFontSize, _bindHistorySearch
 *
 *   ── Settings panel ──────────────────────────
 *   _bindSettingsPopover, _bindReloadModal, _bindSyncToggle,
 *   _bindExportImport, _bindWizardReopen, _bindButtonVisibility,
 *   _bindAutoOpenToggles, _bindTheme, _bindTopbarPosition,
 *   _bindPrivacyScrub, _bindShowConsoleBtn, _bindBehaviourToggles,
 *   _bindUiLangButtons, _bindMicSettings
 *
 *   ── Editor + content ────────────────────────
 *   _bindEditorLiveSync, _bindRefChipEdit, _bindFilterBadges,
 *   _bindStatusBar
 */
(function (window) {
  'use strict';
  window.MyFbBindings = window.MyFbBindings || {};
  var ctx   = window.MyFbBindings.ctx;
  var H     = window.MyFbBindings.helpers;
  var CFG   = (window.MyFb && window.MyFb.config && window.MyFb.config.ui) || {};
  var UTILS = (window.MyFb && window.MyFb.utils) || {};
  function _t(k, fb, vars) { return UTILS.t ? UTILS.t(k, fb, vars) : (fb || k); }

  // Arme la session silencieusement (sans démarrer mic/picker).
  // Appelé par tous les boutons outils afin d'afficher la demande-zone.
  function _autoArm() {
    var STATE = ctx.STATE, REFS = ctx.REFS;
    if (STATE.armed) return;
    STATE.armed = true;
    if (REFS.masterBtn) REFS.masterBtn.classList.add('armed');
    window.MyFbRenderer.updateArmedUi();
    window.MyFbRenderer.updateMasterBtnLabel();
  }

  function _bindSessionButtons() {
    var REFS = ctx.REFS, STATE = ctx.STATE;
    if (REFS.masterBtn) REFS.masterBtn.addEventListener('click', function () {
      if (typeof STATE.editingDemandeIdx === 'number') {
        window.MyFbSession.exitEditMode();
      } else {
        window.MyFbSession.finalizeDemande(false);
        H.updateLinkedSessionBanner();
      }
    });
    // Stop button kept for backward-compat (CSS hides it in new UX).
    if (REFS.stopBtn) REFS.stopBtn.addEventListener('click', function () {
      window.MyFbSession.stopSession();
      STATE.pendingConversationUrl = null;
      H.updateLinkedSessionBanner();
    });
    // "Nouvelle conv." — clears any leftover draft and arms a fresh session.
    // Two buttons share data-act="new-conv": the topbar + (.session-new-conv)
    // AND the empty-state orb (.empty-state-orb). Bind both.
    document.querySelectorAll('[data-act="new-conv"]').forEach(function (newConvBtn) {
      newConvBtn.addEventListener('click', function () {
        // Always start with an empty editor (no leftover from previous session)
        STATE.currentDemande = { text: '', refs: [], pageUrl: null };
        if (REFS.demandeEditor) REFS.demandeEditor.innerHTML = '';
        window.MyFbRenderer.renderDemandeRefsStrip();
        _autoArm();
        STATE.pendingConversationUrl = null;
        STATE.pendingRepoId = null;
        H.updateLinkedSessionBanner();
        window.MyFbStorage.persist(STATE);
      });
    });
    // "✕ Disarm" — saves any pending work and goes back to history view.
    var disarmBtn = document.querySelector('[data-act="disarm"]');
    if (disarmBtn) disarmBtn.addEventListener('click', function () {
      window.MyFbSession.disarm();
    });
  }

  function _bindTools() {
    var REFS = ctx.REFS;
    if (REFS.pickerBtn) REFS.pickerBtn.addEventListener('click', async function () {
      _autoArm();
      var resp = await H.sendBg({ type: H.msgKey('PICKER_TOGGLE') });
      if (resp && resp.error) {
        window.MyFbToast.show(
          _t('toast.picker_fail', 'Picker KO : ' + H.decodeContentScriptError(resp.error),
            { err: H.decodeContentScriptError(resp.error) }),
          'error');
      }
    });
    if (REFS.micBtn) REFS.micBtn.addEventListener('click', function () {
      _autoArm();
      window.MyFbSpeech.toggleMic();
    });
  }

  function _bindFooter() {
    var REFS = ctx.REFS, STATE = ctx.STATE;
    if (REFS.clearBtn) REFS.clearBtn.addEventListener('click', function () {
      // Don't prompt if there's nothing to clear — clearAll is a no-op anyway.
      var hasContent = STATE.demandes.length
        || (STATE.currentDemande.text || '').trim()
        || STATE.currentDemande.refs.length;
      if (!hasContent) return;
      H.confirmModal({
        title:       _t('modal.clear.title', 'Vider la session ?'),
        desc:        _t('modal.clear.desc', 'Toutes les demandes enregistrées seront supprimées. Vous pourrez annuler immédiatement après depuis le toast.'),
        confirmText: _t('modal.clear.confirm', 'Vider'),
        onConfirm:   function () { H.clearAll(); },
      });
    });
    if (REFS.copyBtn)     REFS.copyBtn.addEventListener('click',     function () { window.MyFbExport.copyPrompt(); });
    if (REFS.downloadBtn) REFS.downloadBtn.addEventListener('click', function () { window.MyFbExport.downloadBundle(); });

    // Empty-state "Voir le guide" — re-opens the onboarding wizard.
    var guideBtn = document.querySelector('[data-act="open-wizard"]');
    if (guideBtn) guideBtn.addEventListener('click', function () {
      if (window.MyFbWizard) window.MyFbWizard.open(STATE, function () { window.MyFbStorage.persist(STATE); });
    });
  }

  function _bindLangSelect() {
    var REFS = ctx.REFS, STATE = ctx.STATE;
    if (!REFS.langSelect) return;
    REFS.langSelect.addEventListener('change', function (e) {
      STATE.lang = e.target.value;
      var MIC = window.MyFbSpeech.getMicState();
      if (MIC && MIC.rec) MIC.rec.lang = STATE.lang;
      window.MyFbStorage.persist(STATE);
    });
  }

  function _bindShotButtons() {
    var REFS = ctx.REFS;
    REFS.shotButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        _autoArm();
        H.closeCaptureSubline();
        window.MyFbSession.runShotMode(btn.dataset.shot);
      });
    });
    var captureToggle = document.querySelector('[data-act="capture-toggle"]');
    if (captureToggle) captureToggle.addEventListener('click', function (e) {
      _autoArm();
      e.stopPropagation(); H.toggleCaptureSubline();
    });
    document.addEventListener('click', function (e) {
      var sub = document.getElementById('capture-subline');
      if (!sub || sub.hasAttribute('hidden')) return;
      if (e.target.closest('[data-act="capture-toggle"]') || e.target.closest('#capture-subline')) return;
      H.closeCaptureSubline();
    });
  }

  function _bindFileImport() {
    var filesBtn  = document.querySelector('[data-act="open-files"]');
    var fileInput = document.getElementById('quick-file-input');
    if (!filesBtn || !fileInput) return;
    filesBtn.addEventListener('click', function () { _autoArm(); fileInput.click(); });
    fileInput.addEventListener('change', async function (e) {
      var files = Array.from(e.target.files || []);
      if (files.length) await H.handleCaptureFiles(files);
      e.target.value = '';
    });
  }

  // _bindTemplatesPopover lives in bindings/events-templates.js — see bind() below.

  function _bindErrorsButton() {
    var btn = document.querySelector('[data-act="open-errors"]');
    if (btn) btn.addEventListener('click', function () { _autoArm(); H.addAllConsoleErrors(); });
  }

  function _bindSortToggle() {
    var STATE = ctx.STATE;
    function setSort(order) {
      STATE.sortOrder = order;
      window.MyFbRenderer.updateSortToggleLabel();
      window.MyFbRenderer.renderSegments();
      window.MyFbStorage.persist(STATE);
    }
    var ascBtn  = document.querySelector('[data-act="sort-asc"]');
    var descBtn = document.querySelector('[data-act="sort-desc"]');
    if (ascBtn)  ascBtn.addEventListener('click',  function () { setSort('asc'); });
    if (descBtn) descBtn.addEventListener('click', function () { setSort('desc'); });
    window.MyFbRenderer.updateSortToggleLabel();
  }

  // Toggle search input visibility (loupe button)
  function _bindSearchToggle() {
    // The loupe (now [data-act="filter-toggle"]) opens the full filter
    // panel — text search + tag/domain/page/conv/repo selectors. The
    // legacy [data-act="search-toggle"] handler is kept as a fallback
    // alias for backwards compat with anyone wiring against the old name.
    document.querySelectorAll('[data-act="filter-toggle"], [data-act="search-toggle"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (window.MyFbFilterPanel) window.MyFbFilterPanel.toggle();
      });
    });
  }

  function _bindFontSize() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act="seg-font-down"],[data-act="seg-font-up"],' +
        '[data-act="seg-lines-down"],[data-act="seg-lines-up"]');
      if (!btn) return;
      var a = btn.dataset.act;
      if (a === 'seg-font-up' || a === 'seg-font-down') {
        window.MyFbRenderer.bumpSegFontSize(a === 'seg-font-up' ? +1 : -1);
        H.updateSpFontVal();
      } else {
        window.MyFbRenderer.bumpSegTextLines(a === 'seg-lines-up' ? +1 : -1);
        H.updateSpLinesVal();
      }
    });
    window.MyFbRenderer.applySegFontSize();
    window.MyFbRenderer.applySegTextLines();
  }

  function _bindHistorySearch() {
    var REFS = ctx.REFS, STATE = ctx.STATE;
    if (!REFS.searchInput) return;
    var debounceMs = CFG.SEARCH_DEBOUNCE_MS || 150;
    var timer = null;
    REFS.searchInput.addEventListener('input', function (e) {
      STATE.searchQuery = e.target.value || '';
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        window.MyFbRenderer.renderSegments();
      }, debounceMs);
    });
  }

  function _bindSettingsPopover() {
    var REFS = ctx.REFS;
    if (REFS.toggleSettings) REFS.toggleSettings.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!REFS.settingsPopover) return;
      var opening = !REFS.settingsPopover.classList.contains('is-open');
      REFS.settingsPopover.classList.toggle('is-open', opening);
      REFS.toggleSettings.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening) H.updateSpFontVal();
    });
    document.addEventListener('click', function (e) {
      if (!REFS.settingsPopover || !REFS.settingsPopover.classList.contains('is-open')) return;
      if (e.target.closest('#settings-panel') || e.target.closest('[data-act="toggle-settings"]')) return;
      REFS.settingsPopover.classList.remove('is-open');
      if (REFS.toggleSettings) REFS.toggleSettings.setAttribute('aria-expanded', 'false');
    });
    var closeBtn = document.querySelector('[data-act="close-settings"]');
    if (closeBtn) closeBtn.addEventListener('click', function () {
      if (REFS.settingsPopover) REFS.settingsPopover.classList.remove('is-open');
      if (REFS.toggleSettings) REFS.toggleSettings.setAttribute('aria-expanded', 'false');
    });
    if (REFS.openShortcuts) REFS.openShortcuts.addEventListener('click', function () {
      try { chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); } catch (_) {}
    });
  }

  function _bindReloadModal() {
    var REFS = ctx.REFS;
    if (REFS.reloadModalBtn) REFS.reloadModalBtn.addEventListener('click', async function () {
      var resp = await H.sendBg({ type: H.msgKey('RELOAD_ACTIVE_TAB') });
      if (resp && resp.ok) {
        H.hideReloadModal();
        window.MyFbToast.show(_t('toast.tab_reload_retry', 'Onglet rechargé.'), 'success');
      } else {
        window.MyFbToast.show(
          _t('toast.tab_reload_fail', 'Rechargement KO : ' + (resp ? resp.error : 'no resp'),
            { err: (resp ? resp.error : 'no resp') }),
          'error');
      }
    });
    if (REFS.reloadDismiss) REFS.reloadDismiss.addEventListener('click', function () { H.hideReloadModal(); });
  }

  var _syncUnsubscribe = null;
  function _ensureSyncWatcher(STATE) {
    if (_syncUnsubscribe) return;
    if (!window.MyFbStorage.watchSync) return;
    _syncUnsubscribe = window.MyFbStorage.watchSync(STATE, function () {
      // Live update from another device → re-render visible UI.
      window.MyFbRenderer.renderSegments();
      window.MyFbRenderer.updateMasterBtnLabel();
      window.MyFbRenderer.updateArmedUi();
      window.MyFbToast.show(_t('toast.sync_remote_update', 'Réglages synchronisés depuis un autre appareil.'), 'info', 2500);
    });
  }

  function _bindSyncToggle() {
    var STATE = ctx.STATE;
    var cb = document.getElementById('sync-enabled');
    if (!cb) return;
    cb.checked = !!STATE.syncEnabled;
    if (STATE.syncEnabled) _ensureSyncWatcher(STATE);
    cb.addEventListener('change', async function () {
      STATE.syncEnabled = cb.checked;
      window.MyFbStorage.persist(STATE);
      if (cb.checked) {
        _ensureSyncWatcher(STATE);
        if (window.MyFbStorage.pullFromSync) {
          var pulled = await window.MyFbStorage.pullFromSync(STATE);
          if (pulled) {
            window.MyFbRenderer.renderSegments();
            window.MyFbRenderer.updateMasterBtnLabel();
            window.MyFbRenderer.updateArmedUi();
            window.MyFbToast.show(_t('toast.sync_pulled', 'Synchronisation réussie.'), 'success');
          } else {
            window.MyFbToast.show(_t('toast.sync_enabled', 'Sync activée — vos réglages seront partagés.'), 'info');
          }
        }
      } else if (_syncUnsubscribe) {
        _syncUnsubscribe(); _syncUnsubscribe = null;
      }
    });
  }

  function _bindExportImport() {
    var STATE = ctx.STATE;
    var exportBtn   = document.querySelector('[data-act="export-json"]');
    var importBtn   = document.querySelector('[data-act="import-json"]');
    var importInput = document.getElementById('import-json-input');
    var stripCb     = document.getElementById('export-strip-imgs');
    var exportMdBtn = document.querySelector('[data-act="export-md-all"]');
    var exportCsvBtn = document.querySelector('[data-act="export-csv"]');
    if (exportBtn) exportBtn.addEventListener('click', function () {
      window.MyFbStorage.exportToFile(STATE, { stripDataUrls: stripCb && stripCb.checked });
      window.MyFbToast.show(_t('toast.exported', 'Fichier exporté.'), 'success');
    });
    if (exportMdBtn) exportMdBtn.addEventListener('click', function () {
      if (window.MyFbExport) window.MyFbExport.downloadBundle();
    });
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', function () {
      if (window.MyFbExport) window.MyFbExport.downloadCsv();
    });
    if (importBtn && importInput) {
      importBtn.addEventListener('click', function () { importInput.click(); });
      importInput.addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var bundle = JSON.parse(reader.result);
            // Snapshot current state so user can undo the import
            if (window.MyFbUndo) window.MyFbUndo.push({
              demandes:       JSON.parse(JSON.stringify(STATE.demandes)),
              currentDemande: JSON.parse(JSON.stringify(STATE.currentDemande)),
            });
            var result = window.MyFbStorage.importBundle(STATE, bundle, { mode: 'replace' });
            if (!result.ok) {
              window.MyFbToast.show(_t('toast.import_invalid', 'Fichier JSON invalide.'), 'error');
              return;
            }
            window.MyFbRenderer.renderDemandeEditor();
            window.MyFbRenderer.renderSegments();
            window.MyFbRenderer.updateArmedUi();
            window.MyFbRenderer.updateMasterBtnLabel();
            window.MyFbStorage.persist(STATE, { skipUndo: true });
            window.MyFbToast.showAction(
              _t('toast.imported', 'Import OK — {n} demande(s) chargée(s).', { n: result.imported }),
              _t('toast.undo_action', 'Annuler'),
              H.performUndo,
              { kind: 'success', duration: 6000 }
            );
          } catch (err) {
            window.MyFbToast.show(_t('toast.import_invalid', 'Fichier JSON invalide.'), 'error');
          }
        };
        reader.readAsText(file);
        e.target.value = '';
      });
    }
  }

  function _bindWizardReopen() {
    var REFS = ctx.REFS, STATE = ctx.STATE;
    var btn = document.getElementById('btn-revoir-guide');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (REFS.settingsPopover) REFS.settingsPopover.classList.remove('is-open');
      if (window.MyFbWizard) window.MyFbWizard.open(STATE, function () { window.MyFbStorage.persist(STATE); });
    });
  }

  function _bindButtonVisibility() {
    var STATE = ctx.STATE;
    var ALL = (window.MyFb && window.MyFb.ALL_BUTTONS) || [];
    ALL.forEach(function (def) {
      var cb = document.getElementById('vis-' + def.key);
      if (!cb) return;
      cb.addEventListener('change', function () {
        STATE.visibleButtons[def.key] = cb.checked;
        window.MyFbRenderer.renderSegments();
        window.MyFbStorage.persist(STATE);
      });
    });
  }

  function _bindAutoOpenToggles() {
    var STATE = ctx.STATE;
    ['aop-active', 'aop-done', 'aop-ai'].forEach(function (id) {
      var cb = document.getElementById(id);
      if (!cb) return;
      cb.addEventListener('change', function () {
        if (id === 'aop-active') STATE.autoOpenOnKnownActive = cb.checked;
        if (id === 'aop-done')   STATE.autoOpenOnKnownDone   = cb.checked;
        if (id === 'aop-ai')     STATE.autoOpenOnAiPage      = cb.checked;
        window.MyFbStorage.persist(STATE);
      });
    });
  }

  function _bindTheme() {
    var STATE = ctx.STATE;
    var grid  = document.getElementById('sp-theme-grid');
    function apply(theme) {
      document.documentElement.setAttribute('data-theme', theme || 'dark');
      if (grid) Array.prototype.forEach.call(grid.querySelectorAll('.sp-theme-btn'), function (b) {
        var on = b.dataset.theme === theme;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    if (grid) grid.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-theme]');
      if (!btn) return;
      STATE.theme = btn.dataset.theme;
      apply(STATE.theme);
      window.MyFbStorage.persist(STATE);
    });
    apply(STATE.theme || 'dark');
  }

  function _bindTopbarPosition() {
    var STATE = ctx.STATE;
    var cb   = document.getElementById('topbar-bottom');
    var root = document.querySelector('.myfb-root');
    function apply() { if (root) root.classList.toggle('topbar-bottom', STATE.topbarPosition === 'bottom'); }
    if (cb) cb.addEventListener('change', function () {
      STATE.topbarPosition = cb.checked ? 'bottom' : 'top';
      apply();
      window.MyFbStorage.persist(STATE);
    });
    apply();
  }

  function _bindPrivacyScrub() {
    var STATE = ctx.STATE;
    var cb    = document.getElementById('privacy-scrub');
    if (!cb) return;
    cb.checked = STATE.privacyScrub !== false;
    cb.addEventListener('change', function () {
      STATE.privacyScrub = cb.checked;
      window.MyFbStorage.persist(STATE);
    });
    var doc = document.querySelector('[data-act="open-privacy-doc"]');
    if (doc) doc.addEventListener('click', function () {
      try { chrome.tabs.create({ url: chrome.runtime.getURL('PRIVACY.md') }); } catch (_) {}
    });
  }

  // Populate the Réglages > Raccourcis panel from chrome.commands.getAll().
  // Chrome MV3 forbids extensions from writing keyboard bindings at runtime;
  // the panel is read-only + a button to chrome://extensions/shortcuts.
  function _bindShortcutPanel() {
    var ul = document.getElementById('sp-shortcut-list');
    // Bind every "open shortcuts" button (Aide section + Raccourcis section)
    document.querySelectorAll('[data-act="open-shortcuts"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        try { chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); } catch (_) {}
      });
    });
    if (!ul) return;
    function renderRows(commands) {
      ul.innerHTML = '';
      if (!commands.length) {
        var empty = document.createElement('li');
        empty.className = 'sp-shortcut-row sp-shortcut-empty';
        empty.textContent = _t('settings.shortcuts.empty', 'Aucun raccourci déclaré.');
        ul.appendChild(empty);
        return;
      }
      commands.forEach(function (cmd) {
        var row  = document.createElement('li');
        row.className = 'sp-shortcut-row' + (cmd.shortcut ? '' : ' is-unbound');
        var name = document.createElement('span');
        name.className   = 'sp-shortcut-name';
        name.textContent = cmd.description || cmd.name;
        row.appendChild(name);
        var keys = document.createElement('span');
        keys.className = 'sp-shortcut-keys' + (cmd.shortcut ? '' : ' is-unbound');
        if (cmd.shortcut) {
          // Each token (Alt, Shift, F, etc.) → its own <kbd>
          cmd.shortcut.split(/\+|\s+/).filter(Boolean).forEach(function (tok) {
            var kb = document.createElement('kbd');
            kb.textContent = tok;
            keys.appendChild(kb);
          });
        } else {
          var kb = document.createElement('kbd');
          kb.textContent = _t('settings.shortcuts.unbound', 'non assigné');
          keys.appendChild(kb);
        }
        row.appendChild(keys);
        ul.appendChild(row);
      });
    }
    if (!chrome || !chrome.commands || !chrome.commands.getAll) {
      renderRows([]);
      return;
    }
    chrome.commands.getAll(function (cmds) { renderRows(cmds || []); });
  }

  function _bindShowConsoleBtn() {
    var STATE = ctx.STATE;
    var cb  = document.getElementById('show-console-btn');
    var btn = document.querySelector('.topbar-logs-btn');
    function apply() { if (btn) btn.hidden = !STATE.showConsoleBtn; }
    if (cb) cb.addEventListener('change', function () {
      STATE.showConsoleBtn = cb.checked;
      apply();
      window.MyFbStorage.persist(STATE);
    });
    apply();
  }

  function _bindBehaviourToggles() {
    var STATE = ctx.STATE;
    var cbHideTa  = document.getElementById('hide-ai-textarea');
    var cbAutoSub = document.getElementById('auto-submit-inject');

    function syncDep() {
      if (!cbHideTa || !cbAutoSub) return;
      var on = cbAutoSub.checked;
      cbHideTa.disabled = !on;
      var row = cbHideTa.closest('.sp-toggle-row');
      if (row) row.classList.toggle('is-disabled', !on);
      if (!on && cbHideTa.checked) {
        cbHideTa.checked = false;
        STATE.hideAiTextarea = false;
        try {
          chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs && tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'myfb:hide-ai-textarea', hide: false }).catch(function () {});
          });
        } catch (_) {}
      }
    }

    if (cbHideTa) cbHideTa.addEventListener('change', function () {
      STATE.hideAiTextarea = cbHideTa.checked;
      window.MyFbStorage.persist(STATE);
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (tabs && tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'myfb:hide-ai-textarea', hide: cbHideTa.checked }).catch(function () {});
        });
      } catch (_) {}
    });
    if (cbAutoSub) cbAutoSub.addEventListener('change', function () {
      STATE.autoSubmitAfterInject = cbAutoSub.checked;
      syncDep();
      window.MyFbStorage.persist(STATE);
    });
    syncDep();
    var cbStaysArmed = document.getElementById('save-stays-armed');
    if (cbStaysArmed) cbStaysArmed.addEventListener('change', function () {
      STATE.saveStaysArmed = cbStaysArmed.checked;
      window.MyFbStorage.persist(STATE);
    });
    // Shortcut mode radio (smart / toggle / hold) — keyed by name="shortcut-mode"
    document.querySelectorAll('input[name="shortcut-mode"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        STATE.shortcutMode = radio.value;
        window.MyFbStorage.persist(STATE);
      });
    });
  }

  function _bindUiLangButtons() {
    var STATE = ctx.STATE;
    var grid = document.getElementById('sp-lang-grid');
    if (!grid) return;
    grid.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-lang]');
      if (!btn) return;
      var lang = btn.dataset.lang;
      STATE.uiLang = lang;
      window.MyFbI18n.setLang(lang);
      window.MyFbRenderer.renderSegments();
      window.MyFbRenderer.renderDemandeRefsStrip();
      window.MyFbRenderer.updateMasterBtnLabel();
      window.MyFbRenderer.updateErrorsBadges();
      window.MyFbStorage.persist(STATE);
    });
  }

  function _bindMicSettings() {
    var REFS = ctx.REFS, STATE = ctx.STATE;
    if (REFS.micDeviceSelect) REFS.micDeviceSelect.addEventListener('change', function (e) {
      STATE.micDeviceId = e.target.value;
      window.MyFbStorage.persist(STATE);
      if (window.MyFbSpeech.getMicState().stream) window.MyFbSpeech.startMicTest(STATE.micDeviceId);
    });
    if (REFS.micTestBtn) REFS.micTestBtn.addEventListener('click', function () {
      var MIC = window.MyFbSpeech.getMicState();
      if (MIC && MIC.stream) window.MyFbSpeech.stopMicTest();
      else window.MyFbSpeech.startMicTest(STATE.micDeviceId);
    });
    if (REFS.micRefreshBtn) REFS.micRefreshBtn.addEventListener('click', function () {
      window.MyFbSpeech.refreshMicDevices(true);
    });
  }

  function _bindEditorLiveSync() {
    var REFS = ctx.REFS, STATE = ctx.STATE;
    var timer = null;
    document.addEventListener('input', function (e) {
      if (e.target !== REFS.demandeEditor) return;
      clearTimeout(timer);
      // Token-counter is cheap, update on every keystroke.
      if (window.MyFbRender && window.MyFbRender.tokenCounter) {
        window.MyFbSession.syncCurrentDemandeFromEditor();
        window.MyFbRender.tokenCounter.update();
      }
      timer = setTimeout(function () {
        window.MyFbSession.syncCurrentDemandeFromEditor();
        window.MyFbRenderer.renderDemandeRefsStrip();
        window.MyFbStorage.persist(STATE);
      }, 400);
    });
  }

  function _bindRefChipEdit() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.ref-details-btn, .ref-chip-quick-annotate');
      if (!btn) return;
      e.stopPropagation(); e.preventDefault();
      var chip = btn.closest('.ref-chip');
      if (!chip) return;
      var refIdx    = Number(chip.dataset.ref);
      var demKeyRaw = chip.dataset.demKey;
      var demKey    = (demKeyRaw === 'current' || demKeyRaw === undefined) ? 'current' : Number(demKeyRaw);
      window.MyFbSession.editRef(demKey, refIdx, btn.dataset.editType);
    });
  }

  function _bindFilterBadges() {
    var STATE = ctx.STATE;
    document.addEventListener('click', function (e) {
      // Eye picto inside a domain badge : open the page in a new tab
      // AND apply the matching filter (acts as if the badge was clicked).
      var openBtn = e.target.closest && e.target.closest('.seg-filter-badge-open[data-open-url]');
      if (openBtn) {
        e.stopPropagation();
        e.preventDefault();
        var url = openBtn.getAttribute('data-open-url');
        var fk  = openBtn.getAttribute('data-filter-key');
        var fv  = openBtn.getAttribute('data-filter-val');
        if (url) {
          try { chrome.tabs.create({ url: url, active: true }); }
          catch (_) { window.open(url, '_blank', 'noopener,noreferrer'); }
        }
        if (fk && fv !== null) {
          STATE[fk] = fv;
          window.MyFbRenderer.renderSegments();
        }
        return;
      }
      var badge = e.target.closest('.seg-filter-badge[data-fk]');
      if (badge) {
        e.stopPropagation();
        var key = badge.dataset.fk, val = badge.dataset.fv;
        if (key && val !== undefined) {
          STATE[key] = val;
          window.MyFbRenderer.renderSegments();
        }
        return;
      }
      var chip = e.target.closest('.filter-chip[data-fk]');
      if (chip) {
        e.stopPropagation();
        var k = chip.dataset.fk;
        if (k) {
          STATE[k] = '';
          if (k === 'conversationFilter') STATE.pendingConversationUrl = null;
          if (k === 'repoFilter')         STATE.pendingRepoId = null;
          window.MyFbRenderer.renderSegments();
        }
      }
    });
  }

  function _bindStatusBar() {
    var REFS = ctx.REFS;
    if (!REFS.status) return;
    REFS.status.addEventListener('click', async function () {
      if (REFS.status.dataset.kind !== 'error') return;
      var action = REFS.status.dataset.action;
      if (action === 'reload-active-tab') {
        var resp = await H.sendBg({ type: H.msgKey('RELOAD_ACTIVE_TAB') });
        if (resp && resp.ok) window.MyFbToast.show(_t('toast.tab_reloaded', 'Onglet rechargé.'), 'success');
      }
    });
  }

  function bind() {
    _bindSessionButtons();
    _bindTools();
    _bindFooter();
    _bindLangSelect();
    _bindShotButtons();
    _bindFileImport();
    _bindErrorsButton();
    if (window.MyFbBindings.bindTemplatesPopover) {
      window.MyFbBindings.bindTemplatesPopover(_autoArm);
    }
    _bindSortToggle();
    _bindSearchToggle();
    _bindFontSize();
    _bindHistorySearch();
    _bindSettingsPopover();
    _bindReloadModal();
    _bindSyncToggle();
    _bindExportImport();
    _bindWizardReopen();
    _bindButtonVisibility();
    _bindAutoOpenToggles();
    _bindBehaviourToggles();
    _bindShowConsoleBtn();
    _bindShortcutPanel();
    _bindPrivacyScrub();
    _bindTopbarPosition();
    _bindTheme();
    _bindUiLangButtons();
    _bindMicSettings();
    _bindEditorLiveSync();
    _bindRefChipEdit();
    _bindFilterBadges();
    _bindStatusBar();
  }

  window.MyFbBindings.events = { bind: bind };
})(window);
