/**
 * BIAIF Bindings — UI events
 *
 * All click / change / input listeners on the side panel UI. Grouped by
 * feature in the order they were declared in the original sidepanel.js
 * (kept stable so a `git blame` still tells the story).
 *
 * Sections:
 *   1. Session master button + stop
 *   2. Picker / mic toggle
 *   3. Footer (clear / copy / download)
 *   4. Speech language select
 *   5. Shot mode buttons + capture subline
 *   6. File import button
 *   7. Errors button
 *   8. Sort toggle
 *   9. Segment font size +/-
 *  10. History search (debounced)
 *  11. Settings popover open/close + shortcuts page
 *  12. Reload modal
 *  13. Onboarding wizard re-open
 *  14. Button-visibility checkboxes
 *  15. Auto-open / behaviour toggles (with hide-textarea ↔ auto-submit dep)
 *  16. UI language buttons
 *  17. Mic settings (device, test, refresh)
 *  18. Demande editor live sync (debounced)
 *  19. Delegated handlers: ref-chip Modifier, filter badges, filter chip ✕
 *  20. Status bar click (legacy)
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
    var newConvBtn = document.querySelector('[data-act="new-conv"]');
    if (newConvBtn) newConvBtn.addEventListener('click', function () {
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
    var REFS = ctx.REFS;
    if (REFS.clearBtn)    REFS.clearBtn.addEventListener('click',    function () { H.clearAll(); });
    if (REFS.copyBtn)     REFS.copyBtn.addEventListener('click',     function () { window.BIAIFExport.copyPrompt(); });
    if (REFS.downloadBtn) REFS.downloadBtn.addEventListener('click', function () { window.BIAIFExport.downloadBundle(); });
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
      var sub = document.querySelector('.quick-tools-subline');
      if (!sub || sub.hasAttribute('hidden')) return;
      if (e.target.closest('[data-act="capture-toggle"]') || e.target.closest('.quick-tools-subline')) return;
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

  function _bindTemplatesPopover() {
    var STATE   = ctx.STATE;
    var btn     = document.querySelector('[data-act="open-templates"]');
    var popover = document.getElementById('templates-popover');
    var list    = popover && popover.querySelector('.templates-list');
    var saveBtn = popover && popover.querySelector('[data-act="template-save-current"]');
    if (!btn || !popover || !list) return;

    function renderList() {
      list.innerHTML = '';
      var items = (window.BIAIFTemplates && window.BIAIFTemplates.list()) || [];
      items.forEach(function (t) {
        var li = document.createElement('li');
        li.className = 'template-item';
        li.dataset.id = t.id;
        var name = document.createElement('span');
        name.className = 'template-item-name'; name.textContent = t.name;
        var prev = document.createElement('span');
        prev.className = 'template-item-preview';
        prev.textContent = t.body.replace(/\s+/g, ' ').slice(0, 60);
        prev.title = t.body;
        var del = document.createElement('button');
        del.className = 'template-item-del'; del.textContent = '×';
        del.setAttribute('aria-label', _t('templates.delete', 'Supprimer ce modèle'));
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          window.BIAIFTemplates.remove(t.id);
          renderList();
        });
        li.appendChild(name); li.appendChild(prev); li.appendChild(del);
        li.addEventListener('click', function () {
          _autoArm();
          window.BIAIFTemplates.insertIntoEditor(t.id);
          close();
          window.BIAIFToast.show(_t('toast.template_inserted', 'Modèle inséré.'), 'success', 1800);
        });
        list.appendChild(li);
      });
    }

    function open()  {
      _autoArm();
      H.closeCaptureSubline();
      renderList();
      popover.removeAttribute('hidden');
      btn.setAttribute('aria-expanded', 'true');
    }
    function close() {
      popover.setAttribute('hidden', '');
      btn.setAttribute('aria-expanded', 'false');
    }
    function toggle() { popover.hasAttribute('hidden') ? open() : close(); }

    btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    if (saveBtn) saveBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var entry = window.BIAIFTemplates && window.BIAIFTemplates.saveCurrentAsTemplate();
      if (!entry) {
        window.BIAIFToast.show(_t('toast.template_empty', 'Rien à enregistrer — saisissez du texte.'), 'info');
        return;
      }
      renderList();
      window.BIAIFToast.show(_t('toast.template_saved', 'Modèle enregistré.'), 'success');
    });
    document.addEventListener('click', function (e) {
      if (popover.hasAttribute('hidden')) return;
      if (e.target.closest('#templates-popover') || e.target.closest('[data-act="open-templates"]')) return;
      close();
    });
  }

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
    var btn   = document.querySelector('[data-act="search-toggle"]');
    var input = document.getElementById('history-search');
    if (!btn || !input) return;
    btn.addEventListener('click', function () {
      var willOpen = input.hasAttribute('hidden');
      if (willOpen) {
        input.removeAttribute('hidden');
        btn.setAttribute('aria-expanded', 'true');
        setTimeout(function () { input.focus(); }, 30);
      } else {
        input.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', 'false');
        ctx.STATE.searchQuery = '';
        input.value = '';
        window.BIAIFRenderer.renderSegments();
      }
    });
  }

  function _bindFontSize() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act="seg-font-down"],[data-act="seg-font-up"]');
      if (!btn) return;
      window.BIAIFRenderer.bumpSegFontSize(btn.dataset.act === 'seg-font-up' ? +1 : -1);
      H.updateSpFontVal();
    });
    window.BIAIFRenderer.applySegFontSize();
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
    if (exportBtn) exportBtn.addEventListener('click', function () {
      window.BIAIFStorage.exportToFile(STATE, { stripDataUrls: stripCb && stripCb.checked });
      window.BIAIFToast.show(_t('toast.exported', 'Fichier exporté.'), 'success');
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
    _bindTemplatesPopover();
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
