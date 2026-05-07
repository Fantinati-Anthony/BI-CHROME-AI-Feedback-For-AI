/**
 * BIAIF Side Panel — v0.4 — Orchestrator
 *
 * Architecture v0.4 (modular):
 *   shared/constants.js     → BIAIF.MSG, BIAIF.VERSION, BIAIF.STORAGE_KEY
 *   sidepanel/toast.js      → BIAIFToast
 *   sidepanel/undo.js       → BIAIFUndo
 *   sidepanel/storage.js    → BIAIFStorage
 *   sidepanel/renderer.js   → BIAIFRenderer
 *   sidepanel/speech.js     → BIAIFSpeech
 *   sidepanel/session.js    → BIAIFSession
 *   sidepanel/export.js     → BIAIFExport
 *
 * This file: STATE declaration, REFS cache, bootstrap, event binding,
 *   runtime message routing, and glue helpers.
 */

(function () {
  'use strict';

  // ============================================================
  // STATE
  // ============================================================

  const STATE = {
    armed:              false,
    pickerActive:       false,
    micActive:          false,
    currentInterim:     '',
    currentDemande:     { text: '', refs: [], pageUrl: null },
    demandes:           [],
    lastShot:           null,
    lastShotMode:       null,
    sortOrder:          'desc',
    segFontSize:        13,
    lang:               'fr-FR',
    micDeviceId:        '',
    replacingRef:       null,
    dictationTarget:    'current',
    modalTarget:        'current',
    consoleErrors:      [],
    editingDemandeIdx:  null,
    searchQuery:        '',
    visibleButtons:     {
      inject: true, vscode: true, copilot: true, copy: true, download: true,
      claude_online: false, chatgpt: false, gemini: false, perplexity: false,
      grok: false, lechat: false, deepseek: false,
    },
    uiLang:              '',
    conversationFilter:  '',   // exact URL of AI conversation currently filtered
    pendingConversationUrl: null, // URL to tag on next finalized segments
  };

  const REFS = {};

  // ============================================================
  // BOOTSTRAP
  // ============================================================

  document.addEventListener('DOMContentLoaded', async () => {
    cacheRefs();

    // Init all modules with STATE and REFS
    window.BIAIFRenderer.init(STATE, REFS);
    window.BIAIFSpeech.init(STATE, REFS);
    window.BIAIFSession.init(STATE, REFS);
    window.BIAIFExport.init(STATE, REFS);

    bindEvents();
    bindRuntimeMessages();
    bindKeyboard();

    await window.BIAIFStorage.hydrate(STATE, () => {
      // Apply persisted settings to DOM
      if (REFS.langSelect && STATE.lang) REFS.langSelect.value = STATE.lang;
      // Sync button-visibility checkboxes with persisted state
      ['inject', 'vscode', 'copilot', 'copy', 'download',
       'claude_online', 'chatgpt', 'gemini', 'perplexity', 'grok', 'lechat', 'deepseek'
      ].forEach((key) => {
        const cb = document.getElementById('vis-' + key);
        if (!cb) return;
        // For new (online) keys default is false; for legacy keys default is true.
        const defaultsFalse = ['claude_online','chatgpt','gemini','perplexity','grok','lechat','deepseek'];
        const fallback = defaultsFalse.indexOf(key) >= 0 ? false : true;
        const v = STATE.visibleButtons[key];
        cb.checked = (v === undefined) ? fallback : !!v;
      });
      _updateSpFontVal();
      window.BIAIFRenderer.updateSortToggleLabel();
      window.BIAIFRenderer.applySegFontSize();
      window.BIAIFRenderer.renderDemandeEditor();
      window.BIAIFRenderer.renderSegments();
      window.BIAIFRenderer.updateArmedUi();
      const uiLang = STATE.uiLang || window.BIAIFi18n.detectBrowserLang();
      window.BIAIFi18n.setLang(uiLang);
      window.BIAIFToast.show(window.BIAIFi18n.t('toast.ready'), 'info', 1500);
      if (window.BIAIFWizard) window.BIAIFWizard.init(STATE, () => window.BIAIFStorage.persist(STATE));
    });

    checkActiveTabReady();
    refreshErrorsFromActiveTab();

    if (chrome?.tabs?.onActivated) {
      chrome.tabs.onActivated.addListener(() => {
        checkActiveTabReady();
        refreshErrorsFromActiveTab();
      });
    }
    if (chrome?.tabs?.onUpdated) {
      chrome.tabs.onUpdated.addListener((_id, info, tab) => {
        if (!tab || !tab.active) return;
        if (info.status === 'loading') {
          STATE.consoleErrors = [];
          window.BIAIFRenderer.updateErrorsBadges();
        } else if (info.status === 'complete') {
          checkActiveTabReady();
          refreshErrorsFromActiveTab();
        }
      });
    }

    // Progress bar listener (full-page capture)
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== _MSG('CAPTURE_PROGRESS')) return;
      updateCaptureProgress(msg.current, msg.total, msg.label);
    });
  });

  // ============================================================
  // DOM CACHE
  // ============================================================

  function cacheRefs() {
    REFS.masterBtn         = document.querySelector('[data-act="master"]');
    REFS.stopBtn           = document.querySelector('[data-act="stop"]');
    REFS.pickerBtn         = document.querySelector('[data-act="picker"]');
    REFS.micBtn            = document.querySelector('[data-act="mic"]');
    REFS.clearBtn          = document.querySelector('[data-act="clear"]');
    REFS.copyBtn           = document.querySelector('[data-act="copy"]');
    REFS.downloadBtn       = document.querySelector('[data-act="download"]');
    REFS.demandeEditor     = document.querySelector('.demande-editor');
    REFS.demandeRefsStrip  = document.querySelector('.demande-refs-strip');
    REFS.demandeRefsCount  = document.querySelector('.demande-refs-count');
    REFS.segments          = document.querySelector('.biaif-segments');
    REFS.segmentsCount     = document.querySelector('.segments-count');
    REFS.status            = document.querySelector('.biaif-status');
    REFS.timer             = document.querySelector('.biaif-timer');
    REFS.langSelect        = document.querySelector('select[name="lang"]');
    REFS.sortToggle        = document.querySelector('[data-act="sort-toggle"]');
    REFS.toggleSettings    = document.querySelector('[data-act="toggle-settings"]');
    REFS.openShortcuts     = document.querySelector('[data-act="open-shortcuts"]');
    REFS.settingsPopover   = document.getElementById('settings-panel');
    REFS.reloadModal       = document.getElementById('reload-modal');
    REFS.reloadModalBtn    = document.querySelector('[data-act="reload-tab-modal"]');
    REFS.reloadDismiss     = document.querySelector('[data-act="reload-dismiss"]');
    REFS.micDeviceSelect   = document.querySelector('select[name="mic-device"]');
    REFS.micTestBtn        = document.querySelector('[data-act="mic-test"]');
    REFS.micRefreshBtn     = document.querySelector('[data-act="mic-refresh"]');
    REFS.micMeter          = document.querySelector('.biaif-mic-meter');
    REFS.micMeterBar       = document.querySelector('.biaif-mic-meter-bar');
    REFS.shotButtons       = document.querySelectorAll('[data-shot]');
    REFS.searchInput       = document.getElementById('history-search');
    REFS.captureProgress   = document.getElementById('capture-progress');
    REFS.captureProgressBar= document.querySelector('.capture-progress-bar');
    REFS.captureProgressLbl= document.querySelector('.capture-progress-label');
  }

  // ============================================================
  // EVENT BINDING
  // ============================================================

  function bindEvents() {
    // Session master button
    if (REFS.masterBtn) REFS.masterBtn.addEventListener('click', () => {
      if (typeof STATE.editingDemandeIdx === 'number') window.BIAIFSession.exitEditMode();
      else if (STATE.armed) window.BIAIFSession.finalizeDemande(false);
      else window.BIAIFSession.startSession();
    });
    if (REFS.stopBtn) REFS.stopBtn.addEventListener('click', () => window.BIAIFSession.stopSession());

    // Tools
    if (REFS.pickerBtn) REFS.pickerBtn.addEventListener('click', async () => {
      const resp = await sendBg({ type: _MSG('PICKER_TOGGLE') });
      if (resp && resp.error) window.BIAIFToast.show(window.BIAIFi18n.t('toast.picker_fail', { err: decodeContentScriptError(resp.error) }), 'error');
    });
    if (REFS.micBtn) REFS.micBtn.addEventListener('click', () => window.BIAIFSpeech.toggleMic());

    // Footer actions
    if (REFS.clearBtn) REFS.clearBtn.addEventListener('click', () => clearAll());
    if (REFS.copyBtn)  REFS.copyBtn.addEventListener('click', () => window.BIAIFExport.copyPrompt());
    if (REFS.downloadBtn) REFS.downloadBtn.addEventListener('click', () => window.BIAIFExport.downloadBundle());

    // Language select
    if (REFS.langSelect) REFS.langSelect.addEventListener('change', (e) => {
      STATE.lang = e.target.value;
      const MIC = window.BIAIFSpeech.getMicState();
      if (MIC && MIC.rec) MIC.rec.lang = STATE.lang;
      window.BIAIFStorage.persist(STATE);
    });

    // Shot mode buttons
    REFS.shotButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        closeCaptureSubline();
        window.BIAIFSession.runShotMode(btn.dataset.shot);
      });
    });
    const captureToggle = document.querySelector('[data-act="capture-toggle"]');
    if (captureToggle) captureToggle.addEventListener('click', (e) => { e.stopPropagation(); toggleCaptureSubline(); });
    document.addEventListener('click', (e) => {
      const sub = document.querySelector('.quick-tools-subline');
      if (!sub || sub.hasAttribute('hidden')) return;
      if (e.target.closest('[data-act="capture-toggle"]') || e.target.closest('.quick-tools-subline')) return;
      closeCaptureSubline();
    });

    // File import
    const filesBtn  = document.querySelector('[data-act="open-files"]');
    const fileInput = document.getElementById('quick-file-input');
    if (filesBtn && fileInput) {
      filesBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length) await handleCaptureFiles(files);
        e.target.value = '';
      });
    }

    // Errors button
    const errBtn = document.querySelector('[data-act="open-errors"]');
    if (errBtn) errBtn.addEventListener('click', () => addAllConsoleErrors());

    // Sort toggle
    if (REFS.sortToggle) REFS.sortToggle.addEventListener('click', () => {
      STATE.sortOrder = STATE.sortOrder === 'desc' ? 'asc' : 'desc';
      window.BIAIFRenderer.updateSortToggleLabel();
      window.BIAIFRenderer.renderSegments();
      window.BIAIFStorage.persist(STATE);
    });
    window.BIAIFRenderer.updateSortToggleLabel();

    // Font size (multiple buttons possible: segments header + settings panel)
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act="seg-font-down"],[data-act="seg-font-up"]');
      if (!btn) return;
      window.BIAIFRenderer.bumpSegFontSize(btn.dataset.act === 'seg-font-up' ? +1 : -1);
      _updateSpFontVal();
    });
    window.BIAIFRenderer.applySegFontSize();

    // History search
    if (REFS.searchInput) REFS.searchInput.addEventListener('input', (e) => {
      STATE.searchQuery = e.target.value || '';
      window.BIAIFRenderer.renderSegments();
    });

    // Settings panel open/close
    if (REFS.toggleSettings) REFS.toggleSettings.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!REFS.settingsPopover) return;
      const opening = !REFS.settingsPopover.classList.contains('is-open');
      REFS.settingsPopover.classList.toggle('is-open', opening);
      REFS.toggleSettings.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening) _updateSpFontVal();
    });
    document.addEventListener('click', (e) => {
      if (!REFS.settingsPopover || !REFS.settingsPopover.classList.contains('is-open')) return;
      if (e.target.closest('#settings-panel') || e.target.closest('[data-act="toggle-settings"]')) return;
      REFS.settingsPopover.classList.remove('is-open');
      REFS.toggleSettings && REFS.toggleSettings.setAttribute('aria-expanded', 'false');
    });
    const closeSettingsBtn = document.querySelector('[data-act="close-settings"]');
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', () => {
      REFS.settingsPopover && REFS.settingsPopover.classList.remove('is-open');
      REFS.toggleSettings && REFS.toggleSettings.setAttribute('aria-expanded', 'false');
    });
    if (REFS.openShortcuts) REFS.openShortcuts.addEventListener('click', () => {
      try { chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); } catch (_) {}
    });

    // Reload modal
    if (REFS.reloadModalBtn) REFS.reloadModalBtn.addEventListener('click', async () => {
      const resp = await sendBg({ type: _MSG('RELOAD_ACTIVE_TAB') });
      if (resp && resp.ok) { hideReloadModal(); window.BIAIFToast.show(window.BIAIFi18n.t('toast.tab_reload_retry'), 'success'); }
      else window.BIAIFToast.show(window.BIAIFi18n.t('toast.tab_reload_fail', { err: (resp ? resp.error : 'no resp') }), 'error');
    });
    if (REFS.reloadDismiss) REFS.reloadDismiss.addEventListener('click', () => hideReloadModal());

    // "Revoir le guide" button
    const guideBtn = document.getElementById('btn-revoir-guide');
    if (guideBtn) guideBtn.addEventListener('click', () => {
      if (REFS.settingsPopover) REFS.settingsPopover.classList.remove('is-open');
      if (window.BIAIFWizard) window.BIAIFWizard.open(STATE, () => window.BIAIFStorage.persist(STATE));
    });

    // Button visibility toggles
    ['inject', 'vscode', 'copilot', 'copy', 'download',
     'claude_online', 'chatgpt', 'gemini', 'perplexity', 'grok', 'lechat', 'deepseek'
    ].forEach((key) => {
      const cb = document.getElementById('vis-' + key);
      if (!cb) return;
      cb.addEventListener('change', () => {
        STATE.visibleButtons[key] = cb.checked;
        window.BIAIFRenderer.renderSegments();
        window.BIAIFStorage.persist(STATE);
      });
    });

    // UI language buttons
    document.getElementById('sp-lang-grid') && document.getElementById('sp-lang-grid').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-lang]');
      if (!btn) return;
      const lang = btn.dataset.lang;
      STATE.uiLang = lang;
      window.BIAIFi18n.setLang(lang);
      // Re-render dynamic UI bits whose labels live in JS (segment buttons, master btn, etc.)
      window.BIAIFRenderer.renderSegments();
      window.BIAIFRenderer.renderDemandeRefsStrip();
      window.BIAIFRenderer.updateMasterBtnLabel();
      window.BIAIFRenderer.updateErrorsBadges();
      window.BIAIFStorage.persist(STATE);
    });

    // Mic settings
    if (REFS.micDeviceSelect) REFS.micDeviceSelect.addEventListener('change', (e) => {
      STATE.micDeviceId = e.target.value;
      window.BIAIFStorage.persist(STATE);
      if (window.BIAIFSpeech.getMicState().stream) window.BIAIFSpeech.startMicTest(STATE.micDeviceId);
    });
    if (REFS.micTestBtn) REFS.micTestBtn.addEventListener('click', () => {
      const MIC = window.BIAIFSpeech.getMicState();
      if (MIC && MIC.stream) window.BIAIFSpeech.stopMicTest();
      else window.BIAIFSpeech.startMicTest(STATE.micDeviceId);
    });
    if (REFS.micRefreshBtn) REFS.micRefreshBtn.addEventListener('click', () => window.BIAIFSpeech.refreshMicDevices(true));

    // Demande editor live sync
    let editTimer = null;
    document.addEventListener('input', (e) => {
      if (e.target !== REFS.demandeEditor) return;
      clearTimeout(editTimer);
      editTimer = setTimeout(() => {
        window.BIAIFSession.syncCurrentDemandeFromEditor();
        window.BIAIFRenderer.renderDemandeRefsStrip();
        window.BIAIFStorage.persist(STATE);
      }, 400);
    });

    // Delegate: ref chip "Modifier" button
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.ref-details-btn');
      if (!btn) return;
      e.stopPropagation(); e.preventDefault();
      const chip      = btn.closest('.ref-chip');
      if (!chip) return;
      const refIdx    = Number(chip.dataset.ref);
      const demKeyRaw = chip.dataset.demKey;
      const demKey    = demKeyRaw === 'current' || demKeyRaw === undefined ? 'current' : Number(demKeyRaw);
      window.BIAIFSession.editRef(demKey, refIdx, btn.dataset.editType);
    });

    // Status bar click (legacy clickable error messages)
    if (REFS.status) REFS.status.addEventListener('click', async () => {
      if (REFS.status.dataset.kind !== 'error') return;
      const action = REFS.status.dataset.action;
      if (action === 'reload-active-tab') {
        const resp = await sendBg({ type: _MSG('RELOAD_ACTIVE_TAB') });
        if (resp && resp.ok) window.BIAIFToast.show(window.BIAIFi18n.t('toast.tab_reloaded'), 'success');
      }
    });
  }

  // ============================================================
  // KEYBOARD
  // ============================================================

  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd+Z → Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        performUndo();
        return;
      }
      if (e.key === 'Escape') {
        const sub = document.querySelector('.quick-tools-subline');
        if (sub && !sub.hasAttribute('hidden')) { closeCaptureSubline(); return; }
        if (STATE.editingDemandeIdx !== null) { window.BIAIFSession.exitEditMode(); return; }
        if (REFS.settingsPopover && !REFS.settingsPopover.hasAttribute('hidden')) {
          REFS.settingsPopover.setAttribute('hidden', ''); return;
        }
      }
    });
  }

  // ============================================================
  // UNDO
  // ============================================================

  function performUndo() {
    if (!window.BIAIFUndo.canUndo()) {
      window.BIAIFToast.show(window.BIAIFi18n ? window.BIAIFi18n.t('toast.nothing_to_undo') : 'Rien à annuler.', 'info', 1500);
      return;
    }
    const snapshot = window.BIAIFUndo.pop();
    if (!snapshot) return;
    STATE.demandes       = snapshot.demandes;
    STATE.currentDemande = snapshot.currentDemande;
    window.BIAIFRenderer.renderDemandeEditor();
    window.BIAIFRenderer.renderSegments();
    window.BIAIFRenderer.updateArmedUi();
    // Persist without pushing a new undo entry (storage.persist pushes)
    // We skip undo push here by calling chrome.storage directly
    chrome.storage.local.set({
      [window.BIAIF.STORAGE_KEY]: {
        demandes: STATE.demandes, currentDemande: STATE.currentDemande,
        lang: STATE.lang, micDeviceId: STATE.micDeviceId,
        sortOrder: STATE.sortOrder, segFontSize: STATE.segFontSize,
        visibleButtons: STATE.visibleButtons,
      }
    }).catch(() => {});
    window.BIAIFToast.show(window.BIAIFi18n ? window.BIAIFi18n.t('toast.undone') : 'Action annulée.', 'success', 2000);
  }

  // ============================================================
  // RUNTIME MESSAGES
  // ============================================================

  function bindRuntimeMessages() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === _MSG('ELEMENT_PICKED'))    { onElementPicked(msg); return; }
      if (msg.type === _MSG('PICKER_STATE'))       { onPickerState(!!msg.active); return; }
      if (msg.type === _MSG('CONSOLE_ERROR'))      { onConsoleError(msg.error); return; }
      if (msg.type === _MSG('CONTEXT_STATUS'))     { window.BIAIFToast.show(msg.msg, 'info'); return; }
      if (msg.type === _MSG('CONTEXT_SHOT'))       { window.BIAIFSession.runShotMode(msg.mode); return; }
      if (msg.type === _MSG('CONTEXT_ADD_TEXT'))   { addTextFromContext(msg.text, msg.pageUrl); return; }
      if (msg.type === _MSG('CONTEXT_ADD_IMAGE'))  { addImageFromContext(msg.srcUrl, msg.pageUrl); return; }
      if (msg.type === _MSG('HOTKEY')) {
        if (msg.action === 'toggle-mic')  window.BIAIFSpeech.toggleMic();
        if (msg.action === 'copy-prompt') window.BIAIFExport.copyPrompt();
        return;
      }
      if (msg.type === _MSG('OPEN_WITH_FILTER')) {
        onOpenWithFilter(msg.conversationUrl || msg.filterUrl);
        return;
      }
      if (msg.type === _MSG('START_LINKED_SEGMENT')) {
        onStartLinkedSegment(msg.conversationUrl);
        return;
      }
    });
  }

  function onOpenWithFilter(conversationUrl) {
    STATE.conversationFilter = conversationUrl || '';
    window.BIAIFRenderer.renderSegments();
    if (conversationUrl) {
      let label = conversationUrl;
      try { label = new URL(conversationUrl).hostname + new URL(conversationUrl).pathname; } catch (_) {}
      window.BIAIFToast.show(
        window.BIAIFi18n
          ? window.BIAIFi18n.t('toast.filter_applied', { host: label })
          : 'Filtre : ' + label,
        'info', 2500
      );
    }
  }

  async function onStartLinkedSegment(conversationUrl) {
    STATE.conversationFilter    = conversationUrl || '';
    STATE.pendingConversationUrl = conversationUrl || null;
    window.BIAIFRenderer.renderSegments();
    if (!STATE.armed) await window.BIAIFSession.startSession();
    if (conversationUrl) {
      let label = conversationUrl;
      try { label = new URL(conversationUrl).hostname + new URL(conversationUrl).pathname; } catch (_) {}
      window.BIAIFToast.show(
        window.BIAIFi18n
          ? window.BIAIFi18n.t('toast.linked_session_started', { conv: label })
          : 'Session liée à ' + label,
        'success', 3000
      );
    }
  }

  // ============================================================
  // PICKER / ELEMENT PICKED
  // ============================================================

  function onPickerState(active) {
    STATE.pickerActive = active;
    if (!REFS.pickerBtn) return;
    REFS.pickerBtn.classList.toggle('active', active);
    REFS.pickerBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    const lbl = REFS.pickerBtn.querySelector('.label');
    if (lbl) lbl.textContent = active ? window.BIAIFi18n.t('tools.picker_active') : window.BIAIFi18n.t('tools.picker');
  }

  function onElementPicked(msg) {
    const descriptor = msg.descriptor || { selector: '?', tag: null, id: null, classes: [], text: null };
    const ref = {
      type:       'element',
      selector:   descriptor.selector || '?',
      tag:        descriptor.tag   || null,
      id:         descriptor.id    || null,
      classes:    descriptor.classes || [],
      text:       descriptor.text  || null,
      outerHTML:  descriptor.outerHTML || null,
      screenshot: msg.screenshot   || null,
      metadata:   msg.metadata     || null,
      ts:         Date.now(),
    };

    if (STATE.replacingRef) {
      const { demKey, refIndex } = STATE.replacingRef;
      STATE.replacingRef = null;
      const target = demKey === 'current' ? STATE.currentDemande : STATE.demandes[demKey];
      if (target && target.refs && target.refs[refIndex]) {
        target.refs[refIndex] = ref;
        if (demKey === 'current') window.BIAIFRenderer.renderDemandeEditor();
        else window.BIAIFRenderer.renderSegments();
        window.BIAIFStorage.persist(STATE);
        window.BIAIFToast.show(window.BIAIFi18n.t('toast.ref_updated', { n: refIndex + 1, label: shortLabel(descriptor) }), 'success');
      }
      if (!STATE.armed) sendBg({ type: _MSG('PICKER_DISABLE') });
      return;
    }

    const tIdx = window.BIAIFSession.activeTargetIdx();
    window.BIAIFSession.addRefToTarget(ref);
    window.BIAIFToast.show(
      typeof tIdx === 'number'
        ? window.BIAIFi18n.t('toast.element_added', { n: tIdx + 1, label: shortLabel(descriptor) })
        : window.BIAIFi18n.t('toast.ref_added', { label: shortLabel(descriptor) }),
      'success'
    );
    STATE.modalTarget = 'current';
  }

  // ============================================================
  // CONSOLE ERRORS
  // ============================================================

  function onConsoleError(err) {
    if (!err || !err.key) return;
    if (STATE.consoleErrors.find((e) => e.key === err.key)) return;
    STATE.consoleErrors.push(err);
    window.BIAIFRenderer.updateErrorsBadges();
  }

  async function refreshErrorsFromActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;
      let resp = null;
      try { resp = await chrome.tabs.sendMessage(tab.id, { type: _MSG('GET_ERRORS') }); } catch (_) {}
      STATE.consoleErrors = [];
      if (resp && Array.isArray(resp.errors)) resp.errors.forEach(onConsoleError);
      else window.BIAIFRenderer.updateErrorsBadges();
    } catch (_) {}
  }

  function addAllConsoleErrors() {
    if (!STATE.consoleErrors.length) { window.BIAIFToast.show(window.BIAIFi18n.t('toast.no_errors'), 'info'); return; }
    const count = STATE.consoleErrors.length;
    for (const err of STATE.consoleErrors) {
      window.BIAIFSession.addRefToTarget({
        type: 'error', msg: err.msg || '', file: err.file || null,
        line: err.line || null, col: err.col || null, stack: err.stack || null,
        url: err.url || null, ts: err.ts || Date.now(),
      });
    }
    STATE.consoleErrors = [];
    window.BIAIFRenderer.updateErrorsBadges();
    window.BIAIFToast.show(window.BIAIFi18n.t(count > 1 ? 'toast.errors_added_plural' : 'toast.errors_added_singular', { n: count }), 'success');
  }

  // ============================================================
  // TAB READY CHECK
  // ============================================================

  async function checkActiveTabReady() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;
      if (!/^https?:|^file:/.test(tab.url || '')) { hideReloadModal(); return; }
      let resp = null;
      try { resp = await chrome.tabs.sendMessage(tab.id, { type: _MSG('COMMAND'), action: 'ping' }); } catch (e) { resp = { error: String(e) }; }
      if (!resp || resp.error) showReloadModal();
      else hideReloadModal();
    } catch (_) {}
  }

  function showReloadModal() { if (REFS.reloadModal) REFS.reloadModal.removeAttribute('hidden'); }
  function hideReloadModal() { if (REFS.reloadModal) REFS.reloadModal.setAttribute('hidden', ''); }

  // ============================================================
  // CAPTURE PROGRESS BAR
  // ============================================================

  function updateCaptureProgress(current, total, label) {
    if (!REFS.captureProgress) return;
    if (!total || current >= total) {
      REFS.captureProgress.setAttribute('hidden', '');
      return;
    }
    REFS.captureProgress.removeAttribute('hidden');
    const pct = Math.round((current / total) * 100);
    if (REFS.captureProgressBar) REFS.captureProgressBar.style.width = pct + '%';
    if (REFS.captureProgressLbl) REFS.captureProgressLbl.textContent = label || ('Section ' + current + '/' + total);
  }

  // ============================================================
  // CAPTURE SUBLINE
  // ============================================================

  function openCaptureSubline() {
    const sub = document.querySelector('.quick-tools-subline');
    const btn = document.querySelector('[data-act="capture-toggle"]');
    if (sub) sub.removeAttribute('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }
  function closeCaptureSubline() {
    const sub = document.querySelector('.quick-tools-subline');
    const btn = document.querySelector('[data-act="capture-toggle"]');
    if (sub) sub.setAttribute('hidden', '');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
  function toggleCaptureSubline() {
    const sub = document.querySelector('.quick-tools-subline');
    if (!sub) return;
    sub.hasAttribute('hidden') ? openCaptureSubline() : closeCaptureSubline();
  }

  // ============================================================
  // FILE IMPORT
  // ============================================================

  async function handleCaptureFiles(files) {
    if (!files || !files.length) return;
    let count = 0;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const dataUrl = await readFileAsDataUrl(file);
        window.BIAIFSession.addRefToTarget({ type: 'screenshot', mode: 'fichier', dataUrl, fileName: file.name, ts: Date.now() });
        count++;
      } catch (e) { console.warn('[BIAIF] file read failed', e && e.message); }
    }
    if (count) window.BIAIFToast.show(window.BIAIFi18n.t(count > 1 ? 'toast.images_added_plural' : 'toast.images_added_singular', { n: count }), 'success');
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  // ============================================================
  // CONTEXT MENU HANDLERS
  // ============================================================

  function addTextFromContext(text, pageUrl) {
    if (!text) return;
    window.BIAIFSession.addTextToTarget('« ' + text + ' »');
    if (pageUrl) STATE.currentDemande.pageUrl = pageUrl;
    window.BIAIFToast.show(window.BIAIFi18n.t('toast.text_selection_added'), 'success');
  }

  async function addImageFromContext(srcUrl, pageUrl) {
    if (!srcUrl) return;
    window.BIAIFToast.show(window.BIAIFi18n.t('toast.image_downloading'), 'info', 2000);
    let dataUrl = null;
    try {
      const resp = await fetch(srcUrl);
      const blob = await resp.blob();
      dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    } catch (_) {}
    window.BIAIFSession.addRefToTarget({ type: 'screenshot', mode: dataUrl ? 'image' : 'image-url', dataUrl, srcUrl, url: pageUrl || null, ts: Date.now() });
    if (pageUrl) STATE.currentDemande.pageUrl = pageUrl;
    window.BIAIFToast.show(window.BIAIFi18n.t(dataUrl ? 'toast.image_added' : 'toast.image_added_url'), 'success');
  }

  // ============================================================
  // CLEAR ALL
  // ============================================================

  function clearAll() {
    if (!confirm(window.BIAIFi18n.t('confirm.clear_all'))) return;
    if (STATE.editingDemandeIdx !== null) window.BIAIFSession.exitEditMode({ silent: true });
    STATE.demandes       = [];
    STATE.currentDemande = { text: '', refs: [], pageUrl: null };
    STATE.currentInterim = '';
    STATE.lastShot       = null;
    STATE.lastShotMode   = null;
    if (REFS.demandeEditor) REFS.demandeEditor.innerHTML = '';
    window.BIAIFSpeech.clearInterimGhost();
    window.BIAIFUndo.clear();
    window.BIAIFRenderer.renderDemandeRefsStrip();
    window.BIAIFRenderer.renderSegments();
    window.BIAIFRenderer.updateArmedUi();
    window.BIAIFStorage.persist(STATE);
    window.BIAIFToast.show(window.BIAIFi18n ? window.BIAIFi18n.t('toast.cleared') : 'Tout effacé.', 'info');
  }

  // ============================================================
  // HELPERS
  // ============================================================

  function _updateSpFontVal() {
    const el = document.getElementById('sp-font-val');
    if (el) el.textContent = (STATE.segFontSize || 13) + 'px';
  }

  function shortLabel(descriptor) {
    if (!descriptor) return '?';
    const tag = (descriptor.tag || 'el').toLowerCase();
    if (descriptor.id) return '#' + descriptor.id;
    let label = '<' + tag + '>';
    if (Array.isArray(descriptor.classes) && descriptor.classes.length) {
      const candidates = descriptor.classes.filter((c) => c && c.length <= 22 && (c.match(/[A-Z]/g) || []).length < 3);
      if (candidates.length) label = tag + '.' + candidates[0];
    }
    if (descriptor.text) {
      const snip = String(descriptor.text).replace(/\s+/g, ' ').trim();
      if (snip) label += ' « ' + (snip.length > 40 ? snip.slice(0, 40) + '…' : snip) + ' »';
    }
    return label;
  }

  function decodeContentScriptError(err) {
    const s = typeof err === 'string' ? err : (err && err.message || String(err));
    if (s.includes('Receiving end does not exist') || s.includes('Could not establish connection'))
      return "content script pas prêt — rechargez l'onglet";
    return s;
  }

  function sendBg(payload) { return chrome.runtime.sendMessage(payload).catch(() => null); }

  function _MSG(key) { return window.BIAIF && window.BIAIF.MSG ? window.BIAIF.MSG[key] : key; }

})();
