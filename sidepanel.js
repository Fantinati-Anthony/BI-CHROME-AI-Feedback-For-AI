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
    currentDemande: { text: '', refs: [] },
    demandes: [],
    lastShot: null,
    lastShotMode: null,
    sortOrder: 'desc',
    lang: 'fr-FR',
    micDeviceId: '',
    // Mode "remplacement" : si non-null, le prochain pick d'élément
    // remplace la ref ciblée au lieu d'en créer une nouvelle.
    // { demKey: 'current' | <number>, refIndex: <number> }
    replacingRef: null,
  };

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
    if (chrome?.tabs?.onActivated) {
      chrome.tabs.onActivated.addListener(() => checkActiveTabReady());
    }
    if (chrome?.tabs?.onUpdated) {
      chrome.tabs.onUpdated.addListener((_id, info, tab) => {
        if (info.status === 'complete' && tab && tab.active) checkActiveTabReady();
      });
    }
  });

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

    // Shot tools
    REFS.shotButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        runShotMode(btn.dataset.shot);
        closeCaptureMenu();
      });
    });

    // Capture dropdown toggle
    const captureToggle = document.querySelector('[data-act="capture-toggle"]');
    const captureMenu = document.querySelector('.capture-submenu');
    if (captureToggle && captureMenu) {
      captureToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !captureMenu.hasAttribute('hidden');
        if (open) closeCaptureMenu();
        else openCaptureMenu();
      });
      document.addEventListener('click', (e) => {
        if (captureMenu.hasAttribute('hidden')) return;
        if (!e.target.closest('.tool-capture-wrap')) closeCaptureMenu();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeCaptureMenu();
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

    // Délégation : "Modifier" dans le tooltip d'un chip de ref.
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.ref-tooltip-btn');
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

  function openCaptureMenu() {
    const toggle = document.querySelector('[data-act="capture-toggle"]');
    const menu = document.querySelector('.capture-submenu');
    if (!toggle || !menu) return;
    menu.removeAttribute('hidden');
    toggle.setAttribute('aria-expanded', 'true');
  }
  function closeCaptureMenu() {
    const toggle = document.querySelector('[data-act="capture-toggle"]');
    const menu = document.querySelector('.capture-submenu');
    if (!toggle || !menu) return;
    menu.setAttribute('hidden', '');
    toggle.setAttribute('aria-expanded', 'false');
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
        };
      }
      if (typeof saved.lang === 'string') {
        STATE.lang = saved.lang;
        if (REFS.langSelect) REFS.langSelect.value = saved.lang;
      }
      if (typeof saved.micDeviceId === 'string') STATE.micDeviceId = saved.micDeviceId;
      if (saved.sortOrder === 'asc' || saved.sortOrder === 'desc') STATE.sortOrder = saved.sortOrder;
      updateSortToggleLabel();
      renderDemandeEditor();
      renderSegments();
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
    appendVoiceToEditor(text);
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
    STATE.armed = true;
    if (REFS.masterBtn) {
      REFS.masterBtn.classList.add('armed');
      const lbl = REFS.masterBtn.querySelector('.master-label');
      if (lbl) lbl.textContent = 'Suivant';
    }
    if (REFS.stopBtn) REFS.stopBtn.hidden = false;
    if (REFS.sessionInfo) REFS.sessionInfo.textContent = 'Session active — parlez puis cliquez les éléments';
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
    setStatus(`Session arrêtée — ${STATE.demandes.length} demande(s) capturée(s).`, 'info');
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

    // Cas normal : nouvelle ref dans la demande en cours.
    STATE.currentDemande.refs.push(ref);
    const absIdx = STATE.currentDemande.refs.length - 1;
    appendChipToEditor(absIdx, ref);
    setStatus(`Référence #${absIdx + 1} ajoutée : ${shortLabel(descriptor)}`, 'success');
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
  // Crée le DOM d'un chip de référence + tooltip rich au survol.
  // opts : { readOnly?, displayNum?, demKey? }
  //   demKey === 'current' → ref de la demande en cours (currentDemande.refs)
  //   demKey === <number>   → ref d'une demande finalisée STATE.demandes[demKey].refs
  function makeChipElement(absIdx, ref, opts) {
    opts = opts || {};
    const span = document.createElement('span');
    span.className = 'ref-chip ref-chip--' + (ref?.type || 'element');
    if (opts.readOnly) span.classList.add('ref-chip-readonly');
    span.contentEditable = 'false';
    span.dataset.ref = String(absIdx);
    if (opts.demKey !== undefined) span.dataset.demKey = String(opts.demKey);

    const isShot = ref?.type === 'screenshot';
    const icon = isShot
      ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>';
    const labelKind = isShot ? 'capture' : 'élément';
    const num = opts.displayNum || (absIdx + 1);
    const labelHtml = `${icon}<span class="ref-chip-label">${labelKind} #${num}</span>`;

    // Tooltip rich (rendu hover ou focus-within)
    const tip = document.createElement('span');
    tip.className = 'ref-tooltip';
    tip.contentEditable = 'false';
    if (isShot) {
      const img = document.createElement('img');
      img.className = 'ref-tooltip-img';
      img.src = ref.dataUrl || '';
      img.alt = 'capture #' + num;
      tip.appendChild(img);
      const meta = document.createElement('div');
      meta.className = 'ref-tooltip-meta';
      meta.textContent = `Mode : ${ref.mode || 'visible'}`;
      tip.appendChild(meta);
      const btn = document.createElement('button');
      btn.className = 'ref-tooltip-btn';
      btn.type = 'button';
      btn.dataset.editType = 'screenshot';
      btn.textContent = '✏ Re-annoter';
      tip.appendChild(btn);
    } else {
      const meta = document.createElement('div');
      meta.className = 'ref-tooltip-meta';
      const lines = [];
      if (ref?.tag)             lines.push(`<span class="t-key">tag</span> &lt;${escapeHtml(ref.tag)}&gt;`);
      if (ref?.id)              lines.push(`<span class="t-key">id</span> #${escapeHtml(ref.id)}`);
      if (ref?.classes?.length) lines.push(`<span class="t-key">classes</span> ${escapeHtml(ref.classes.join(' '))}`);
      if (ref?.text)            lines.push(`<span class="t-key">texte</span> « ${escapeHtml(ref.text.slice(0, 80))}${ref.text.length > 80 ? '…' : ''} »`);
      meta.innerHTML = lines.join('<br>') || '<em>Pas de détails</em>';
      tip.appendChild(meta);
      if (ref?.selector) {
        const sel = document.createElement('div');
        sel.className = 'ref-tooltip-selector';
        sel.innerHTML = '<code>' + escapeHtml(ref.selector) + '</code>';
        tip.appendChild(sel);
      }
      const btn = document.createElement('button');
      btn.className = 'ref-tooltip-btn';
      btn.type = 'button';
      btn.dataset.editType = 'element';
      btn.textContent = '⌖ Re-piquer';
      tip.appendChild(btn);
    }

    span.innerHTML = labelHtml;
    span.appendChild(tip);
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

  // Append du texte voix à la fin de l'éditeur (fusionne avec le dernier
  // text node si possible, ajoute un espace de transition).
  function appendVoiceToEditor(text) {
    const ed = REFS.demandeEditor;
    if (!ed || !text) return;
    const last = ed.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) {
      last.textContent += (last.textContent && !/\s$/.test(last.textContent) ? ' ' : '') + text;
    } else if (last && last.nodeType === Node.ELEMENT_NODE) {
      ed.appendChild(document.createTextNode(' ' + text));
    } else {
      ed.appendChild(document.createTextNode(text));
    }
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
    };
    STATE.demandes.push(demande);
    STATE.currentDemande = { text: '', refs: [] };
    if (REFS.demandeEditor) REFS.demandeEditor.innerHTML = '';
    renderDemandeRefsStrip();
    renderSegments();
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
      card.innerHTML = `
        <header>
          <span class="seg-num">#${num}</span>
          <span class="seg-meta">${dt} · ${refsCount} réf${refsCount > 1 ? 's' : ''}</span>
          <button class="seg-del" data-i="${origIndex}" title="Supprimer">×</button>
        </header>
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
    // Mad-Libs : la capture devient une nouvelle référence, et un chip est
    // inséré inline dans la demande en cours.
    const ref = {
      type: 'screenshot',
      mode,
      dataUrl: resp.dataUrl,
      ts: Date.now(),
    };
    STATE.currentDemande.refs.push(ref);
    const absIdx = STATE.currentDemande.refs.length - 1;
    appendChipToEditor(absIdx, ref);
    setStatus(`Capture ${mode} OK — ajoutée comme référence #${absIdx + 1}`, 'success');
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
    STATE.demandes = [];
    STATE.currentDemande = { text: '', refs: [] };
    STATE.currentInterim = '';
    STATE.lastShot = null;
    STATE.lastShotMode = null;
    if (REFS.demandeEditor) REFS.demandeEditor.innerHTML = '';
    if (REFS.interim) REFS.interim.textContent = '';
    MIC.finalTranscript = '';
    renderDemandeRefsStrip();
    renderSegments();
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
