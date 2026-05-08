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
    // "Nouvelle conv." — arms the session and resets conversation context.
    var newConvBtn = document.querySelector('[data-act="new-conv"]');
    if (newConvBtn) newConvBtn.addEventListener('click', function () {
      _autoArm();
      STATE.pendingConversationUrl = null;
      STATE.pendingRepoId = null;
      H.updateLinkedSessionBanner();
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

  function _bindErrorsButton() {
    var btn = document.querySelector('[data-act="open-errors"]');
    if (btn) btn.addEventListener('click', function () { _autoArm(); H.addAllConsoleErrors(); });
  }

  function _bindSortToggle() {
    var REFS = ctx.REFS, STATE = ctx.STATE;
    if (REFS.sortToggle) REFS.sortToggle.addEventListener('click', function () {
      STATE.sortOrder = STATE.sortOrder === 'desc' ? 'asc' : 'desc';
      window.BIAIFRenderer.updateSortToggleLabel();
      window.BIAIFRenderer.renderSegments();
      window.BIAIFStorage.persist(STATE);
    });
    window.BIAIFRenderer.updateSortToggleLabel();
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
    var keys = ['inject', 'vscode', 'copilot', 'copy', 'download',
      'claude_online', 'chatgpt', 'gemini', 'perplexity', 'grok', 'lechat', 'deepseek'];
    keys.forEach(function (key) {
      var cb = document.getElementById('vis-' + key);
      if (!cb) return;
      cb.addEventListener('change', function () {
        STATE.visibleButtons[key] = cb.checked;
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
    _bindSortToggle();
    _bindFontSize();
    _bindHistorySearch();
    _bindSettingsPopover();
    _bindReloadModal();
    _bindWizardReopen();
    _bindButtonVisibility();
    _bindAutoOpenToggles();
    _bindBehaviourToggles();
    _bindUiLangButtons();
    _bindMicSettings();
    _bindEditorLiveSync();
    _bindRefChipEdit();
    _bindFilterBadges();
    _bindStatusBar();
  }

  window.BIAIFBindings.events = { bind: bind };
})(window);
