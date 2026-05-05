/**
 * BIAIF Side Panel — v0.3 (mono-instance)
 *
 * Architecture v0.3 :
 *   - La side panel hôte tout : UI + SpeechRecognition + state.
 *   - Plus d'offscreen document (le mic prompt n'avait pas de surface UI).
 *   - Le content script de l'onglet actif fournit picker + screenshot via
 *     chrome.tabs.sendMessage (réponse asynchrone).
 *   - Persistance des segments dans chrome.storage.local.
 *
 * Une instance par fenêtre Chrome (le side panel est par-fenêtre). Plus
 * de conflit cross-tab parce qu'il n'y a plus de content-script-mic.
 */

(function () {
  'use strict';

  // ============================================================
  // STATE
  // ============================================================

  const STATE = {
    armed: false,
    pickerActive: false,
    micActive: false,
    currentInterim: '',
    // Mad-Libs : la demande en cours est un texte avec tokens {{ref:N}} pointant
    // sur des entrées de refs[]. Les refs peuvent être des éléments (sélecteur)
    // ou des captures (dataUrl).
    currentDemande: { text: '', refs: [], pageUrl: null },
    demandes: [],
    lastShot: null,
    lastShotMode: null,
    sortOrder: 'desc',
    segFontSize: 13,        // taille de texte des segments (px), 10..20
    lang: 'fr-FR',
    micDeviceId: '',
    // Mode "remplacement" : si non-null, le prochain pick d'élément
    // remplace la ref ciblée au lieu d'en créer une nouvelle.
    // { demKey: 'current' | <number>, refIndex: <number> }
    replacingRef: null,
    // Cible de la dictée vocale : 'current' (éditeur) ou index d'une demande
    // historique. Par défaut 'current'.
    dictationTarget: 'current',
    // Erreurs JS captées sur la page active (dédoublonnées par key).
    consoleErrors: [],
    // Cible de la modale "Ajouter" : 'current' (demande en cours) ou
    // index numérique d'une demande historique.
    modalTarget: 'current',
    // Mode "édition" d'une demande finalisée : si non-null, la barre
    // d'outils (.biaif-quick-tools) est physiquement déplacée dans le
    // segment ; voix / pick / capture vont vers ce segment.
    editingDemandeIdx: null,
  };

  // État du drag-and-drop manuel des chips.
  const DRAG = { chip: null, sourceContainer: null };
  // État du drag-and-drop manuel pour fusion de demandes.
  const SEG_DRAG = { sourceIdx: -1 };

  // Mic test (live audio level meter, separate from SpeechRecognition stream)
  let micTest = null;

  const REFS = {};
  const STORAGE_KEY = 'biaif:v03:state';

  let statusTimer = null;
  let timerInterval = null;
  let timerStart = 0;

  // Mic (SpeechRecognition lives in this context now)
  const MIC = {
    rec: null,
    finalTranscript: '',
    lastEventAt: 0,
  };

  // ============================================================
  // BOOTSTRAP
  // ============================================================

  document.addEventListener('DOMContentLoaded', async () => {
    cacheRefs();
    bindEvents();
    bindRuntimeMessages();
    await hydrateFromStorage();
    setStatus('Prêt.', 'info');
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
          // Nouvelle navigation sur l'onglet actif : on vide la liste,
          // la nouvelle page renverra ses erreurs au fur et à mesure.
          STATE.consoleErrors = [];
          updateErrorsBadges();
          renderConsoleErrorsList();
        } else if (info.status === 'complete') {
          checkActiveTabReady();
          refreshErrorsFromActiveTab();
        }
      });
    }
  });

  // Demande au content script bridge de l'onglet actif l'ensemble de ses
  // erreurs et reconstruit la liste côté side panel. Utile au démarrage
  // et à chaque changement d'onglet.
  async function refreshErrorsFromActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;
      let resp = null;
      try {
        resp = await chrome.tabs.sendMessage(tab.id, { type: 'biaif:get-errors' });
      } catch (_) { /* content script absent (chrome://, page neuve...) */ }
      // On reconstruit la liste depuis zéro avec ce que renvoie le bridge.
      STATE.consoleErrors = [];
      if (resp && Array.isArray(resp.errors)) {
        for (const err of resp.errors) onConsoleError(err);
      } else {
        updateErrorsBadges();
        renderConsoleErrorsList();
      }
    } catch (_) { /* ignore */ }
  }

  async function checkActiveTabReady() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;
      const url = tab.url || '';
      if (!/^https?:|^file:/.test(url)) { hideReloadModal(); return; }
      let resp = null;
      try {
        resp = await chrome.tabs.sendMessage(tab.id, { type: 'biaif:command', action: 'ping' });
      } catch (e) {
        resp = { error: e?.message || String(e) };
      }
      if (!resp || resp.error) showReloadModal();
      else hideReloadModal();
    } catch (_) { /* ignore */ }
  }

  function showReloadModal() {
    if (REFS.reloadModal) REFS.reloadModal.removeAttribute('hidden');
  }
  function hideReloadModal() {
    if (REFS.reloadModal) REFS.reloadModal.setAttribute('hidden', '');
  }
  function updateSortToggleLabel() {
    if (!REFS.sortToggle) return;
    const lbl = REFS.sortToggle.querySelector('.sort-label');
    if (lbl) lbl.textContent = STATE.sortOrder === 'desc' ? 'Z→A' : 'A→Z';
  }

  // Taille du texte des segments (CSS variable --seg-text-size scopée
  // sur .biaif-segments-wrap). Bornes 10..20 px.
  function bumpSegFontSize(delta) {
    const next = Math.max(8, Math.min(16, (STATE.segFontSize || 13) + delta));
    if (next === STATE.segFontSize) return;
    STATE.segFontSize = next;
    applySegFontSize();
    persist();
  }
  function applySegFontSize() {
    const wrap = document.querySelector('.biaif-segments-wrap');
    if (wrap) wrap.style.setProperty('--seg-text-size', (STATE.segFontSize || 13) + 'px');
    const fontDown = document.querySelector('[data-act="seg-font-down"]');
    const fontUp = document.querySelector('[data-act="seg-font-up"]');
    if (fontDown) fontDown.disabled = STATE.segFontSize <= 8;
    if (fontUp)   fontUp.disabled   = STATE.segFontSize >= 16;
  }

  function cacheRefs() {
    REFS.masterBtn   = document.querySelector('[data-act="master"]');
    REFS.stopBtn     = document.querySelector('[data-act="stop"]');
    REFS.pickerBtn   = document.querySelector('[data-act="picker"]');
    REFS.micBtn      = document.querySelector('[data-act="mic"]');
    REFS.clearBtn    = document.querySelector('[data-act="clear"]');
    REFS.copyBtn     = document.querySelector('[data-act="copy"]');
    REFS.downloadBtn = document.querySelector('[data-act="download"]');
    REFS.textarea    = null; // textarea remplacée par .demande-editor
    REFS.demandeEditor = document.querySelector('.demande-editor');
    REFS.demandeRefsStrip = document.querySelector('.demande-refs-strip');
    REFS.demandeRefsCount = document.querySelector('.demande-refs-count');
    REFS.interim     = document.querySelector('.biaif-interim');
    REFS.segments    = document.querySelector('.biaif-segments');
    REFS.segmentsCount = document.querySelector('.segments-count');
    REFS.empty       = document.querySelector('.biaif-empty');
    REFS.status      = document.querySelector('.biaif-status');
    REFS.timer       = document.querySelector('.biaif-timer');
    REFS.langSelect  = document.querySelector('select[name="lang"]');
    REFS.sessionInfo = document.querySelector('.biaif-session-info');
    REFS.bufferPreview = document.querySelector('.biaif-buffer-preview');
    REFS.nextBtn       = document.querySelector('[data-act="next"]');
    // Shot tools (auto-attach : pas de preview, pas de pills)
    REFS.shotButtons = document.querySelectorAll('[data-shot]');
    REFS.shotPreview = null;
    REFS.shotInfo    = null;
    REFS.shotCopy    = null;
    REFS.shotSave    = null;
    REFS.shotAttach  = null;
    REFS.shotAnnotate= null;
    // Sort toggle
    REFS.sortToggle  = document.querySelector('[data-act="sort-toggle"]');
    // Mini footer + modals
    REFS.toggleSettings = document.querySelector('[data-act="toggle-settings"]');
    REFS.openShortcuts  = document.querySelector('[data-act="open-shortcuts"]');
    REFS.settingsPopover= document.getElementById('settings-popover');
    REFS.reloadModal    = document.getElementById('reload-modal');
    REFS.reloadModalBtn = document.querySelector('[data-act="reload-tab-modal"]');
    REFS.reloadDismiss  = document.querySelector('[data-act="reload-dismiss"]');
    // Mic settings
    REFS.micDeviceSelect = document.querySelector('select[name="mic-device"]');
    REFS.micTestBtn      = document.querySelector('[data-act="mic-test"]');
    REFS.micRefreshBtn   = document.querySelector('[data-act="mic-refresh"]');
    REFS.micPermLink     = document.querySelector('[data-act="open-mic-perm"]');
    REFS.micMeter        = document.querySelector('.biaif-mic-meter');
    REFS.micMeterBar     = document.querySelector('.biaif-mic-meter-bar');
    REFS.micMeterLabel   = document.querySelector('.biaif-mic-meter-label');
  }

  function bindEvents() {
    if (REFS.masterBtn) REFS.masterBtn.addEventListener('click', () => {
      if (STATE.armed) nextVoiceSegment();
      else startSession();
    });
    if (REFS.stopBtn) REFS.stopBtn.addEventListener('click', () => stopSession());
    if (REFS.pickerBtn) REFS.pickerBtn.addEventListener('click',   async () => {
      const resp = await sendBg({ type: 'biaif:picker-toggle' });
      if (resp && resp.error) setStatusError('Picker KO : ' + decodeContentScriptError(resp.error), isReloadableError(resp.error) ? 'reload-active-tab' : null);
    });
    if (REFS.micBtn) REFS.micBtn.addEventListener('click',      () => toggleMic());
    if (REFS.nextBtn) REFS.nextBtn.addEventListener('click', () => nextVoiceSegment());
    if (REFS.clearBtn) REFS.clearBtn.addEventListener('click',    () => clearAll());
    if (REFS.copyBtn) REFS.copyBtn.addEventListener('click',     () => copyPrompt());
    if (REFS.downloadBtn) REFS.downloadBtn.addEventListener('click', () => downloadBundle());
    if (REFS.langSelect) REFS.langSelect.addEventListener('change', (e) => {
      STATE.lang = e.target.value;
      if (MIC.rec) MIC.rec.lang = STATE.lang;
      persist();
    });

    // Shot tools (boutons de la modale capture)
    REFS.shotButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        closeCaptureModal();
        runShotMode(btn.dataset.shot);
      });
    });

    // Capture modal : ouverture, fermeture, dropzone, file input
    const captureToggle = document.querySelector('[data-act="capture-toggle"]');
    const captureModal = document.getElementById('capture-modal');
    const captureClose = document.querySelector('[data-act="close-capture-modal"]');
    const dropzone = document.getElementById('capture-dropzone');
    const fileInput = document.getElementById('capture-file-input');

    if (captureToggle) captureToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      openCaptureModal('capture');
    });
    // Nouveau bouton Erreurs dans .biaif-quick-tools : ouvre la modale sur l'onglet Erreurs.
    const errorsToolBtn = document.querySelector('[data-act="open-errors"]');
    if (errorsToolBtn) errorsToolBtn.addEventListener('click', () => openCaptureModal('errors'));

    // Modal tabs
    document.querySelectorAll('.modal-tab').forEach((t) => {
      t.addEventListener('click', () => switchModalTab(t.dataset.tab));
    });
    // Modal : Texte → ajoute au segment courant
    const addTextBtn = document.querySelector('[data-act="add-text-from-modal"]');
    if (addTextBtn) addTextBtn.addEventListener('click', () => {
      const ta = document.getElementById('modal-text-input');
      if (!ta) return;
      const text = (ta.value || '').trim();
      if (!text) { setStatus('Entrez du texte avant d\'ajouter.', 'info'); return; }
      const targetMsg = typeof STATE.modalTarget === 'number'
        ? `Texte ajouté à la demande #${STATE.modalTarget + 1}.`
        : 'Texte ajouté au segment.';
      addTextToTarget(text);
      ta.value = '';
      closeCaptureModal();
      setStatus(targetMsg, 'success');
    });
    // Modal : Élément → active picker + ferme modale
    const activatePickerBtn = document.querySelector('[data-act="activate-picker-from-modal"]');
    if (activatePickerBtn) activatePickerBtn.addEventListener('click', async () => {
      closeCaptureModal();
      const resp = await sendBg({ type: 'biaif:picker-enable' });
      if (resp && resp.error) {
        setStatusError('Picker KO : ' + decodeContentScriptError(resp.error),
          isReloadableError(resp.error) ? 'reload-active-tab' : null);
      } else {
        setStatus('Sélecteur actif — cliquez l\'élément à référencer.', 'info');
      }
    });
    // Modal : Erreurs → tout ajouter / vider
    const errAddAllBtn = document.querySelector('[data-act="errors-add-all"]');
    if (errAddAllBtn) errAddAllBtn.addEventListener('click', () => { addAllConsoleErrors(); closeCaptureModal(); });
    const errClearBtn = document.querySelector('[data-act="errors-clear"]');
    if (errClearBtn) errClearBtn.addEventListener('click', () => clearConsoleErrors());
    if (captureClose) captureClose.addEventListener('click', () => closeCaptureModal());
    if (captureModal) captureModal.addEventListener('click', (e) => {
      if (e.target === captureModal) closeCaptureModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (captureModal && !captureModal.hasAttribute('hidden')) closeCaptureModal();
        else if (STATE.editingDemandeIdx !== null) exitEditMode();
      }
    });

    if (fileInput) fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      handleCaptureFiles(files);
      e.target.value = ''; // reset pour pouvoir re-déposer la même image
    });
    if (dropzone) {
      ['dragenter', 'dragover'].forEach((evt) => {
        dropzone.addEventListener(evt, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.add('is-dragover');
        });
      });
      ['dragleave', 'dragend'].forEach((evt) => {
        dropzone.addEventListener(evt, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.remove('is-dragover');
        });
      });
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('is-dragover');
        const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));
        if (files.length) handleCaptureFiles(files);
      });
    }
    // Sort toggle
    if (REFS.sortToggle) REFS.sortToggle.addEventListener('click', () => {
      STATE.sortOrder = STATE.sortOrder === 'desc' ? 'asc' : 'desc';
      updateSortToggleLabel();
      renderSegments();
      persist();
    });
    updateSortToggleLabel();

    // Boutons zoom des segments
    const fontDown = document.querySelector('[data-act="seg-font-down"]');
    const fontUp = document.querySelector('[data-act="seg-font-up"]');
    if (fontDown) fontDown.addEventListener('click', () => bumpSegFontSize(-1));
    if (fontUp)   fontUp.addEventListener('click', () => bumpSegFontSize(+1));
    applySegFontSize();

    // Mini footer : settings popover + shortcuts page
    if (REFS.toggleSettings) REFS.toggleSettings.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!REFS.settingsPopover) return;
      if (REFS.settingsPopover.hasAttribute('hidden')) REFS.settingsPopover.removeAttribute('hidden');
      else REFS.settingsPopover.setAttribute('hidden', '');
    });
    document.addEventListener('click', (e) => {
      if (!REFS.settingsPopover || REFS.settingsPopover.hasAttribute('hidden')) return;
      if (e.target.closest('#settings-popover') || e.target.closest('[data-act="toggle-settings"]')) return;
      REFS.settingsPopover.setAttribute('hidden', '');
    });
    if (REFS.openShortcuts) REFS.openShortcuts.addEventListener('click', () => {
      try { chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); } catch (_) {}
    });

    // Reload modal : bouton recharger + dismiss
    if (REFS.reloadModalBtn) REFS.reloadModalBtn.addEventListener('click', async () => {
      const resp = await sendBg({ type: 'biaif:reload-active-tab' });
      if (resp && resp.ok) {
        hideReloadModal();
        setStatus('Onglet rechargé — réessaye dans 1 s.', 'info');
      } else {
        setStatus('Recharge KO : ' + (resp ? resp.error : 'no resp'), 'error');
      }
    });
    if (REFS.reloadDismiss) REFS.reloadDismiss.addEventListener('click', () => hideReloadModal());

    // Délégation : "Modifier" dans le panneau d'un chip déplié.
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.ref-details-btn');
      if (!btn) return;
      e.stopPropagation();
      e.preventDefault();
      const chip = btn.closest('.ref-chip');
      if (!chip) return;
      const refIdx = Number(chip.dataset.ref);
      const demKeyRaw = chip.dataset.demKey;
      const demKey = demKeyRaw === 'current' ? 'current' : (demKeyRaw === undefined ? 'current' : Number(demKeyRaw));
      const editType = btn.dataset.editType;
      editRef(demKey, refIdx, editType);
    });

    // Click sur un chip → toggle expanded (un seul à la fois). Mais clics
    // À L'INTÉRIEUR du panneau de détails (.ref-details) ne replient pas,
    // pour permettre la sélection de texte / preview / etc.
    document.addEventListener('click', (e) => {
      const chip = e.target.closest('.ref-chip');
      if (chip) {
        // Le bouton Modifier est géré par le listener au-dessus
        if (e.target.closest('.ref-details-btn')) return;
        // Clic dans le corps des détails : laisser passer (sélection / preview)
        if (e.target.closest('.ref-details')) return;
        e.stopPropagation();
        const wasExpanded = chip.classList.contains('expanded');
        document.querySelectorAll('.ref-chip.expanded').forEach((c) => {
          c.classList.remove('expanded');
          c.draggable = true;
        });
        if (!wasExpanded) {
          chip.classList.add('expanded');
          chip.draggable = false; // pas de drag pendant l'expansion
        }
        return;
      }
      // Click hors d'un chip : on referme tout
      document.querySelectorAll('.ref-chip.expanded').forEach((c) => {
        c.classList.remove('expanded');
        c.draggable = true;
      });
    });

    // Drag-and-drop manuel des chips : on autorise le drop n'importe où dans
    // le MÊME container éditable que la source (l'éditeur courant ou la même
    // .demande-text de l'historique). On utilise caretRangeFromPoint pour
    // insérer la chip exactement à la position du curseur de la souris.
    document.addEventListener('dragover', (e) => {
      if (!DRAG.chip) return;
      const editable = e.target.closest('.demande-editor, .demande-text');
      if (!editable || editable !== DRAG.sourceContainer) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    document.addEventListener('drop', (e) => {
      if (!DRAG.chip) return;
      const editable = e.target.closest('.demande-editor, .demande-text');
      if (!editable || editable !== DRAG.sourceContainer) return;
      e.preventDefault();
      let range = null;
      if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(e.clientX, e.clientY);
      else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
        if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); range.collapse(true); }
      }
      if (!range || !editable.contains(range.startContainer)) {
        // Fallback : append à la fin du container
        editable.appendChild(DRAG.chip);
      } else {
        DRAG.chip.remove();
        range.insertNode(DRAG.chip);
      }
      // Re-sync du modèle pour ce container.
      if (editable === REFS.demandeEditor) {
        syncCurrentDemandeFromEditor();
        renderDemandeRefsStrip();
      } else {
        const idx = Number(editable.dataset.i);
        const dem = STATE.demandes[idx];
        if (dem) syncDemandeFromTextEl(editable, dem);
      }
      persist();
      DRAG.chip.classList.remove('is-dragging');
      DRAG.chip = null;
      DRAG.sourceContainer = null;
    });

    // Click on status zone : route to the right action based on data-action.
    REFS.status.addEventListener('click', async () => {
      if (REFS.status.dataset.kind !== 'error') return;
      const action = REFS.status.dataset.action;
      if (action === 'open-mic-settings') {
        openMicPermPage();
      } else if (action === 'reload-active-tab') {
        const resp = await sendBg({ type: 'biaif:reload-active-tab' });
        if (resp && resp.ok) setStatus('Onglet rechargé — réessaye dans 1 s.', 'info');
        else setStatus('Recharge KO : ' + (resp ? resp.error : 'no resp'), 'error');
      }
    });

    // Mic settings
    if (REFS.micDeviceSelect) {
      REFS.micDeviceSelect.addEventListener('change', (e) => {
        STATE.micDeviceId = e.target.value;
        persist();
        if (micTest) startMicTest(STATE.micDeviceId);
      });
    }
    if (REFS.micTestBtn) {
      REFS.micTestBtn.addEventListener('click', () => {
        if (micTest) stopMicTest();
        else         startMicTest(STATE.micDeviceId);
      });
    }
    if (REFS.micRefreshBtn) {
      REFS.micRefreshBtn.addEventListener('click', () => refreshMicDevices(true));
    }
    if (REFS.micPermLink) {
      REFS.micPermLink.addEventListener('click', (e) => { e.preventDefault(); openMicPermPage(); });
    }

    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', () => refreshMicDevices());
    }

    refreshMicDevices();
  }

  function openCaptureModal(tab) {
    const m = document.getElementById('capture-modal');
    if (!m) return;
    m.removeAttribute('hidden');
    if (tab) switchModalTab(tab);
    updateModalTitle();
    renderConsoleErrorsList();
  }
  function closeCaptureModal() {
    const m = document.getElementById('capture-modal');
    if (m) m.setAttribute('hidden', '');
    // Reset la cible : les actions hors modale ré-utilisent 'current'
    STATE.modalTarget = 'current';
    updateModalTitle();
  }
  function updateModalTitle() {
    const t = document.querySelector('.capture-modal-title');
    if (!t) return;
    if (typeof STATE.modalTarget === 'number') {
      t.textContent = `Ajouter à la demande #${STATE.modalTarget + 1}`;
    } else {
      t.textContent = 'Ajouter au segment';
    }
  }

  // Helper unifié : pousse une ref dans la cible courante. Priorité :
  // 1) segment en édition (editingDemandeIdx)
  // 2) modalTarget (clic depuis le bouton + d'un segment historique)
  // 3) demande en cours (mode live)
  function addRefToTarget(ref) {
    const idx = activeTargetIdx();
    if (typeof idx === 'number') {
      const dem = STATE.demandes[idx];
      if (!dem) return false;
      dem.refs = dem.refs || [];
      dem.refs.push(ref);
      const newIdx = dem.refs.length - 1;
      const cur = (dem.text || '').replace(/\s+$/, '');
      dem.text = (cur + (cur ? ' ' : '') + `{{ref:${newIdx}}} `).replace(/\s{2,}/g, ' ');
      renderSegments();
      // Si on était en édition, replace la quick-tools dans le segment
      // ré-rendu (le DOM a été remplacé)
      if (typeof STATE.editingDemandeIdx === 'number') {
        relocateQuickToolsToSegment(STATE.editingDemandeIdx);
      }
      persist();
      return true;
    }
    STATE.currentDemande.refs.push(ref);
    const absIdx = STATE.currentDemande.refs.length - 1;
    appendChipToEditor(absIdx, ref);
    rememberPageUrl();
    return true;
  }

  // Append du texte à la cible courante (éditeur ou .demande-text d'une
  // demande historique selon modalTarget / editingDemandeIdx).
  function addTextToTarget(text) {
    if (!text) return;
    const idx = activeTargetIdx();
    if (typeof idx === 'number') {
      const dem = STATE.demandes[idx];
      if (!dem) return;
      const textEl = document.querySelector(`.demande-text[data-i="${idx}"]`);
      if (textEl) {
        insertTextAtSelection(textEl, text);
        syncDemandeFromTextEl(textEl, dem);
      } else {
        const cur = dem.text || '';
        const sep = cur && !/\s$/.test(cur) ? ' ' : '';
        dem.text = (cur + sep + text.replace(/^\s+|\s+$/g, '') + ' ').replace(/\s{2,}/g, ' ');
        renderSegments();
      }
      persist();
      return;
    }
    if (REFS.demandeEditor) {
      REFS.demandeEditor.focus();
      insertTextAtSelection(REFS.demandeEditor, text);
      syncCurrentDemandeFromEditor();
      persist();
    }
  }

  // Renvoie l'index actif (édition de segment ou modalTarget), sinon null.
  function activeTargetIdx() {
    if (typeof STATE.editingDemandeIdx === 'number') return STATE.editingDemandeIdx;
    if (typeof STATE.modalTarget === 'number') return STATE.modalTarget;
    return null;
  }
  function switchModalTab(name) {
    document.querySelectorAll('.modal-tab').forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.modal-section').forEach((s) => {
      if (s.dataset.section === name) s.removeAttribute('hidden');
      else s.setAttribute('hidden', '');
    });
    if (name === 'text') {
      const ta = document.getElementById('modal-text-input');
      if (ta) setTimeout(() => ta.focus(), 50);
    }
  }

  // ============================================================
  // CONSOLE ERRORS — captés depuis la page active via content/main.js
  // ============================================================

  function onConsoleError(err) {
    if (!err || !err.key) return;
    if (STATE.consoleErrors.find((e) => e.key === err.key)) return; // dédup
    STATE.consoleErrors.push(err);
    updateErrorsBadges();
    renderConsoleErrorsList();
  }
  function updateErrorsBadges() {
    const n = STATE.consoleErrors.length;
    const tip = document.querySelector('[data-act="open-errors"] .tool-badge');
    const tab = document.querySelector('.modal-tab--errors .tab-badge');
    if (tip) { tip.textContent = String(n); tip.dataset.count = String(n); }
    if (tab) { tab.textContent = String(n); tab.dataset.count = String(n); }
    document.querySelector('[data-act="open-errors"]')?.classList.toggle('has-errors', n > 0);
  }
  function renderConsoleErrorsList() {
    const list = document.getElementById('errors-list');
    const actions = document.querySelector('[data-section="errors"] .errors-actions');
    if (!list) return;
    list.innerHTML = '';
    if (!STATE.consoleErrors.length) {
      list.innerHTML = '<div class="errors-empty">Aucune erreur détectée pour le moment.</div>';
      if (actions) actions.setAttribute('hidden', '');
      return;
    }
    if (actions) actions.removeAttribute('hidden');
    STATE.consoleErrors.forEach((err, i) => {
      const row = document.createElement('div');
      row.className = 'error-row';
      const where = err.file ? `${err.file}:${err.line || '?'}` : '(rejet promesse)';
      row.innerHTML = `
        <div class="error-row-head">
          <span class="error-row-num">#${i + 1}</span>
          <code class="error-row-where">${escapeHtml(where)}</code>
        </div>
        <div class="error-row-msg">${escapeHtml(err.msg || '')}</div>
        <div class="error-row-actions">
          <button class="btn-secondary error-row-ignore" data-i="${i}">Ignorer</button>
          <button class="btn-primary error-row-add" data-i="${i}">Ajouter au segment</button>
        </div>
      `;
      list.appendChild(row);
    });
    list.querySelectorAll('.error-row-add').forEach((btn) => {
      btn.addEventListener('click', () => addConsoleErrorToCurrentDemande(Number(btn.dataset.i)));
    });
    list.querySelectorAll('.error-row-ignore').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.i);
        STATE.consoleErrors.splice(idx, 1);
        updateErrorsBadges();
        renderConsoleErrorsList();
      });
    });
  }
  function addConsoleErrorToCurrentDemande(idx) {
    // Conservé sous ce nom pour rétro-compat ; route vers la nouvelle
    // logique : chaque erreur devient son propre segment.
    addConsoleErrorAsSegment(idx);
  }
  function addConsoleErrorAsSegment(idx) {
    const err = STATE.consoleErrors[idx];
    if (!err) return;
    const ref = {
      type: 'error',
      msg: err.msg || '',
      file: err.file || null,
      line: err.line || null,
      col: err.col || null,
      stack: err.stack || null,
      url: err.url || null,
      ts: err.ts || Date.now(),
    };
    const demande = {
      id: 'dem-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      text: '{{ref:0}}',
      refs: [ref],
      url: err.url || null,
    };
    STATE.demandes.push(demande);
    STATE.consoleErrors.splice(idx, 1);
    updateErrorsBadges();
    renderConsoleErrorsList();
    renderSegments();
    persist();
    setStatus(`Erreur ajoutée comme demande #${STATE.demandes.length}`, 'success');
  }
  function addAllConsoleErrors() {
    if (!STATE.consoleErrors.length) return;
    while (STATE.consoleErrors.length) addConsoleErrorAsSegment(0);
  }
  function clearConsoleErrors() {
    STATE.consoleErrors = [];
    updateErrorsBadges();
    renderConsoleErrorsList();
  }

  // ============================================================
  // CONTEXT MENU HANDLERS — actions issues du clic droit Chrome
  // ============================================================

  // Mémorise l'URL de l'onglet sur la demande en cours dès qu'un événement
  // pertinent survient (pick, capture, ajout via context menu...).
  async function rememberPageUrl(pageUrlOpt) {
    try {
      let url = pageUrlOpt || null;
      if (!url) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        url = tab?.url || null;
      }
      if (url) STATE.currentDemande.pageUrl = url;
    } catch (_) {}
  }

  function addTextFromContext(text, pageUrl) {
    if (!text) return;
    if (REFS.demandeEditor) {
      REFS.demandeEditor.focus();
      // On insère « text » entre guillemets pour bien repérer la sélection
      insertTextAtSelection(REFS.demandeEditor, '« ' + text + ' »');
      syncCurrentDemandeFromEditor();
      if (pageUrl) STATE.currentDemande.pageUrl = pageUrl;
      persist();
    }
    setStatus('Sélection texte ajoutée au segment courant.', 'success');
  }

  async function addImageFromContext(srcUrl, pageUrl) {
    if (!srcUrl) return;
    setStatus('Téléchargement de l\'image…', 'info');
    let dataUrl = null;
    try {
      const resp = await fetch(srcUrl);
      const blob = await resp.blob();
      dataUrl = await readBlobAsDataUrl(blob);
    } catch (e) {
      // Fallback : on garde l'URL seulement
    }
    const ref = {
      type: 'screenshot',
      mode: dataUrl ? 'image' : 'image-url',
      dataUrl: dataUrl,
      srcUrl,
      url: pageUrl || null,
      ts: Date.now(),
    };
    STATE.currentDemande.refs.push(ref);
    if (pageUrl) STATE.currentDemande.pageUrl = pageUrl;
    const absIdx = STATE.currentDemande.refs.length - 1;
    appendChipToEditor(absIdx, ref);
    setStatus(dataUrl ? 'Image ajoutée comme référence.' : 'Image ajoutée (URL seulement).', 'success');
  }

  function readBlobAsDataUrl(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
  }

  // ============================================================
  // MERGE DEMANDES (drag-and-drop d'une demande sur une autre)
  // ============================================================

  function mergeDemandes(srcIdx, dstIdx) {
    if (srcIdx === dstIdx) return;
    const src = STATE.demandes[srcIdx];
    const dst = STATE.demandes[dstIdx];
    if (!src || !dst) return;
    const offset = (dst.refs || []).length;
    const shifted = (src.text || '').replace(/\{\{ref:(\d+)\}\}/g, (_, n) => `{{ref:${Number(n) + offset}}}`);
    dst.text = ((dst.text || '') + (dst.text ? ' ' : '') + shifted).replace(/\s+/g, ' ').trim();
    dst.refs = [...(dst.refs || []), ...(src.refs || [])];
    STATE.demandes.splice(srcIdx, 1);
    // Remappe la cible de dictée si elle pointait sur src ou un index supérieur.
    if (typeof STATE.dictationTarget === 'number') {
      if (STATE.dictationTarget === srcIdx) STATE.dictationTarget = (srcIdx < dstIdx) ? dstIdx - 1 : dstIdx;
      else if (STATE.dictationTarget > srcIdx) STATE.dictationTarget--;
    }
    renderSegments();
    persist();
    const newDstNum = ((srcIdx < dstIdx) ? dstIdx - 1 : dstIdx) + 1;
    setStatus(`Demandes fusionnées dans #${newDstNum}.`, 'success');
  }

  // Lit chaque fichier image en dataUrl, l'ajoute comme ref de la demande en
  // cours et insère un chip dans l'éditeur. Ferme la modale après le 1er
  // ajout pour que l'utilisateur voie son chip.
  async function handleCaptureFiles(files) {
    if (!files || !files.length) return;
    let count = 0;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const ref = {
          type: 'screenshot',
          mode: 'fichier',
          dataUrl,
          fileName: file.name,
          ts: Date.now(),
        };
        addRefToTarget(ref);
        count++;
      } catch (e) {
        console.warn('[BIAIF] file read failed', e?.message || e);
      }
    }
    if (count) {
      closeCaptureModal();
      setStatus(`${count} image${count > 1 ? 's' : ''} ajoutée${count > 1 ? 's' : ''} comme référence${count > 1 ? 's' : ''}.`, 'success');
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  function openMicPermPage() {
    const url = `chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2F${chrome.runtime.id}`;
    chrome.tabs.create({ url });
  }

  function bindRuntimeMessages() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'biaif:element-picked') { onElementPicked(msg); return; }
      if (msg.type === 'biaif:picker-state')   { onPickerState(!!msg.active); return; }
      if (msg.type === 'biaif:console-error')  { onConsoleError(msg.error); return; }
      if (msg.type === 'biaif:context-status') { setStatus(msg.msg, 'info'); return; }
      if (msg.type === 'biaif:context-shot')   { runShotMode(msg.mode); return; }
      if (msg.type === 'biaif:context-add-text')  { addTextFromContext(msg.text, msg.pageUrl); return; }
      if (msg.type === 'biaif:context-add-image') { addImageFromContext(msg.srcUrl, msg.pageUrl); return; }
      if (msg.type === 'biaif:hotkey') {
        if (msg.action === 'toggle-mic')  toggleMic();
        if (msg.action === 'copy-prompt') copyPrompt();
        return;
      }
    });
  }

  function sendBg(payload) {
    return chrome.runtime.sendMessage(payload).catch(() => null);
  }

  function decodeContentScriptError(err) {
    const s = typeof err === 'string' ? err : (err && err.message) || String(err);
    if (s.includes('Receiving end does not exist') ||
        s.includes('Could not establish connection') ||
        s.includes('no active tab')) {
      return "content script pas prêt — clique ici pour recharger l'onglet (sinon vérifie que tu es sur une page http/https, pas chrome://)";
    }
    if (s.includes('Module screenshot indisponible')) {
      return 'le module screenshot ne s\'est pas chargé sur cet onglet — recharge la page (F5).';
    }
    return s;
  }

  function isReloadableError(err) {
    const s = typeof err === 'string' ? err : (err && err.message) || String(err);
    return s.includes('Receiving end does not exist') ||
           s.includes('Could not establish connection') ||
           s.includes('Module screenshot indisponible');
  }

  // ============================================================
  // PERSISTENCE
  // ============================================================

  async function hydrateFromStorage() {
    try {
      const obj = await chrome.storage.local.get(STORAGE_KEY);
      const saved = obj[STORAGE_KEY];
      if (!saved) return;
      if (Array.isArray(saved.demandes)) STATE.demandes = saved.demandes;
      if (saved.currentDemande && typeof saved.currentDemande.text === 'string') {
        STATE.currentDemande = {
          text: saved.currentDemande.text,
          refs: Array.isArray(saved.currentDemande.refs) ? saved.currentDemande.refs : [],
          pageUrl: saved.currentDemande.pageUrl || null,
        };
      }
      if (typeof saved.lang === 'string') {
        STATE.lang = saved.lang;
        if (REFS.langSelect) REFS.langSelect.value = saved.lang;
      }
      if (typeof saved.micDeviceId === 'string') STATE.micDeviceId = saved.micDeviceId;
      if (saved.sortOrder === 'asc' || saved.sortOrder === 'desc') STATE.sortOrder = saved.sortOrder;
      if (typeof saved.segFontSize === 'number' && saved.segFontSize >= 8 && saved.segFontSize <= 16) {
        STATE.segFontSize = saved.segFontSize;
      }
      updateSortToggleLabel();
      applySegFontSize();
      renderDemandeEditor();
      renderSegments();
      updateArmedUi();
    } catch (e) {
      console.warn('[BIAIF] hydrate failed', e?.message || e);
    }
  }

  function persist() {
    const payload = {
      demandes: STATE.demandes,
      currentDemande: STATE.currentDemande,
      lang: STATE.lang,
      micDeviceId: STATE.micDeviceId,
      sortOrder: STATE.sortOrder,
      segFontSize: STATE.segFontSize,
    };
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: payload }).catch(() => {
        const slim = {
          ...payload,
          demandes: payload.demandes.map((d) => ({
            ...d,
            refs: (d.refs || []).map((r) => r.type === 'screenshot' ? { ...r, dataUrl: null } : r),
          })),
          currentDemande: {
            ...payload.currentDemande,
            refs: (payload.currentDemande.refs || []).map((r) => r.type === 'screenshot' ? { ...r, dataUrl: null } : r),
          },
        };
        chrome.storage.local.set({ [STORAGE_KEY]: slim }).catch(() => {});
      });
    } catch (_) {}
  }

  let demandeEditTimer = null;
  document.addEventListener('input', (e) => {
    if (e.target && e.target === REFS.demandeEditor) {
      // L'utilisateur tape ou édite manuellement : on resync vers
      // STATE.currentDemande (debounced) et on persiste.
      if (demandeEditTimer) clearTimeout(demandeEditTimer);
      demandeEditTimer = setTimeout(() => {
        syncCurrentDemandeFromEditor();
        renderDemandeRefsStrip();
        persist();
      }, 400);
    }
  });

  // ============================================================
  // MIC SETTINGS : device enumeration + live level meter
  // ============================================================

  async function refreshMicDevices(forcePrompt = false) {
    if (!REFS.micDeviceSelect) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

    try {
      let alreadyGranted = false;
      try {
        const status = await navigator.permissions.query({ name: 'microphone' });
        alreadyGranted = (status.state === 'granted');
      } catch (_) {}
      if (alreadyGranted || forcePrompt) {
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          tempStream.getTracks().forEach((t) => t.stop());
        } catch (_) {}
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');

      const sel = REFS.micDeviceSelect;
      const previous = STATE.micDeviceId || sel.value || '';
      sel.innerHTML = '';
      const def = document.createElement('option');
      def.value = '';
      def.textContent = 'Système par défaut';
      sel.appendChild(def);
      for (const d of inputs) {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Micro (${(d.deviceId || '').slice(0, 8) || 'sans label'}…)`;
        sel.appendChild(opt);
      }
      if ([...sel.options].some((o) => o.value === previous)) sel.value = previous;
    } catch (e) {
      console.warn('[BIAIF] enumerateDevices failed', e?.message || e);
    }
  }

  async function startMicTest(deviceId) {
    stopMicTest();
    try {
      const constraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      micTest = { stream, ctx, analyser, data, raf: 0 };

      if (REFS.micMeter) REFS.micMeter.hidden = false;
      if (REFS.micTestBtn) REFS.micTestBtn.textContent = '⏹ Stop test';
      setStatus('Test micro en cours — parle pour voir le niveau.', 'info');

      refreshMicDevices();

      const tick = () => {
        if (!micTest) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const pct = Math.min(100, Math.round((avg / 96) * 100));
        if (REFS.micMeterBar)   REFS.micMeterBar.style.width = pct + '%';
        if (REFS.micMeterLabel) REFS.micMeterLabel.textContent = `Niveau : ${pct}%`;
        micTest.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      const msg = e && e.name === 'NotAllowedError' ? 'permission refusée' :
                  e && e.name === 'NotFoundError'   ? 'micro introuvable (déconnecté ?)' :
                  e && e.name === 'NotReadableError' ? 'micro déjà utilisé par une autre app' :
                  (e?.message || String(e));
      setStatusError('Test micro KO : ' + msg, 'open-mic-settings');
    }
  }

  function stopMicTest() {
    if (!micTest) return;
    cancelAnimationFrame(micTest.raf);
    try { micTest.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { micTest.ctx.close(); } catch (_) {}
    micTest = null;
    if (REFS.micMeter)      REFS.micMeter.hidden = true;
    if (REFS.micMeterBar)   REFS.micMeterBar.style.width = '0%';
    if (REFS.micMeterLabel) REFS.micMeterLabel.textContent = 'Niveau : —';
    if (REFS.micTestBtn)    REFS.micTestBtn.textContent = '🔊 Tester';
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && micTest) stopMicTest();
  });

  // ============================================================
  // MIC : SpeechRecognition runs HERE (sidepanel context)
  // ============================================================

  function isMicSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  async function ensureMicPermission() {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' });
      if (status.state === 'granted') return { ok: true };
      if (status.state === 'denied')  return { ok: false, reason: 'denied-extension' };
    } catch (_) {}
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { ok: false, reason: 'no-media-devices' };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return { ok: true };
    } catch (e) {
      if (e && e.name === 'NotAllowedError')  return { ok: false, reason: 'denied-extension' };
      if (e && e.name === 'NotFoundError')    return { ok: false, reason: 'audio-capture' };
      if (e && e.name === 'NotReadableError') return { ok: false, reason: 'audio-capture' };
      return { ok: false, reason: 'unknown' };
    }
  }

  function initMic() {
    if (MIC.rec) return true;
    if (!isMicSupported()) return false;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = STATE.lang;

    const log = (event, extra) => {
      const t = new Date().toISOString().slice(11, 23);
      console.log(`[BIAIF SR ${t}] ${event}${extra ? ' ' + JSON.stringify(extra) : ''}`);
      MIC.lastEventAt = Date.now();
    };

    rec.onstart       = () => { log('onstart', { lang: rec.lang }); setSrIndicator('🟢 SR démarré'); };
    rec.onaudiostart  = () => { log('onaudiostart');  setSrIndicator('🎤 audio reçu'); };
    rec.onsoundstart  = () => { log('onsoundstart');  };
    rec.onspeechstart = () => { log('onspeechstart'); setSrIndicator('🗣 parole détectée'); };
    rec.onspeechend   = () => { log('onspeechend');   };
    rec.onsoundend    = () => { log('onsoundend');    };
    rec.onaudioend    = () => { log('onaudioend');    };
    rec.onnomatch     = () => { log('onnomatch');     setSrIndicator('❓ inaudible (langue ?)'); };

    rec.onresult = (event) => {
      let finalChunk = '';
      let interimChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const txt = event.results[i][0].transcript;
        const conf = event.results[i][0].confidence;
        if (event.results[i].isFinal) finalChunk += txt + ' ';
        else interimChunk += txt;
        log('onresult', { final: event.results[i].isFinal, conf: Math.round((conf||0)*100), txt: txt.slice(0, 40) });
      }
      if (finalChunk) {
        MIC.finalTranscript += finalChunk;
        onVoiceTranscript(finalChunk.trim());
        setSrIndicator('✅ ' + finalChunk.trim().slice(0, 32));
      }
      if (interimChunk) {
        onVoiceInterim(interimChunk);
        setSrIndicator('… ' + interimChunk.slice(0, 32));
      }
    };

    rec.onerror = (event) => {
      log('onerror', { error: event.error });
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      onVoiceError(event.error);
    };

    rec.onend = () => {
      log('onend', { stillActive: STATE.micActive });
      if (!STATE.micActive) {
        setMicActive(false);
        return;
      }
      setTimeout(() => {
        if (!STATE.micActive) return;
        try { rec.start(); }
        catch (e) {
          STATE.micActive = false;
          onVoiceError('auto-restart-failed');
          setMicActive(false);
        }
      }, 200);
    };

    MIC.rec = rec;
    return true;
  }

  let srWatchdog = null;
  function startSrWatchdog() {
    stopSrWatchdog();
    MIC.lastEventAt = Date.now();
    srWatchdog = setInterval(() => {
      if (!STATE.micActive) { stopSrWatchdog(); return; }
      const idle = Date.now() - (MIC.lastEventAt || 0);
      if (idle > 10000) {
        setSrIndicator('⚠ aucun event SR depuis 10 s — vérifier le micro défaut Chrome');
      }
    }, 2000);
  }
  function stopSrWatchdog() {
    if (srWatchdog) { clearInterval(srWatchdog); srWatchdog = null; }
  }

  function setSrIndicator(text) {
    if (REFS.interim) REFS.interim.textContent = text || '';
  }

  async function startMic() {
    if (STATE.micActive) return true;
    if (!isMicSupported()) {
      onVoiceError('not-supported');
      return false;
    }
    const perm = await ensureMicPermission();
    if (!perm.ok) {
      onVoiceError(perm.reason);
      return false;
    }
    if (!initMic()) {
      onVoiceError('init-failed');
      return false;
    }
    try {
      MIC.rec.start();
      STATE.micActive = true;
      setMicActive(true);
      startSrWatchdog();
      refreshMicDevices();
      return true;
    } catch (e) {
      onVoiceError('start-failed');
      return false;
    }
  }

  function stopMic() {
    if (!STATE.micActive) return;
    STATE.micActive = false;
    stopSrWatchdog();
    try { MIC.rec && MIC.rec.stop(); } catch (_) {}
  }

  async function toggleMic() {
    if (STATE.micActive) stopMic();
    else                 await startMic();
  }

  // ----- Voice event handlers (in-context, no message routing) -----

  function setMicActive(active) {
    STATE.micActive = active;
    if (REFS.micBtn) {
      REFS.micBtn.classList.toggle('active', active);
      const lbl = REFS.micBtn.querySelector('.label');
      if (lbl) lbl.textContent = active ? 'Micro ✓' : 'Micro';
    }
    if (!active && REFS.interim) REFS.interim.textContent = '';
  }

  function onVoiceInterim(text) {
    STATE.currentInterim = text || '';
    if (REFS.interim) REFS.interim.textContent = text || '';
  }

  function onVoiceTranscript(text) {
    if (!text) return;
    STATE.currentInterim = '';
    if (REFS.interim) REFS.interim.textContent = '';
    // Priorité : segment en édition > dictation target classique > éditeur live
    if (typeof STATE.editingDemandeIdx === 'number') {
      appendVoiceToDemande(STATE.editingDemandeIdx, text);
    } else if (typeof STATE.dictationTarget === 'number') {
      appendVoiceToDemande(STATE.dictationTarget, text);
    } else {
      appendVoiceToEditor(text);
    }
  }

  // Append du texte voix à une demande finalisée. Si la .demande-text
  // correspondante est en focus (curseur dedans), insère à la position
  // du curseur ; sinon append à la fin du modèle puis re-render.
  function appendVoiceToDemande(idx, text) {
    const dem = STATE.demandes[idx];
    if (!dem || !text) return;
    const textEl = document.querySelector(`.demande-text[data-i="${idx}"]`);
    if (textEl) {
      insertTextAtSelection(textEl, text);
      syncDemandeFromTextEl(textEl, dem);
    } else {
      const trimmed = text.replace(/^\s+|\s+$/g, '');
      const cur = dem.text || '';
      const sep = cur && !/\s$/.test(cur) ? ' ' : '';
      dem.text = (cur + sep + trimmed + ' ').replace(/\s{2,}/g, ' ').replace(/\s+$/, ' ');
      renderSegments();
    }
    persist();
  }

  /**
   * Met à jour le « buffer preview » qui montre à l'utilisateur ce qui
   * sera attaché au prochain élément cliqué : texte final accumulé +
   * texte interim en cours.
   */
  function updateBufferPreview() { /* obsolète : preview retirée */ }

  function onVoiceError(code) {
    const isPermDenied = code === 'not-allowed' || code === 'service-not-allowed' || code === 'denied-extension';
    setStatusError('Micro : ' + voiceErrorFr(code), isPermDenied ? 'open-mic-settings' : null);
  }

  // ============================================================
  // MASTER SESSION
  // ============================================================

  function toggleSession() {
    STATE.armed ? stopSession() : startSession();
  }

  async function startSession() {
    if (STATE.armed) return;
    if (STATE.editingDemandeIdx !== null) exitEditMode({ silent: true });
    STATE.armed = true;
    if (REFS.masterBtn) {
      REFS.masterBtn.classList.add('armed');
      const lbl = REFS.masterBtn.querySelector('.master-label');
      if (lbl) lbl.textContent = 'Suivant';
    }
    if (REFS.stopBtn) REFS.stopBtn.hidden = false;
    if (REFS.sessionInfo) REFS.sessionInfo.textContent = 'Session active — parlez puis cliquez les éléments';
    updateArmedUi();
    startTimer();
    updateBufferPreview();
    if (!STATE.pickerActive) {
      const resp = await sendBg({ type: 'biaif:picker-enable' });
      if (resp && resp.error) {
        setStatusError('Picker KO : ' + decodeContentScriptError(resp.error),
          isReloadableError(resp.error) ? 'reload-active-tab' : null);
      }
    }
    if (!STATE.micActive) await startMic();
    setStatus('Session démarrée.', 'success');
  }

  function stopSession() {
    if (!STATE.armed) return;
    if (STATE.editingDemandeIdx !== null) exitEditMode({ silent: true });
    STATE.armed = false;
    if (REFS.masterBtn) {
      REFS.masterBtn.classList.remove('armed');
      const lbl = REFS.masterBtn.querySelector('.master-label');
      if (lbl) lbl.textContent = 'Démarrer';
    }
    if (REFS.stopBtn) REFS.stopBtn.hidden = true;
    if (REFS.sessionInfo) REFS.sessionInfo.textContent = 'Session arrêtée';
    stopTimer();
    if (STATE.pickerActive) sendBg({ type: 'biaif:picker-disable' });
    if (STATE.micActive)    stopMic();
    updateBufferPreview();
    // Si la demande en cours a du contenu, on la finalise automatiquement.
    syncCurrentDemandeFromEditor();
    if ((STATE.currentDemande.text || '').trim() || STATE.currentDemande.refs.length) {
      finalizeDemande();
    }
    updateArmedUi();
    setStatus(`Session arrêtée — ${STATE.demandes.length} demande(s) capturée(s).`, 'info');
  }

  // Reflète l'état armed de la session sur l'UI : montre/cache les
  // quick-tools et la zone de demande. La zone de demande reste visible
  // si elle contient déjà du contenu (édition d'une demande pré-existante
  // après un reload de la sidebar).
  function updateArmedUi() {
    const root = document.querySelector('.biaif-root');
    if (root) {
      root.classList.toggle('is-armed', !!STATE.armed);
      root.classList.toggle('is-editing-segment', typeof STATE.editingDemandeIdx === 'number');
    }
    const qt = document.querySelector('.biaif-quick-tools');
    const editing = typeof STATE.editingDemandeIdx === 'number';
    if (qt) qt.classList.toggle('is-hidden', !STATE.armed && !editing);
    const dz = document.querySelector('.demande-zone');
    if (dz) {
      const hasContent = !!((STATE.currentDemande.text || '').trim() || STATE.currentDemande.refs.length);
      dz.classList.toggle('is-locked', editing || (!STATE.armed && !hasContent));
    }
  }

  // ============================================================
  // EDIT MODE — édition d'une demande finalisée
  // ============================================================

  // Entre en mode édition pour le segment d'index idx. Déplace
  // physiquement la .biaif-quick-tools dans le segment, masque la
  // .demande-zone, focalise le texte du segment.
  function enterEditMode(idx) {
    if (idx == null || idx === STATE.editingDemandeIdx) return;
    if (STATE.editingDemandeIdx !== null) exitEditMode({ silent: true });
    STATE.editingDemandeIdx = idx;
    STATE.dictationTarget = idx;
    STATE.modalTarget = 'current';
    // Active mic ET picker comme un Démarrer ciblé
    if (!STATE.micActive) startMic();
    if (!STATE.pickerActive) sendBg({ type: 'biaif:picker-enable' });
    renderSegments();
    relocateQuickToolsToSegment(idx);
    updateArmedUi();
    setTimeout(() => {
      const card = document.querySelector(`.biaif-segment[data-i="${idx}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const textEl = document.querySelector(`.demande-text[data-i="${idx}"]`);
      if (textEl) textEl.focus();
    }, 30);
    setStatus(`Édition de la demande #${idx + 1} — voix, picker, capture s'y insèrent.`, 'info');
  }

  function exitEditMode(opts) {
    if (STATE.editingDemandeIdx === null) return;
    STATE.editingDemandeIdx = null;
    STATE.dictationTarget = 'current';
    // Désactive le picker si on n'est pas en mode live, sinon on le laisse actif
    if (!STATE.armed && STATE.pickerActive) sendBg({ type: 'biaif:picker-disable' });
    relocateQuickToolsToTop();
    renderSegments();
    updateArmedUi();
    if (!opts || !opts.silent) setStatus('Mode édition terminé.', 'info');
  }

  function relocateQuickToolsToSegment(idx) {
    const qt = document.querySelector('.biaif-quick-tools');
    const card = document.querySelector(`.biaif-segment[data-i="${idx}"]`);
    if (!qt || !card) return;
    // Insère après le header
    const header = card.querySelector('header');
    if (header && header.nextSibling) header.parentNode.insertBefore(qt, header.nextSibling);
    else card.appendChild(qt);
  }
  function relocateQuickToolsToTop() {
    const qt = document.querySelector('.biaif-quick-tools');
    const sessionBar = document.querySelector('.session-bar');
    if (!qt || !sessionBar) return;
    // Insère juste après .session-bar (sa position d'origine)
    sessionBar.parentNode.insertBefore(qt, sessionBar.nextSibling);
  }

  function startTimer() {
    if (!REFS.timer) return;
    timerStart = Date.now();
    timerInterval = setInterval(() => {
      const s = Math.floor((Date.now() - timerStart) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      REFS.timer.textContent = `${mm}:${ss}`;
    }, 250);
  }
  function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    if (REFS.timer) REFS.timer.textContent = '00:00';
  }

  // ============================================================
  // PICKER + SEGMENTS
  // ============================================================

  function onPickerState(active) {
    STATE.pickerActive = active;
    if (!REFS.pickerBtn) return;
    REFS.pickerBtn.classList.toggle('active', active);
    const lbl = REFS.pickerBtn.querySelector('.label');
    if (lbl) lbl.textContent = active ? 'Picker actif' : 'Sélecteur';
  }

  function onElementPicked(msg) {
    const descriptor = msg.descriptor || { selector: '?', tag: null, id: null, classes: [], text: null, outerHTML: null };
    const ref = {
      type: 'element',
      selector: descriptor.selector || '?',
      tag: descriptor.tag || null,
      id: descriptor.id || null,
      classes: descriptor.classes || [],
      text: descriptor.text || null,
      outerHTML: descriptor.outerHTML || null,
      screenshot: msg.screenshot || null,
      metadata: msg.metadata || null,
      ts: Date.now(),
    };

    // Mode remplacement : on remplace la ref ciblée et on désactive le picker.
    if (STATE.replacingRef) {
      const { demKey, refIndex } = STATE.replacingRef;
      STATE.replacingRef = null;
      const target = demKey === 'current' ? STATE.currentDemande : STATE.demandes[demKey];
      if (target && target.refs && target.refs[refIndex]) {
        target.refs[refIndex] = ref;
        if (demKey === 'current') {
          renderDemandeEditor();
        } else {
          renderSegments();
        }
        persist();
        setStatus(`Référence #${refIndex + 1} mise à jour : ${shortLabel(descriptor)}`, 'success');
      }
      // On désactive le picker uniquement si la session est inactive,
      // sinon on le laisse actif (l'utilisateur est en flow de session).
      if (!STATE.armed) sendBg({ type: 'biaif:picker-disable' });
      return;
    }

    // Cas normal : route via la cible courante (édition / modal / live).
    const tIdx = activeTargetIdx();
    addRefToTarget(ref);
    setStatus(typeof tIdx === 'number'
      ? `Élément ajouté à la demande #${tIdx + 1} : ${shortLabel(descriptor)}`
      : `Référence ajoutée : ${shortLabel(descriptor)}`, 'success');
    STATE.modalTarget = 'current';
  }

  /**
   * Renvoie un libellé COURT et lisible pour l'affichage UI d'un segment.
   * Le sélecteur CSS complet reste dans seg.element.selector pour le prompt
   * IA et le tooltip — on n'allège QUE l'affichage sidebar.
   *
   * Priorité : id > tag.classe-courte > <tag> "texte" > <tag>
   */
  function shortLabel(descriptor) {
    if (!descriptor) return '?';
    const tag = (descriptor.tag || 'el').toString().toLowerCase();
    if (descriptor.id) return '#' + descriptor.id;
    let label = '<' + tag + '>';
    if (Array.isArray(descriptor.classes) && descriptor.classes.length) {
      // Filtre : on évite les classes très longues (≥ 22 chars) ou
      // camelCase à rallonge (typique des hash-styles type CSS-in-JS,
      // ytLockupViewModelHost, etc.)
      const candidates = descriptor.classes.filter((c) => {
        if (!c || c.length > 22) return false;
        const camel = (c.match(/[A-Z]/g) || []).length;
        return camel < 3;
      });
      if (candidates.length) label = tag + '.' + candidates[0];
    }
    if (descriptor.text) {
      const snip = String(descriptor.text).replace(/\s+/g, ' ').trim();
      if (snip) {
        label += ' « ' + (snip.length > 40 ? snip.slice(0, 40) + '…' : snip) + ' »';
      }
    }
    return label;
  }

  /**
   * Crée un segment "voix seule" : flush le buffer (final + interim) en
   * tant que segment sans élément ni screenshot. Permet de découper la
   * dictée à la volée — « je veux remplacer ça (clic) par ça (clic)
   * et ajouter ce texte (Suivant) ».
   */
  // ============================================================
  // DEMANDE EDITOR — Mad-Libs flow
  // ============================================================

  // Crée le DOM d'un chip de référence (inline dans l'éditeur).
  // Crée le DOM d'un chip de référence + panneau de détails inline.
  // Au clic, le chip s'élargit à 100% et affiche ses détails sous le label.
  // opts : { readOnly?, displayNum?, demKey? }
  function makeChipElement(absIdx, ref, opts) {
    opts = opts || {};
    const span = document.createElement('span');
    span.className = 'ref-chip ref-chip--' + (ref?.type || 'element');
    if (opts.readOnly) span.classList.add('ref-chip-readonly');
    span.contentEditable = 'false';
    span.dataset.ref = String(absIdx);
    if (opts.demKey !== undefined) span.dataset.demKey = String(opts.demKey);

    const isShot = ref?.type === 'screenshot';
    const isErr = ref?.type === 'error';
    if (isErr) span.classList.add('ref-chip--error');
    const icon = isShot
      ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="3"/></svg>'
      : isErr
      ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>';
    const labelKind = isShot ? 'capture' : isErr ? 'erreur' : 'élément';
    const num = opts.displayNum || (absIdx + 1);

    const header = document.createElement('span');
    header.className = 'ref-chip-header';
    header.innerHTML = `${icon}<span class="ref-chip-label">${labelKind} #${num}</span><span class="ref-chip-toggle" aria-hidden="true">▾</span>`;

    const details = document.createElement('span');
    details.className = 'ref-details';
    if (isShot) {
      const img = document.createElement('img');
      img.className = 'ref-details-img';
      img.src = ref.dataUrl || '';
      img.alt = 'capture #' + num;
      details.appendChild(img);
      const meta = document.createElement('span');
      meta.className = 'ref-details-meta';
      meta.textContent = `Mode : ${ref.mode || 'visible'}`;
      details.appendChild(meta);
      const btn = document.createElement('button');
      btn.className = 'ref-details-btn';
      btn.type = 'button';
      btn.dataset.editType = 'screenshot';
      btn.textContent = '✏ Re-annoter';
      details.appendChild(btn);
    } else if (isErr) {
      const meta = document.createElement('span');
      meta.className = 'ref-details-meta';
      const lines = [];
      if (ref.msg)             lines.push(`<span class="t-key">message</span> ${escapeHtml(ref.msg)}`);
      if (ref.file)            lines.push(`<span class="t-key">fichier</span> ${escapeHtml(ref.file)}:${ref.line || '?'}${ref.col ? ':' + ref.col : ''}`);
      if (ref.url)             lines.push(`<span class="t-key">page</span> ${escapeHtml(ref.url)}`);
      meta.innerHTML = lines.join('<br>');
      details.appendChild(meta);
      if (ref.stack) {
        const sel = document.createElement('span');
        sel.className = 'ref-details-selector';
        sel.innerHTML = '<code>' + escapeHtml(ref.stack.slice(0, 800)) + (ref.stack.length > 800 ? '\n…(tronqué)' : '') + '</code>';
        details.appendChild(sel);
      }
    } else {
      const meta = document.createElement('span');
      meta.className = 'ref-details-meta';
      const lines = [];
      if (ref?.tag)             lines.push(`<span class="t-key">tag</span> &lt;${escapeHtml(ref.tag)}&gt;`);
      if (ref?.id)              lines.push(`<span class="t-key">id</span> #${escapeHtml(ref.id)}`);
      if (ref?.classes?.length) lines.push(`<span class="t-key">classes</span> ${escapeHtml(ref.classes.join(' '))}`);
      if (ref?.text)            lines.push(`<span class="t-key">texte</span> « ${escapeHtml(ref.text.slice(0, 120))}${ref.text.length > 120 ? '…' : ''} »`);
      meta.innerHTML = lines.join('<br>') || '<em>Pas de détails</em>';
      details.appendChild(meta);
      if (ref?.selector) {
        const sel = document.createElement('span');
        sel.className = 'ref-details-selector';
        sel.innerHTML = '<code>' + escapeHtml(ref.selector) + '</code>';
        details.appendChild(sel);
      }
      const btn = document.createElement('button');
      btn.className = 'ref-details-btn';
      btn.type = 'button';
      btn.dataset.editType = 'element';
      btn.textContent = '⌖ Re-piquer';
      details.appendChild(btn);
    }

    span.appendChild(header);
    span.appendChild(details);

    // Drag-and-drop : la chip peut être réordonnée à l'intérieur du même
    // éditeur. Désactivé quand le chip est "expanded".
    span.draggable = true;
    span.addEventListener('dragstart', (e) => {
      if (span.classList.contains('expanded')) { e.preventDefault(); return; }
      DRAG.chip = span;
      DRAG.sourceContainer = span.closest('.demande-editor, .demande-text');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', '__biaif_chip__'); } catch (_) {}
      span.classList.add('is-dragging');
    });
    span.addEventListener('dragend', () => {
      span.classList.remove('is-dragging');
      DRAG.chip = null;
      DRAG.sourceContainer = null;
    });
    return span;
  }

  // Insère un chip à la fin de l'éditeur courant + un espace après.
  function appendChipToEditor(absIdx, ref) {
    const ed = REFS.demandeEditor;
    if (!ed) return;
    const last = ed.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE && !/\s$/.test(last.textContent)) {
      last.textContent += ' ';
    } else if (last && last.nodeType === Node.ELEMENT_NODE) {
      ed.appendChild(document.createTextNode(' '));
    }
    ed.appendChild(makeChipElement(absIdx, ref, { demKey: 'current' }));
    ed.appendChild(document.createTextNode(' '));
    syncCurrentDemandeFromEditor();
    renderDemandeRefsStrip();
    persist();
  }

  // Append du texte voix dans l'éditeur courant à la position du curseur.
  // Si le curseur n'est pas dans l'éditeur, append à la fin.
  function appendVoiceToEditor(text) {
    const ed = REFS.demandeEditor;
    if (!ed || !text) return;
    insertTextAtSelection(ed, text);
    syncCurrentDemandeFromEditor();
    persist();
  }

  // Reconstruit STATE.currentDemande {text, refs} en marchant le DOM de
  // l'éditeur. Utilise un mapping ancien->nouveau index pour gérer les
  // suppressions de chips (Backspace) sans casser les références.
  function syncCurrentDemandeFromEditor() {
    const ed = REFS.demandeEditor;
    if (!ed) return;
    const oldRefs = STATE.currentDemande.refs;
    const newRefs = [];
    let text = '';
    walkEditorNodes(ed, (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList && node.classList.contains('ref-chip')) {
          const oldIdx = Number(node.dataset.ref);
          const ref = oldRefs[oldIdx];
          if (ref) {
            newRefs.push(ref);
            const newIdx = newRefs.length - 1;
            text += `{{ref:${newIdx}}}`;
            node.dataset.ref = String(newIdx);
            // Met à jour le numéro affiché dans le chip
            const numSpan = node.querySelector('span');
            if (numSpan) numSpan.textContent = numSpan.textContent.replace(/#\d+/, '#' + (newIdx + 1));
          }
        } else if (node.tagName === 'BR') {
          text += '\n';
        }
      }
    });
    STATE.currentDemande.text = text;
    STATE.currentDemande.refs = newRefs;
  }

  function walkEditorNodes(root, cb) {
    for (const node of root.childNodes) {
      cb(node);
      // Pas de descente : on n'autorise pas la mise en forme imbriquée
    }
  }

  // Rend l'éditeur depuis STATE.currentDemande (utilisé après hydrate).
  function renderDemandeEditor() {
    const ed = REFS.demandeEditor;
    if (!ed) return;
    ed.innerHTML = '';
    const { text, refs } = STATE.currentDemande;
    if (!text) { renderDemandeRefsStrip(); return; }
    const re = /\{\{ref:(\d+)\}\}/g;
    let last = 0; let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) ed.appendChild(document.createTextNode(text.slice(last, m.index)));
      const idx = Number(m[1]);
      const ref = refs[idx];
      if (ref) ed.appendChild(makeChipElement(idx, ref, { demKey: 'current' }));
      last = m.index + m[0].length;
    }
    if (last < text.length) ed.appendChild(document.createTextNode(text.slice(last)));
    renderDemandeRefsStrip();
  }

  function renderDemandeRefsStrip() {
    if (REFS.demandeRefsCount) {
      const n = STATE.currentDemande.refs.length;
      REFS.demandeRefsCount.textContent = n + ' réf' + (n > 1 ? 's' : '');
      REFS.demandeRefsCount.dataset.count = String(n);
    }
    const strip = REFS.demandeRefsStrip;
    if (!strip) return;
    strip.innerHTML = '';
    STATE.currentDemande.refs.forEach((ref, i) => {
      const mini = document.createElement('div');
      mini.className = 'ref-mini ref-mini--' + (ref.type || 'element');
      const num = document.createElement('span');
      num.className = 'ref-mini-num';
      num.textContent = '#' + (i + 1);
      mini.appendChild(num);
      if (ref.type === 'screenshot' && ref.dataUrl) {
        const img = document.createElement('img');
        img.className = 'ref-mini-thumb';
        img.src = ref.dataUrl;
        mini.appendChild(img);
        const lbl = document.createElement('span');
        lbl.className = 'ref-mini-label';
        lbl.textContent = ref.mode || 'capture';
        mini.appendChild(lbl);
      } else {
        const lbl = document.createElement('span');
        lbl.className = 'ref-mini-label';
        lbl.textContent = ref.selector || ref.tag || '?';
        mini.appendChild(lbl);
      }
      strip.appendChild(mini);
    });
  }

  // Suivant : finalise la demande en cours et l'ajoute à l'historique.
  function finalizeDemande() {
    if (STATE.editingDemandeIdx !== null) {
      // En édition d'un segment historique : "Suivant" termine l'édition.
      exitEditMode();
      return;
    }
    syncCurrentDemandeFromEditor();
    const { text, refs } = STATE.currentDemande;
    const cleaned = (text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned && !refs.length) {
      setStatus('Rien à finaliser — parlez ou ajoutez une référence.', 'info');
      return;
    }
    const demande = {
      id: 'dem-' + Date.now(),
      ts: Date.now(),
      text: cleaned,
      refs: refs.slice(),
      url: STATE.currentDemande.pageUrl || null,
    };
    STATE.demandes.push(demande);
    STATE.currentDemande = { text: '', refs: [], pageUrl: null };
    if (REFS.demandeEditor) REFS.demandeEditor.innerHTML = '';
    renderDemandeRefsStrip();
    renderSegments();
    updateArmedUi();
    persist();
    setStatus(`Demande #${STATE.demandes.length} finalisée.`, 'success');
  }

  // Alias rétro-compatible : les anciens chemins appellent encore nextVoiceSegment.
  function nextVoiceSegment() { finalizeDemande(); }

  // Rend l'historique des demandes (ex-renderSegments).
  function renderSegments() {
    if (!REFS.segments) return;
    REFS.segments.innerHTML = '';
    if (REFS.segmentsCount) REFS.segmentsCount.textContent = String(STATE.demandes.length);
    if (!STATE.demandes.length) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'biaif-empty';
      emptyEl.textContent = 'Aucune demande pour le moment';
      REFS.segments.appendChild(emptyEl);
      return;
    }

    const indexed = STATE.demandes.map((d, idx) => ({ dem: d, origIndex: idx }));
    if (STATE.sortOrder === 'desc') indexed.reverse();

    indexed.forEach(({ dem, origIndex }) => {
      const num = origIndex + 1;
      const card = document.createElement('article');
      card.className = 'biaif-segment';
      const dt = new Date(dem.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const refsCount = (dem.refs || []).length;
      const isEditing = STATE.editingDemandeIdx === origIndex;
      if (isEditing) card.classList.add('is-editing');
      card.dataset.i = String(origIndex);
      const pageUrl = dem.url || '';
      const shortUrl = formatPageUrl(pageUrl);
      const urlLine = pageUrl
        ? `<a class="seg-url" href="${escapeHtml(pageUrl)}" target="_blank" rel="noopener" title="${escapeHtml(pageUrl)}">${escapeHtml(shortUrl)}</a>`
        : '<span class="seg-url seg-url-empty">URL inconnue</span>';
      const editBtnHtml = isEditing
        ? `<button class="seg-edit-btn is-active" data-i="${origIndex}" title="Terminer l'édition" aria-label="Terminer l'édition">
             <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
             <span>Terminer</span>
           </button>`
        : `<button class="seg-edit-btn" data-i="${origIndex}" title="Éditer cette demande (voix, picker, capture s'y insèrent)" aria-label="Éditer cette demande">
             <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
           </button>`;
      card.innerHTML = `
        <header>
          <button class="seg-drag-handle" data-i="${origIndex}" title="Glisser sur une autre demande pour fusionner" aria-label="Poignée de fusion">⋮⋮</button>
          <span class="seg-num">#${num}</span>
          <span class="seg-meta">${dt} · ${refsCount} réf${refsCount > 1 ? 's' : ''}</span>
          ${editBtnHtml}
          <button class="seg-del" data-i="${origIndex}" title="Supprimer">×</button>
        </header>
        <div class="seg-urlbar">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          ${urlLine}
        </div>
        <div class="demande-text ${dem.text ? '' : 'demande-text-empty'}"
             contenteditable="true" spellcheck="true"
             data-i="${origIndex}"
             data-placeholder="(demande vide)"></div>
      `;
      // Rendu du texte avec chips read-only
      const textEl = card.querySelector('.demande-text');
      renderTextWithChips(dem.text || '', dem.refs || [], textEl, { readOnly: true, demKey: origIndex });
      // Édition manuelle : sync sur blur, garder les chips intacts
      textEl.addEventListener('blur', () => {
        // Reconstruit le texte/refs depuis le DOM (chips read-only mais text éditable)
        const oldRefs = dem.refs || [];
        const newRefs = [];
        let txt = '';
        for (const node of textEl.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) txt += node.textContent;
          else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList && node.classList.contains('ref-chip')) {
              const oldIdx = Number(node.dataset.ref);
              const ref = oldRefs[oldIdx];
              if (ref) {
                newRefs.push(ref);
                txt += `{{ref:${newRefs.length - 1}}}`;
              }
            } else if (node.tagName === 'BR') txt += '\n';
            else txt += node.textContent;
          }
        }
        dem.text = txt.replace(/\s+/g, ' ').trim();
        dem.refs = newRefs;
        persist();
      });
      textEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.currentTarget.blur(); });

      card.querySelector('.seg-edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const i = Number(e.currentTarget.dataset.i);
        if (STATE.editingDemandeIdx === i) exitEditMode();
        else enterEditMode(i);
      });
      // Clic dans le texte d'un segment hors mode édition → entre en édition.
      textEl.addEventListener('focus', () => {
        if (STATE.editingDemandeIdx !== origIndex) enterEditMode(origIndex);
      });
      // Drag handle : initie la fusion. La carte entière est drop target.
      const dragHandle = card.querySelector('.seg-drag-handle');
      dragHandle.draggable = true;
      dragHandle.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', '__biaif_segment__'); } catch (_) {}
        SEG_DRAG.sourceIdx = origIndex;
        card.classList.add('is-dragging-seg');
      });
      dragHandle.addEventListener('dragend', () => {
        SEG_DRAG.sourceIdx = -1;
        document.querySelectorAll('.biaif-segment.is-dragging-seg, .biaif-segment.is-drop-target')
          .forEach((c) => c.classList.remove('is-dragging-seg', 'is-drop-target'));
      });
      card.addEventListener('dragover', (e) => {
        if (SEG_DRAG.sourceIdx < 0 || SEG_DRAG.sourceIdx === origIndex) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('is-drop-target');
      });
      card.addEventListener('dragleave', (e) => {
        // dragleave fire aussi quand on entre dans un enfant ; on vérifie qu'on quitte vraiment la carte
        if (e.relatedTarget && card.contains(e.relatedTarget)) return;
        card.classList.remove('is-drop-target');
      });
      card.addEventListener('drop', (e) => {
        if (SEG_DRAG.sourceIdx < 0 || SEG_DRAG.sourceIdx === origIndex) return;
        e.preventDefault();
        card.classList.remove('is-drop-target');
        const src = SEG_DRAG.sourceIdx;
        SEG_DRAG.sourceIdx = -1;
        mergeDemandes(src, origIndex);
      });

      card.querySelector('.seg-del').addEventListener('click', (e) => {
        const i = Number(e.currentTarget.dataset.i);
        STATE.demandes.splice(i, 1);
        renderSegments();
        persist();
      });
      REFS.segments.appendChild(card);
    });
  }

  // Rend un texte (avec tokens {{ref:N}}) + ses refs[] en mixant text nodes et chips.
  function renderTextWithChips(text, refs, root, opts) {
    root.innerHTML = '';
    const re = /\{\{ref:(\d+)\}\}/g;
    let last = 0; let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) root.appendChild(document.createTextNode(text.slice(last, m.index)));
      const idx = Number(m[1]);
      const ref = refs[idx];
      if (ref) root.appendChild(makeChipElement(idx, ref, {
        readOnly: true,
        displayNum: idx + 1,
        demKey: opts ? opts.demKey : undefined,
      }));
      last = m.index + m[0].length;
    }
    if (last < text.length) root.appendChild(document.createTextNode(text.slice(last)));
    if (!root.childNodes.length) {
      // Empty — le placeholder CSS prend le relais via :empty
    }
  }

  // Helper utilisé par le drag-drop : reconstruit dem.text/refs depuis le DOM
  // d'une .demande-text donnée.
  function syncDemandeFromTextEl(textEl, dem) {
    const oldRefs = dem.refs || [];
    const newRefs = [];
    let txt = '';
    for (const node of textEl.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) txt += node.textContent;
      else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList && node.classList.contains('ref-chip')) {
          const oldIdx = Number(node.dataset.ref);
          const ref = oldRefs[oldIdx];
          if (ref) {
            newRefs.push(ref);
            txt += `{{ref:${newRefs.length - 1}}}`;
            node.dataset.ref = String(newRefs.length - 1);
          }
        } else if (node.tagName === 'BR') txt += '\n';
        else txt += node.textContent;
      }
    }
    dem.text = txt.replace(/\s+/g, ' ').trim();
    dem.refs = newRefs;
  }

  // Insère du texte à la position du curseur dans un container contenteditable.
  // Si le curseur n'y est pas, append à la fin. Toujours encadré d'espaces si
  // les voisins en manquent (évite que 2 enregistrements vocaux se collent).
  function insertTextAtSelection(container, text) {
    if (!container || !text) return;
    const trimmed = text.replace(/\s+$/, '');
    if (!trimmed) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && container.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      // Espace avant si le caractère précédent n'est pas un séparateur
      const prevChar = getCharBeforeRange(range);
      const needLead = prevChar && !/\s/.test(prevChar);
      const nextChar = getCharAfterRange(range);
      const needTrail = !nextChar || !/\s/.test(nextChar);
      const finalText = (needLead ? ' ' : '') + trimmed + (needTrail ? ' ' : '');
      range.deleteContents();
      const node = document.createTextNode(finalText);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    // Fallback : append à la fin avec séparation propre
    appendWithSpace(container, trimmed);
  }

  // Append du texte à la fin d'un container contenteditable, en garantissant
  // un séparateur d'espace propre des deux côtés.
  function appendWithSpace(container, text) {
    if (!container || !text) return;
    const trimmed = text.replace(/^\s+|\s+$/g, '');
    if (!trimmed) return;
    const last = container.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) {
      const prevEnd = last.textContent.slice(-1);
      const needLead = prevEnd && !/\s/.test(prevEnd);
      last.textContent += (needLead ? ' ' : '') + trimmed + ' ';
    } else if (last && last.nodeType === Node.ELEMENT_NODE) {
      container.appendChild(document.createTextNode(' ' + trimmed + ' '));
    } else {
      container.appendChild(document.createTextNode(trimmed + ' '));
    }
  }

  function getCharBeforeRange(range) {
    try {
      const r = range.cloneRange();
      r.collapse(true);
      r.setStart(range.startContainer, Math.max(0, range.startOffset - 1));
      return r.toString();
    } catch (_) { return ''; }
  }
  function getCharAfterRange(range) {
    try {
      const r = range.cloneRange();
      r.collapse(false);
      const node = r.endContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const offset = r.endOffset;
        return node.textContent.slice(offset, offset + 1);
      }
    } catch (_) {}
    return '';
  }

  // Point d'entrée unique pour le bouton "Modifier" des tooltips de chip.
  // demKey : 'current' (demande en cours) ou index numérique d'une demande finalisée.
  async function editRef(demKey, refIndex, editType) {
    const target = demKey === 'current' ? STATE.currentDemande : STATE.demandes[demKey];
    if (!target || !target.refs || !target.refs[refIndex]) return;
    const ref = target.refs[refIndex];

    if (editType === 'screenshot' || ref.type === 'screenshot') {
      // Re-annotation : ouvre l'annotateur sur le dataUrl actuel.
      if (!ref.dataUrl) { setStatus('Capture indisponible (cache local).', 'error'); return; }
      setStatus("Annotateur ouvert dans l'onglet actif…", 'info');
      const resp = await sendBg({ type: 'biaif:annotate', dataUrl: ref.dataUrl });
      if (!resp) { setStatus('Annotation KO : pas de réponse', 'error'); return; }
      if (resp.cancelled) { setStatus('Annotation annulée.', 'info'); return; }
      if (resp.error || !resp.dataUrl) {
        setStatusError('Annotation KO : ' + decodeContentScriptError(resp.error || 'no result'),
          isReloadableError(resp.error || '') ? 'reload-active-tab' : null);
        return;
      }
      ref.dataUrl = resp.dataUrl;
      if (demKey === 'current') renderDemandeEditor();
      else renderSegments();
      persist();
      setStatus(`Référence #${refIndex + 1} : annotation enregistrée.`, 'success');
      return;
    }

    // Élément : on arme le mode "remplacement" et on active le picker.
    STATE.replacingRef = { demKey, refIndex };
    const resp = await sendBg({ type: 'biaif:picker-enable' });
    if (resp && resp.error) {
      STATE.replacingRef = null;
      setStatusError('Picker KO : ' + decodeContentScriptError(resp.error),
        isReloadableError(resp.error) ? 'reload-active-tab' : null);
      return;
    }
    setStatus(`Cliquez un élément pour remplacer la référence #${refIndex + 1}…`, 'info');
  }

  async function annotateDemandeRef(demIndex, refIndex) {
    const dem = STATE.demandes[demIndex];
    if (!dem) return;
    const ref = (dem.refs || [])[refIndex];
    if (!ref || ref.type !== 'screenshot' || !ref.dataUrl) return;
    setStatus("Annotateur ouvert dans l'onglet actif…", 'info');
    const resp = await sendBg({ type: 'biaif:annotate', dataUrl: ref.dataUrl });
    if (!resp) { setStatus('Annotation KO : pas de réponse', 'error'); return; }
    if (resp.cancelled) { setStatus('Annotation annulée.', 'info'); return; }
    if (resp.error || !resp.dataUrl) {
      setStatusError('Annotation KO : ' + decodeContentScriptError(resp.error || 'no result'),
        isReloadableError(resp.error || '') ? 'reload-active-tab' : null);
      return;
    }
    ref.dataUrl = resp.dataUrl;
    renderSegments();
    persist();
    setStatus(`Demande #${demIndex + 1} ref #${refIndex + 1} : annotation enregistrée.`, 'success');
  }

  // ============================================================
  // MANUAL SCREENSHOT TOOLS
  // ============================================================

  async function runShotMode(mode) {
    setStatus('Capture (' + mode + ')…', 'info');
    const resp = await sendBg({ type: 'biaif:capture-mode', mode });
    if (!resp || resp.error || !resp.dataUrl) {
      const reason = resp ? resp.error || 'pas de dataUrl' : 'pas de réponse';
      setStatusError('Capture KO : ' + decodeContentScriptError(reason),
        isReloadableError(reason) ? 'reload-active-tab' : null);
      return;
    }
    STATE.lastShot = resp.dataUrl;
    STATE.lastShotMode = mode;
    const ref = {
      type: 'screenshot',
      mode,
      dataUrl: resp.dataUrl,
      ts: Date.now(),
    };
    const tIdx = activeTargetIdx();
    addRefToTarget(ref);
    setStatus(typeof tIdx === 'number'
      ? `Capture ${mode} ajoutée à la demande #${tIdx + 1}`
      : `Capture ${mode} OK — ajoutée comme référence`, 'success');
    // Reset modalTarget (l'éditingDemandeIdx reste pour permettre d'autres
    // captures successives dans le même segment édité)
    STATE.modalTarget = 'current';
  }

  function renderShotPreview() { /* no-op : preview-block supprimé */ }

  async function copyLastShot() {
    if (!STATE.lastShot) return;
    try {
      const blob = await dataUrlToBlob(STATE.lastShot);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setStatus('Capture copiée dans le presse-papiers.', 'success');
    } catch (e) {
      setStatus('Copie image impossible : ' + e.message, 'error');
    }
  }

  async function downloadLastShot() {
    if (!STATE.lastShot) return;
    const blob = await dataUrlToBlob(STATE.lastShot);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadFile(`biaif-${STATE.lastShotMode || 'shot'}-${ts}.png`, blob);
  }

  function attachLastShotAsSegment() {
    // Obsolète : la capture est désormais auto-insérée comme ref de la
    // demande courante via runShotMode. Conservé en no-op pour rétro-compat.
    return;
  }

  // ============================================================
  // ANNOTATOR
  // ============================================================

  async function annotateLastShot() {
    if (!STATE.lastShot) return;
    setStatus("Annotateur ouvert dans l'onglet actif…", 'info');
    const resp = await sendBg({ type: 'biaif:annotate', dataUrl: STATE.lastShot });
    if (!resp) { setStatus('Annotation KO : pas de réponse', 'error'); return; }
    if (resp.cancelled) { setStatus('Annotation annulée.', 'info'); return; }
    if (resp.error || !resp.dataUrl) {
      setStatusError('Annotation KO : ' + decodeContentScriptError(resp.error || 'no result'),
        isReloadableError(resp.error || '') ? 'reload-active-tab' : null);
      return;
    }
    STATE.lastShot = resp.dataUrl;
    renderShotPreview();
    setStatus('Annotation enregistrée.', 'success');
  }

  async function annotateSegment(index) {
    // Obsolète : remplacé par annotateDemandeRef(demIdx, refIdx).
    return;
    /* eslint-disable no-unreachable */
    const seg = null;
    if (!seg || !seg.screenshot) return;
    setStatus("Annotateur ouvert dans l'onglet actif…", 'info');
    const resp = await sendBg({ type: 'biaif:annotate', dataUrl: seg.screenshot });
    if (!resp) { setStatus('Annotation KO : pas de réponse', 'error'); return; }
    if (resp.cancelled) { setStatus('Annotation annulée.', 'info'); return; }
    if (resp.error || !resp.dataUrl) {
      setStatusError('Annotation KO : ' + decodeContentScriptError(resp.error || 'no result'),
        isReloadableError(resp.error || '') ? 'reload-active-tab' : null);
      return;
    }
    seg.screenshot = resp.dataUrl;
    renderSegments();
    persist();
    setStatus(`Segment ${seg.id} : annotation enregistrée.`, 'success');
  }

  // ============================================================
  // PROMPT BUILD / COPY / DOWNLOAD
  // ============================================================

  // Rend le texte d'une demande en "phrase humaine" : remplace {{ref:N}}
  // par "[ref #N+1 — élément/capture]" ou un libellé court (selector / mode).
  function renderInlineHuman(text, refs) {
    return (text || '').replace(/\{\{ref:(\d+)\}\}/g, (_, n) => {
      const i = Number(n);
      const r = refs[i];
      if (!r) return `[ref #${i + 1}]`;
      if (r.type === 'screenshot') return `[#${i + 1} capture${r.mode ? ' ' + r.mode : ''}]`;
      if (r.type === 'error')      return `[#${i + 1} erreur: ${(r.msg || '').slice(0, 80)}]`;
      const lbl = r.selector || r.tag || '?';
      return `[#${i + 1} ${lbl}]`;
    }).replace(/\s+/g, ' ').trim();
  }

  function buildPrompt({ inlineImages = false } = {}) {
    const lines = [];
    lines.push('# Demandes utilisateur');
    lines.push('');
    lines.push("> Chaque demande est une instruction unique exprimée en langage naturel, avec des références numérotées `[#N]` insérées inline. Les références sont détaillées en dessous (élément cliqué ou capture d'écran).");
    lines.push('');

    if (!STATE.demandes.length) {
      lines.push('_Aucune demande._');
      return lines.join('\n');
    }

    STATE.demandes.forEach((dem, di) => {
      const num = di + 1;
      lines.push(`## Demande #${num}`);
      lines.push('');
      lines.push('**Instruction :**');
      lines.push('');
      lines.push('> ' + renderInlineHuman(dem.text, dem.refs || []));
      lines.push('');
      if ((dem.refs || []).length) {
        lines.push('**Références :**');
        lines.push('');
        dem.refs.forEach((r, i) => {
          const refNum = i + 1;
          if (r.type === 'screenshot') {
            const fileName = `dem${num}-ref${refNum}.png`;
            lines.push(`- **#${refNum} — capture (${r.mode || 'visible'})**`);
            if (inlineImages && r.dataUrl) lines.push(`  ![capture #${refNum}](${r.dataUrl})`);
            else                            lines.push(`  📷 Voir \`${fileName}\` (à joindre avec ce prompt).`);
          } else if (r.type === 'error') {
            lines.push(`- **#${refNum} — erreur JavaScript**`);
            if (r.msg)  lines.push(`  - message : ${r.msg}`);
            if (r.file) lines.push(`  - fichier : \`${r.file}:${r.line || '?'}${r.col ? ':' + r.col : ''}\``);
            if (r.url)  lines.push(`  - page : ${r.url}`);
            if (r.stack) {
              const fence = pickFence(r.stack);
              lines.push('');
              lines.push('  ' + fence);
              r.stack.split('\n').forEach((ln) => lines.push('  ' + ln));
              lines.push('  ' + fence);
            }
          } else {
            lines.push(`- **#${refNum} — élément**`);
            if (r.selector)         lines.push(`  - sélecteur : \`${r.selector}\``);
            if (r.tag)              lines.push(`  - tag : \`<${r.tag}>\``);
            if (r.id)               lines.push(`  - id : \`${r.id}\``);
            if (r.classes?.length)  lines.push(`  - classes : \`${r.classes.join(' ')}\``);
            if (r.text)             lines.push(`  - texte : « ${r.text} »`);
            if (r.outerHTML) {
              const fence = pickFence(r.outerHTML);
              lines.push('');
              lines.push('  ' + fence + 'html');
              r.outerHTML.split('\n').forEach((ln) => lines.push('  ' + ln));
              lines.push('  ' + fence);
            }
          }
        });
        lines.push('');
      }
    });

    lines.push('---');
    lines.push('Pour chaque demande, propose un plan groupé puis applique. Si plusieurs demandes touchent les mêmes fichiers/composants, déduplique.');
    return lines.join('\n');
  }

  async function copyPrompt() {
    const text = buildPrompt({ inlineImages: false });
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Prompt copié — collez dans Claude Code et drag-droppez les screenshots.', 'success');
    } catch (e) {
      setStatus('Copie impossible : ' + e.message, 'error');
    }
  }

  async function downloadBundle() {
    if (!STATE.demandes.length) {
      setStatus('Rien à télécharger.', 'info');
      return;
    }
    const text = buildPrompt({ inlineImages: false });
    downloadFile('biaif-prompt.md', new Blob([text], { type: 'text/markdown' }));
    let imgCount = 0;
    for (let di = 0; di < STATE.demandes.length; di++) {
      const dem = STATE.demandes[di];
      const refs = dem.refs || [];
      for (let ri = 0; ri < refs.length; ri++) {
        const r = refs[ri];
        if (r.type !== 'screenshot' || !r.dataUrl) continue;
        const blob = await dataUrlToBlob(r.dataUrl);
        downloadFile(`dem${di + 1}-ref${ri + 1}.png`, blob);
        imgCount++;
      }
    }
    setStatus(`Prompt + ${imgCount} capture(s) téléchargés.`, 'success');
  }

  function downloadFile(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ============================================================
  // RESET / STATUS
  // ============================================================

  function clearAll() {
    if (!confirm('Effacer la session ? (Toutes les demandes finalisées et la demande en cours seront perdues)')) return;
    if (STATE.editingDemandeIdx !== null) exitEditMode({ silent: true });
    STATE.demandes = [];
    STATE.currentDemande = { text: '', refs: [], pageUrl: null };
    STATE.currentInterim = '';
    STATE.lastShot = null;
    STATE.lastShotMode = null;
    if (REFS.demandeEditor) REFS.demandeEditor.innerHTML = '';
    if (REFS.interim) REFS.interim.textContent = '';
    MIC.finalTranscript = '';
    renderDemandeRefsStrip();
    renderSegments();
    updateArmedUi();
    persist();
    setStatus('Tout effacé.', 'info');
  }

  function setStatus(msg, kind) {
    if (!REFS.status) return;
    REFS.status.textContent = msg || '';
    REFS.status.dataset.kind = kind || 'info';
    delete REFS.status.dataset.action;
    REFS.status.style.cursor = '';
    REFS.status.title = '';
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    if (msg && (kind === 'success' || kind === 'info')) {
      statusTimer = setTimeout(() => {
        if (REFS.status && REFS.status.textContent === msg) REFS.status.textContent = '';
      }, 5000);
    }
  }

  function setStatusError(msg, action) {
    setStatus(msg, 'error');
    if (action) {
      REFS.status.dataset.action = action;
      REFS.status.style.cursor = 'pointer';
      REFS.status.title =
        action === 'open-mic-settings' ? 'Cliquer pour ouvrir la page de permissions micro de BIAIF' :
        action === 'reload-active-tab' ? "Cliquer pour recharger l'onglet actif" :
        '';
      if (action === 'reload-active-tab') showReloadModal();
    }
  }

  // ============================================================
  // HELPERS
  // ============================================================

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Renvoie une version courte d'une URL pour l'affichage (host + chemin
  // tronqué). Conserve l'URL complète en title pour le hover.
  function formatPageUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      const host = u.host;
      let path = u.pathname || '';
      const search = u.search || '';
      const full = host + path + (search.length > 30 ? search.slice(0, 30) + '…' : search);
      return full.length > 60 ? full.slice(0, 60) + '…' : full;
    } catch (_) {
      return url.length > 60 ? url.slice(0, 60) + '…' : url;
    }
  }

  function pickFence(s) {
    const runs = String(s).match(/`+/g) || [];
    let max = 0;
    for (const r of runs) if (r.length > max) max = r.length;
    return '`'.repeat(Math.max(3, max + 1));
  }

  function dataUrlToBlob(dataUrl) {
    return fetch(dataUrl).then((r) => r.blob());
  }

  function getSize(dataUrl) {
    const base64 = (dataUrl.split(',')[1] || '');
    return Math.round((base64.length * 3) / 4);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function voiceErrorFr(code) {
    switch (code) {
      case 'denied-extension':
      case 'not-allowed':
      case 'service-not-allowed':
        return "micro bloqué pour BIAIF — clique ici pour ouvrir la page de permissions de l'extension, puis Microphone → Autoriser";
      case 'no-speech':              return 'rien entendu';
      case 'audio-capture':          return 'aucun micro détecté';
      case 'network':                return 'erreur réseau';
      case 'aborted':                return 'reconnaissance interrompue';
      case 'language-not-supported': return 'langue non supportée';
      case 'bad-grammar':             return 'grammaire invalide';
      case 'auto-restart-failed':    return 'session coupée par le navigateur — recliquez sur le micro';
      case 'no-media-devices':       return 'API media non disponible';
      case 'not-supported':          return 'reconnaissance vocale non supportée par le navigateur';
      case 'init-failed':            return 'initialisation impossible';
      case 'start-failed':           return 'impossible de démarrer le micro';
      default:                       return code || 'erreur inconnue';
    }
  }
})();
