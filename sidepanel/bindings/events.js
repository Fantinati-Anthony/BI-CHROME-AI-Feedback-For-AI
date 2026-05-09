/**
 * BIAIF Bindings — UI events
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
  window.BIAIFBindings = window.BIAIFBindings || {};
  var ctx   = window.BIAIFBindings.ctx;
  var H     = window.BIAIFBindings.helpers;
  var CFG   = (window.BIAIF && window.BIAIF.config && window.BIAIF.config.ui) || {};
  var UTILS = (window.BIAIF && window.BIAIF.utils) || {};
  function _t(k, fb, vars) { return UTILS.t ? UTILS.t(k, fb, vars) : (fb || k); }

  // Arme la session silencieusement (sans démarrer mic/picker).
  // Appelé par tous les boutons outils afin d'afficher la demande-zone.
  function _autoArm() {
    var STATE = ctx.STATE, REFS = ctx.REFS;
    if (STATE.armed) return;
    STATE.armed = true;
    if (REFS.masterBtn) REFS.masterBtn.classList.add('armed');
    window.BIAIFRenderer.updateArmedUi();
    window.BIAIFRenderer.updateMasterBtnLabel();
  }

  function _bindSessionButtons() {
    var REFS = ctx.REFS, STATE = ctx.STATE;
    if (REFS.masterBtn) REFS.masterBtn.addEventListener('click', function () {
      if (typeof STATE.editingDemandeIdx === 'number') {
        window.BIAIFSession.exitEditMode();
      } else {
        window.BIAIFSession.finalizeDemande(false);
        H.updateLinkedSessionBanner();
      }
    });
    // Stop button kept for backward-compat (CSS hides it in new UX).
    if (REFS.stopBtn) REFS.stopBtn.addEventListener('click', function () {
      window.BIAIFSession.stopSession();
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
        window.BIAIFRenderer.renderDemandeRefsStrip();
        _autoArm();
        STATE.pendingConversationUrl = null;
        STATE.pendingRepoId = null;
        H.updateLinkedSessionBanner();
        window.BIAIFStorage.persist(STATE);
      });
    });
    // "✕ Disarm" — saves any pending work and goes back to history view.
    var disarmBtn = document.querySelector('[data-act="disarm"]');
    if (disarmBtn) disarmBtn.addEventListener('click', function () {
      window.BIAIFSession.disarm();
    });
  }

  function _bindTools() {
    var REFS = ctx.REFS;
    if (REFS.pickerBtn) REFS.pickerBtn.addEventListener('click', async function () {
      _autoArm();
      var resp = await H.sendBg({ type: H.msgKey('PICKER_TOGGLE') });
      if (resp && resp.error) {
        window.BIAIFToast.show(
          _t('toast.picker_fail', 'Picker KO : ' + H.decodeContentScriptError(resp.error),
            { err: H.decodeContentScriptError(resp.error) }),
          'error');
      }
    });
    if (REFS.micBtn) REFS.micBtn.addEventListener('click', function () {
      _autoArm();
      window.BIAIFSpeech.toggleMic();
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
    if (REFS.copyBtn)     REFS.copyBtn.addEventListener('click',     function () { window.BIAIFExport.copyPrompt(); });
    if (REFS.downloadBtn) REFS.downloadBtn.addEventListener('click', function () { window.BIAIFExport.downloadBundle(); });

    // Empty-state "Voir le guide" — re-opens the onboarding wizard.
    var guideBtn = document.querySelector('[data-act="open-wizard"]');
    if (guideBtn) guideBtn.addEventListener('click', function () {
      if (window.BIAIFWizard) window.BIAIFWizard.open(STATE, function () { window.BIAIFStorage.persist(STATE); });
    });
  }

  function _bindLangSelect() {
    var REFS = ctx.REFS, STATE = ctx.STATE;
    if (!REFS.langSelect) return;
    REFS.langSelect.addEventListener('change', function (e) {
      STATE.lang = e.target.value;
      var MIC = window.BIAIFSpeech.getMicState();
      if (MIC && MIC.rec) MIC.rec.lang = STATE.lang;
      window.BIAIFStorage.persist(STATE);
    });
  }

  function _bindShotButtons() {
    var REFS = ctx.REFS;
    REFS.shotButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        _autoArm();
        H.closeCaptureSubline();
        window.BIAIFSession.runShotMode(btn.dataset.shot);
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
      window.BIAIFRenderer.updateSortToggleLabel();
      window.BIAIFRenderer.renderSegments();
      window.BIAIFStorage.persist(STATE);
    }
    var ascBtn  = document.querySelector('[data-act="sort-asc"]');
    var descBtn = document.querySelector('[data-act="sort-desc"]');
    if (ascBtn)  ascBtn.addEventListener('click',  function () { setSort('asc'); });
    if (descBtn) descBtn.addEventListener('click', function () { setSort('desc'); });
    window.BIAIFRenderer.updateSortToggleLabel();
  }

  // Toggle search input visibility (loupe button)
  function _bindSearchToggle() {
    // The loupe (now [data-act="filter-toggle"]) opens the full filter
    // panel — text search + tag/domain/page/conv/repo selectors. The
    // legacy [data-act="search-toggle"] handler is kept as a fallback
    // alias for backwards compat with anyone wiring against the old name.
    document.querySelectorAll('[data-act="filter-toggle"], [data-act="search-toggle"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (window.BIAIFFilterPanel) window.BIAIFFilterPanel.toggle();
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
        window.BIAIFRenderer.bumpSegFontSize(a === 'seg-font-up' ? +1 : -1);
        H.updateSpFontVal();
      } else {
        window.BIAIFRenderer.bumpSegTextLines(a === 'seg-lines-up' ? +1 : -1);
        H.updateSpLinesVal();
      }
    });
    window.BIAIFRenderer.applySegFontSize();
    window.BIAIFRenderer.applySegTextLines();
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
        window.BIAIFRenderer.renderSegments();
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
        window.BIAIFToast.show(_t('toast.tab_reload_retry', 'Onglet rechargé.'), 'success');
      } else {
        window.BIAIFToast.show(
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
    if (!window.BIAIFStorage.watchSync) return;
    _syncUnsubscribe = window.BIAIFStorage.watchSync(STATE, function () {
      // Live update from another device → re-render visible UI.
      window.BIAIFRenderer.renderSegments();
      window.BIAIFRenderer.updateMasterBtnLabel();
      window.BIAIFRenderer.updateArmedUi();
      window.BIAIFToast.show(_t('toast.sync_remote_update', 'Réglages synchronisés depuis un autre appareil.'), 'info', 2500);
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
      window.BIAIFStorage.persist(STATE);
      if (cb.checked) {
        _ensureSyncWatcher(STATE);
        if (window.BIAIFStorage.pullFromSync) {
          var pulled = await window.BIAIFStorage.pullFromSync(STATE);
          if (pulled) {
            window.BIAIFRenderer.renderSegments();
            window.BIAIFRenderer.updateMasterBtnLabel();
            window.BIAIFRenderer.updateArmedUi();
            window.BIAIFToast.show(_t('toast.sync_pulled', 'Synchronisation réussie.'), 'success');
          } else {
            window.BIAIFToast.show(_t('toast.sync_enabled', 'Sync activée — vos réglages seront partagés.'), 'info');
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
      window.BIAIFStorage.exportToFile(STATE, { stripDataUrls: stripCb && stripCb.checked });
      window.BIAIFToast.show(_t('toast.exported', 'Fichier exporté.'), 'success');
    });
    if (exportMdBtn) exportMdBtn.addEventListener('click', function () {
      if (window.BIAIFExport) window.BIAIFExport.downloadBundle();
    });
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', function () {
      if (window.BIAIFExport) window.BIAIFExport.downloadCsv();
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
            if (window.BIAIFUndo) window.BIAIFUndo.push({
              demandes:       JSON.parse(JSON.stringify(STATE.demandes)),
              currentDemande: JSON.parse(JSON.stringify(STATE.currentDemande)),
            });
            var result = window.BIAIFStorage.importBundle(STATE, bundle, { mode: 'replace' });
            if (!result.ok) {
              window.BIAIFToast.show(_t('toast.import_invalid', 'Fichier JSON invalide.'), 'error');
              return;
            }
            window.BIAIFRenderer.renderDemandeEditor();
            window.BIAIFRenderer.renderSegments();
            window.BIAIFRenderer.updateArmedUi();
            window.BIAIFRenderer.updateMasterBtnLabel();
            window.BIAIFStorage.persist(STATE, { skipUndo: true });
            window.BIAIFToast.showAction(
              _t('toast.imported', 'Import OK — {n} demande(s) chargée(s).', { n: result.imported }),
              _t('toast.undo_action', 'Annuler'),
              H.performUndo,
              { kind: 'success', duration: 6000 }
            );
          } catch (err) {
            window.BIAIFToast.show(_t('toast.import_invalid', 'Fichier JSON invalide.'), 'error');
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
      if (window.BIAIFWizard) window.BIAIFWizard.open(STATE, function () { window.BIAIFStorage.persist(STATE); });
    });
  }

  function _bindButtonVisibility() {
    var STATE = ctx.STATE;
    var ALL = (window.BIAIF && window.BIAIF.ALL_BUTTONS) || [];
    ALL.forEach(function (def) {
      var cb = document.getElementById('vis-' + def.key);
      if (!cb) return;
      cb.addEventListener('change', function () {
        STATE.visibleButtons[def.key] = cb.checked;
        window.BIAIFRenderer.renderSegments();
        window.BIAIFStorage.persist(STATE);
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
        window.BIAIFStorage.persist(STATE);
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
      window.BIAIFStorage.persist(STATE);
    });
    apply(STATE.theme || 'dark');
  }

  function _bindTopbarPosition() {
    var STATE = ctx.STATE;
    var cb   = document.getElementById('topbar-bottom');
    var root = document.querySelector('.biaif-root');
    function apply() { if (root) root.classList.toggle('topbar-bottom', STATE.topbarPosition === 'bottom'); }
    if (cb) cb.addEventListener('change', function () {
      STATE.topbarPosition = cb.checked ? 'bottom' : 'top';
      apply();
      window.BIAIFStorage.persist(STATE);
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
      window.BIAIFStorage.persist(STATE);
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
      window.BIAIFStorage.persist(STATE);
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
            if (tabs && tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'biaif:hide-ai-textarea', hide: false }).catch(function () {});
          });
        } catch (_) {}
      }
    }

    if (cbHideTa) cbHideTa.addEventListener('change', function () {
      STATE.hideAiTextarea = cbHideTa.checked;
      window.BIAIFStorage.persist(STATE);
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (tabs && tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'biaif:hide-ai-textarea', hide: cbHideTa.checked }).catch(function () {});
        });
      } catch (_) {}
    });
    if (cbAutoSub) cbAutoSub.addEventListener('change', function () {
      STATE.autoSubmitAfterInject = cbAutoSub.checked;
      syncDep();
      window.BIAIFStorage.persist(STATE);
    });
    syncDep();
    var cbStaysArmed = document.getElementById('save-stays-armed');
    if (cbStaysArmed) cbStaysArmed.addEventListener('change', function () {
      STATE.saveStaysArmed = cbStaysArmed.checked;
      window.BIAIFStorage.persist(STATE);
    });
    // Shortcut mode radio (smart / toggle / hold) — keyed by name="shortcut-mode"
    document.querySelectorAll('input[name="shortcut-mode"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        STATE.shortcutMode = radio.value;
        window.BIAIFStorage.persist(STATE);
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
      window.BIAIFi18n.setLang(lang);
      window.BIAIFRenderer.renderSegments();
      window.BIAIFRenderer.renderDemandeRefsStrip();
      window.BIAIFRenderer.updateMasterBtnLabel();
      window.BIAIFRenderer.updateErrorsBadges();
      window.BIAIFStorage.persist(STATE);
    });
  }

  function _bindMicSettings() {
    var REFS = ctx.REFS, STATE = ctx.STATE;
    if (REFS.micDeviceSelect) REFS.micDeviceSelect.addEventListener('change', function (e) {
      STATE.micDeviceId = e.target.value;
      window.BIAIFStorage.persist(STATE);
      if (window.BIAIFSpeech.getMicState().stream) window.BIAIFSpeech.startMicTest(STATE.micDeviceId);
    });
    if (REFS.micTestBtn) REFS.micTestBtn.addEventListener('click', function () {
      var MIC = window.BIAIFSpeech.getMicState();
      if (MIC && MIC.stream) window.BIAIFSpeech.stopMicTest();
      else window.BIAIFSpeech.startMicTest(STATE.micDeviceId);
    });
    if (REFS.micRefreshBtn) REFS.micRefreshBtn.addEventListener('click', function () {
      window.BIAIFSpeech.refreshMicDevices(true);
    });
  }

  function _bindEditorLiveSync() {
    var REFS = ctx.REFS, STATE = ctx.STATE;
    var timer = null;
    document.addEventListener('input', function (e) {
      if (e.target !== REFS.demandeEditor) return;
      clearTimeout(timer);
      // Token-counter is cheap, update on every keystroke.
      if (window.BIAIFRender && window.BIAIFRender.tokenCounter) {
        window.BIAIFSession.syncCurrentDemandeFromEditor();
        window.BIAIFRender.tokenCounter.update();
      }
      timer = setTimeout(function () {
        window.BIAIFSession.syncCurrentDemandeFromEditor();
        window.BIAIFRenderer.renderDemandeRefsStrip();
        window.BIAIFStorage.persist(STATE);
      }, 400);
    });
  }

  function _bindRefChipEdit() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.ref-details-btn');
      if (!btn) return;
      e.stopPropagation(); e.preventDefault();
      var chip = btn.closest('.ref-chip');
      if (!chip) return;
      var refIdx    = Number(chip.dataset.ref);
      var demKeyRaw = chip.dataset.demKey;
      var demKey    = (demKeyRaw === 'current' || demKeyRaw === undefined) ? 'current' : Number(demKeyRaw);
      window.BIAIFSession.editRef(demKey, refIdx, btn.dataset.editType);
    });
  }

  function _bindFilterBadges() {
    var STATE = ctx.STATE;
    document.addEventListener('click', function (e) {
      var badge = e.target.closest('.seg-filter-badge[data-fk]');
      if (badge) {
        e.stopPropagation();
        var key = badge.dataset.fk, val = badge.dataset.fv;
        if (key && val !== undefined) {
          STATE[key] = val;
          window.BIAIFRenderer.renderSegments();
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
          window.BIAIFRenderer.renderSegments();
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
        if (resp && resp.ok) window.BIAIFToast.show(_t('toast.tab_reloaded', 'Onglet rechargé.'), 'success');
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
    if (window.BIAIFBindings.bindTemplatesPopover) {
      window.BIAIFBindings.bindTemplatesPopover(_autoArm);
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

  window.BIAIFBindings.events = { bind: bind };
})(window);
