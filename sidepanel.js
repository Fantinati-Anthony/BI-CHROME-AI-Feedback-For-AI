/**
 * BIAIF Side Panel — bootstrap
 *
 * Owns three things only:
 *   1. The STATE shape and its initial defaults.
 *   2. The REFS cache (DOM lookups done once on load).
 *   3. The DOMContentLoaded sequence that wires every other module.
 *
 * Everything else — event listeners, runtime messages, keyboard, tab
 * lifecycle, post-hydration DOM sync — lives in `sidepanel/bindings/*`.
 * Renderer internals live in `sidepanel/render/*`. Storage / session /
 * speech / export / wizard / undo / toast each live in their own
 * `sidepanel/<module>.js`.
 *
 * Load order (see sidepanel.html):
 *   shared/{constants,config,i18n,utils,logger,dom}
 *   sidepanel/{wizard,toast,undo,storage,export,speech}
 *   sidepanel/render/*  → sidepanel/renderer.js
 *   sidepanel/session.js
 *   sidepanel/bindings/*
 *   shared/intent-parser
 *   sidepanel.js  ← this file
 */
(function () {
  'use strict';

  // ============================================================
  // STATE
  // ============================================================

  const STATE = {
    armed:                  false,
    pickerActive:           false,
    micActive:              false,
    currentInterim:         '',
    currentDemande:         { text: '', refs: [], pageUrl: null },
    demandes:               [],
    lastShot:               null,
    lastShotMode:           null,
    sortOrder:              'desc',
    segFontSize:            13,
    lang:                   'fr-FR',
    micDeviceId:            '',
    replacingRef:           null,
    dictationTarget:        'current',
    modalTarget:            'current',
    consoleErrors:          [],
    editingDemandeIdx:      null,
    searchQuery:            '',
    visibleButtons: {
      inject: true, vscode: true, copilot: true, copy: true, download: true,
      claude_online: false, chatgpt: false, gemini: false, perplexity: false,
      grok: false, lechat: false, deepseek: false,
    },
    uiLang:                 '',
    conversationFilter:     '',     // exact AI conversation URL filter
    repoFilter:             '',     // "owner/repo" filter
    domainFilter:           '',     // hostname filter (e.g. "localhost:3000")
    pageFilter:             '',     // exact tabUrl filter
    pendingConversationUrl: null,
    pendingRepoId:          null,
    autoOpenOnKnownActive:  false,
    autoOpenOnKnownDone:    false,
    autoOpenOnAiPage:       false,
    hideAiTextarea:         false,
    autoSubmitAfterInject:  false,
    archiveExpanded:        false,
  };

  const REFS = {};

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
  // BOOTSTRAP
  // ============================================================

  document.addEventListener('DOMContentLoaded', async () => {
    cacheRefs();

    // Wire the shared context for both renderer and bindings.
    window.BIAIFBindings.ctx.init(STATE, REFS);

    // Init every domain module that exposes init(state, refs).
    window.BIAIFRenderer.init(STATE, REFS);
    window.BIAIFSpeech.init(STATE, REFS);
    window.BIAIFSession.init(STATE, REFS);
    window.BIAIFExport.init(STATE, REFS);

    // Wire UI events, runtime messages, keyboard, and tab lifecycle.
    window.BIAIFBindings.bindAll();

    // Hydrate from chrome.storage, then apply persisted state to the DOM.
    await window.BIAIFStorage.hydrate(STATE, () => {
      window.BIAIFBindings.hydrate.applyToDOM();
    });

    // Initial tab-state probe (independent of hydration).
    window.BIAIFBindings.tabs.checkActiveTabReady();
    window.BIAIFBindings.helpers.refreshErrorsFromActiveTab();
  });
})();
