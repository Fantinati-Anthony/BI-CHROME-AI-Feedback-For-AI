/**
 * MyFb Side Panel — bootstrap
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

  // ─── STATE ────────────────────────────────────────────────────────
  // Conceptually three concerns are mixed in one flat object for
  // backwards compatibility with the existing 100+ callsites. The
  // grouping is purely visual but is also exposed as live read-through
  // namespaces (STATE.session / STATE.data / STATE.settings) — see
  // _installNamespaces() below.
  // ──────────────────────────────────────────────────────────────────
  const STATE = {
    // 1) SESSION — ephemeral runtime flags (not persisted)
    armed:                  false,
    pickerActive:           false,
    micActive:              false,
    currentInterim:         '',
    replacingRef:           null,
    dictationTarget:        'current',
    modalTarget:            'current',
    consoleErrors:          [],
    editingDemandeIdx:      null,
    searchQuery:            '',
    pendingConversationUrl: null,
    pendingRepoId:          null,
    lastShot:               null,
    lastShotMode:           null,
    conversationFilter:     '',
    repoFilter:             '',
    domainFilter:           '',
    tagFilter:              '',
    pageFilter:             '',

    // 2) DATA — user-generated content (persisted)
    currentDemande:         { text: '', refs: [], pageUrl: null },
    demandes:               [],
    templates:              [],

    // 3) SETTINGS — user preferences (persisted)
    lang:                   'fr-FR',
    uiLang:                 '',
    micDeviceId:            '',
    sortOrder:              'desc',
    segFontSize:            13,
    segTextLines:           5,
    saveStaysArmed:         true,
    shortcutMode:           'smart', // 'hold' | 'toggle' | 'smart'
    autoOpenOnKnownActive:  false,
    autoOpenOnKnownDone:    false,
    autoOpenOnAiPage:       false,
    hideAiTextarea:         false,
    autoSubmitAfterInject:  false,
    archiveExpanded:        false,
    showConsoleBtn:         false,
    topbarPosition:         'top',
    theme:                  'dark',
    privacyScrub:           true,
    syncEnabled:            false,
    // Defaults derived from MyFb.ALL_BUTTONS (single source of truth).
    visibleButtons: ((window.MyFb && window.MyFb.ALL_BUTTONS) || []).reduce(function (acc, def) {
      acc[def.key] = !!def.defaultVisible; return acc;
    }, {}),
  };

  // Live grouped views — define which flat keys belong to each namespace,
  // then expose getters/setters that proxy through to the flat STATE so
  // callers can choose their style without breaking the existing API.
  const _GROUPS = {
    session: ['armed','pickerActive','micActive','currentInterim','replacingRef',
              'dictationTarget','modalTarget','consoleErrors','editingDemandeIdx',
              'searchQuery','pendingConversationUrl','pendingRepoId','lastShot',
              'lastShotMode','conversationFilter','repoFilter','domainFilter','pageFilter','tagFilter'],
    data:    ['currentDemande','demandes','templates'],
    settings:['lang','uiLang','micDeviceId','sortOrder','segFontSize','segTextLines','saveStaysArmed','shortcutMode',
              'autoOpenOnKnownActive','autoOpenOnKnownDone','autoOpenOnAiPage',
              'hideAiTextarea','autoSubmitAfterInject','archiveExpanded',
              'showConsoleBtn','topbarPosition','theme','privacyScrub','syncEnabled','visibleButtons'],
  };
  Object.keys(_GROUPS).forEach(function (group) {
    var view = {};
    _GROUPS[group].forEach(function (key) {
      Object.defineProperty(view, key, {
        enumerable: true,
        get: function () { return STATE[key]; },
        set: function (v) { STATE[key] = v; },
      });
    });
    Object.defineProperty(STATE, group, { value: Object.freeze(view), enumerable: false });
  });

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
    REFS.segments          = document.querySelector('.myfb-segments');
    REFS.segmentsCount     = document.querySelector('.segments-count');
    REFS.status            = document.querySelector('.myfb-status');
    REFS.timer             = document.querySelector('.myfb-timer');
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
    REFS.micMeter          = document.querySelector('.myfb-mic-meter');
    REFS.micMeterBar       = document.querySelector('.myfb-mic-meter-bar');
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
    window.MyFbBindings.ctx.init(STATE, REFS);

    // Init every domain module that exposes init(state, refs).
    window.MyFbRenderer.init(STATE, REFS);
    if (window.MyFbPerf) { window.MyFbPerf.mark('boot'); window.MyFbPerf.observeWebVitals(); }
    window.MyFbSpeech.init(STATE, REFS);
    window.MyFbSession.init(STATE, REFS);
    if (window.MyFbTemplates) window.MyFbTemplates.init(STATE);
    if (window.MyFbPalette) window.MyFbPalette.init();
    window.MyFbExport.init(STATE, REFS);

    // Wire UI events, runtime messages, keyboard, and tab lifecycle.
    window.MyFbBindings.bindAll();

    // Hydrate from chrome.storage, then apply persisted state to the DOM.
    await window.MyFbStorage.hydrate(STATE, () => {
      window.MyFbBindings.hydrate.applyToDOM();
    });

    // Initial tab-state probe (independent of hydration).
    window.MyFbBindings.tabs.checkActiveTabReady();
    window.MyFbBindings.helpers.refreshErrorsFromActiveTab();

    // v1.0.0 runtime: event-sourcing core + first-launch onboarding.
    // Fire-and-forget — degrades gracefully on failure (legacy code path
    // keeps working).
    if (window.MyFb && window.MyFb.runtimeBoot) {
      window.MyFb.runtimeBoot.boot();
    }

    // v1.3: page overlay controller (toggle in topbar-extras).
    if (window.MyFbOverlayController) {
      window.MyFbOverlayController.init();
    }

    // v1.8: AI UI — Settings → IA section + per-card ✨ button.
    if (window.MyFbAiUi) {
      window.MyFbAiUi.initSettingsPanel();
      window.MyFbAiUi.initCardDecorator();
    }

    // v1.9: Settings UI — Cet appareil / Sync / Liaisons sections.
    if (window.MyFbSettingsUi) {
      window.MyFbSettingsUi.init();
    }

    // v1.11: Per-card "Send to…" multi-target picker.
    if (window.MyFbExportPicker) {
      window.MyFbExportPicker.init();
    }

    // v1.12: Per-card triage UI (status / priority / tags / comments).
    if (window.MyFbTriageUi) {
      window.MyFbTriageUi.init();
    }

    // v1.13: Filter bar above the segments list.
    if (window.MyFbTriageFilter) {
      window.MyFbTriageFilter.init();
    }

    // v1.14: GDPR data controls (export / reset / delete) wiring.
    if (window.MyFbDataControls) {
      window.MyFbDataControls.init();
    }

    // v1.16: Pairing UI inside Settings → Liaisons.
    if (window.MyFbPairingUi) {
      window.MyFbPairingUi.init();
    }

    // v2.0: Legacy ↔ event store bridges. Forward bridge wraps
    // MyFbStorage.persist; reverse bridge subscribes to the active
    // transport. Both swallow errors so the legacy code path keeps
    // working even if the runtime never boots.
    if (window.MyFbLegacyEventBridge) {
      window.MyFbLegacyEventBridge.attach();
    }
    if (window.MyFb && window.MyFb.runtimeBoot && window.MyFb.runtimeBoot.boot) {
      window.MyFb.runtimeBoot.boot().then(function () {
        if (window.MyFbStateSync && window.MyFbStateSync.attach) {
          window.MyFbStateSync.attach();
        }
      }).catch(function () {});
    }

    // v2.0: Privacy controls (telemetry + E2E + reload) UI.
    if (window.MyFbPrivacyControls) {
      window.MyFbPrivacyControls.init();
    }

    // v2.3: Rich segment conversation (mentions / target / propose-edit).
    if (window.MyFbSegmentConversation) {
      window.MyFbSegmentConversation.init();
    }
  });
})();
