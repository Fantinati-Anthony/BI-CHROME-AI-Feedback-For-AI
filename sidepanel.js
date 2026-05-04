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
    currentVoiceBuffer: '',  // texte FINAL accumulé depuis le dernier clic
    currentInterim: '',      // texte INTERIM en cours (flushé au clic ou au final suivant)
    pendingIntents: new Set(),
    segments: [],          // [{ id, voice, intents, element, screenshot, ts, metadata }]
    lastShot: null,        // dernier screenshot manuel
    lastShotMode: null,
    lang: 'fr-FR',
    micDeviceId: '',       // '' = système par défaut (Web Speech API utilise le défaut système)
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
  });

  function cacheRefs() {
    REFS.masterBtn   = document.querySelector('[data-act="master"]');
    REFS.pickerBtn   = document.querySelector('[data-act="picker"]');
    REFS.micBtn      = document.querySelector('[data-act="mic"]');
    REFS.clearBtn    = document.querySelector('[data-act="clear"]');
    REFS.copyBtn     = document.querySelector('[data-act="copy"]');
    REFS.downloadBtn = document.querySelector('[data-act="download"]');
    REFS.textarea    = document.querySelector('textarea[name="notes"]');
    REFS.interim     = document.querySelector('.biaif-interim');
    REFS.segments    = document.querySelector('.biaif-segments');
    REFS.empty       = document.querySelector('.biaif-empty');
    REFS.status      = document.querySelector('.biaif-status');
    REFS.timer       = document.querySelector('.biaif-timer');
    REFS.langSelect  = document.querySelector('select[name="lang"]');
    REFS.sessionInfo = document.querySelector('.biaif-session-info');
    REFS.bufferPreview = document.querySelector('.biaif-buffer-preview');
    REFS.nextBtn       = document.querySelector('[data-act="next"]');
    // Shot tools
    REFS.shotButtons = document.querySelectorAll('[data-shot]');
    REFS.shotPreview = document.querySelector('.biaif-shot-preview');
    REFS.shotInfo    = document.querySelector('.biaif-shot-info');
    REFS.shotCopy    = document.querySelector('[data-act="shot-copy"]');
    REFS.shotSave    = document.querySelector('[data-act="shot-save"]');
    REFS.shotAttach  = document.querySelector('[data-act="shot-attach"]');
    REFS.shotAnnotate= document.querySelector('[data-act="shot-annotate"]');
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
    if (REFS.masterBtn) REFS.masterBtn.addEventListener('click',   () => toggleSession());
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
    if (REFS.shotCopy)     REFS.shotCopy.addEventListener('click',     () => copyLastShot());
    if (REFS.shotSave)     REFS.shotSave.addEventListener('click',     () => downloadLastShot());
    if (REFS.shotAttach)   REFS.shotAttach.addEventListener('click',   () => attachLastShotAsSegment());
    if (REFS.shotAnnotate) REFS.shotAnnotate.addEventListener('click', () => annotateLastShot());

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
      if (Array.isArray(saved.segments)) STATE.segments = saved.segments;
      if (typeof saved.lang === 'string') {
        STATE.lang = saved.lang;
        if (REFS.langSelect) REFS.langSelect.value = saved.lang;
      }
      if (typeof saved.micDeviceId === 'string') STATE.micDeviceId = saved.micDeviceId;
      if (typeof saved.notes === 'string' && REFS.textarea) REFS.textarea.value = saved.notes;
      renderSegments();
    } catch (e) {
      console.warn('[BIAIF] hydrate failed', e?.message || e);
    }
  }

  function persist() {
    const payload = {
      segments: STATE.segments,
      lang: STATE.lang,
      micDeviceId: STATE.micDeviceId,
      notes: REFS.textarea ? REFS.textarea.value : '',
    };
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: payload }).catch(() => {
        const slim = {
          ...payload,
          segments: payload.segments.map((s) => ({ ...s, screenshot: null })),
        };
        chrome.storage.local.set({ [STORAGE_KEY]: slim }).catch(() => {});
      });
    } catch (_) {}
  }

  let notesTimer = null;
  document.addEventListener('input', (e) => {
    if (e.target && e.target === REFS.textarea) {
      if (notesTimer) clearTimeout(notesTimer);
      notesTimer = setTimeout(persist, 600);
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
    REFS.micBtn.classList.toggle('active', active);
    REFS.micBtn.querySelector('.label').textContent = active
      ? 'Micro actif'
      : 'Démarrer le micro';
    if (!active) REFS.interim.textContent = '';
  }

  function onVoiceInterim(text) {
    STATE.currentInterim = text || '';
    REFS.interim.textContent = text || '';
    updateBufferPreview();
  }

  function onVoiceTranscript(text) {
    if (!text) return;
    STATE.currentVoiceBuffer += (STATE.currentVoiceBuffer ? ' ' : '') + text;
    STATE.currentInterim = ''; // le final remplace l'interim
    const intents = window.BIAIFIntentParser ? window.BIAIFIntentParser.detect(text) : [];
    intents.forEach((i) => STATE.pendingIntents.add(i));
    insertAtCursor(text + ' ');
    updateBufferPreview();
    persist();
  }

  /**
   * Met à jour le « buffer preview » qui montre à l'utilisateur ce qui
   * sera attaché au prochain élément cliqué : texte final accumulé +
   * texte interim en cours.
   */
  function updateBufferPreview() {
    if (!REFS.bufferPreview) return;
    const buf = STATE.currentVoiceBuffer.trim();
    const interim = STATE.currentInterim.trim();
    const preview = [buf, interim].filter(Boolean).join(' ');
    REFS.bufferPreview.textContent = preview;
    REFS.bufferPreview.classList.toggle('armed', !!preview && STATE.armed);
  }

  function onVoiceError(code) {
    const isPermDenied = code === 'not-allowed' || code === 'service-not-allowed' || code === 'denied-extension';
    setStatusError('Micro : ' + voiceErrorFr(code), isPermDenied ? 'open-mic-settings' : null);
  }

  function insertAtCursor(text) {
    const ta = REFS.textarea;
    if (!ta) return;
    const start = ta.selectionStart ?? ta.value.length;
    const end   = ta.selectionEnd   ?? ta.value.length;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    const pos = start + text.length;
    ta.selectionStart = ta.selectionEnd = pos;
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
    REFS.masterBtn.classList.add('armed');
    REFS.masterBtn.querySelector('.master-label').textContent = 'STOP';
    REFS.sessionInfo.textContent = 'Session active — parlez puis cliquez les éléments';
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
    REFS.masterBtn.classList.remove('armed');
    REFS.masterBtn.querySelector('.master-label').textContent = 'START';
    REFS.sessionInfo.textContent = 'Session arrêtée';
    stopTimer();
    if (STATE.pickerActive) sendBg({ type: 'biaif:picker-disable' });
    if (STATE.micActive)    stopMic();
    updateBufferPreview();
    setStatus(`Session arrêtée — ${STATE.segments.length} segment(s) capturé(s).`, 'info');
  }

  function startTimer() {
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
    REFS.timer.textContent = '00:00';
  }

  // ============================================================
  // PICKER + SEGMENTS
  // ============================================================

  function onPickerState(active) {
    STATE.pickerActive = active;
    REFS.pickerBtn.classList.toggle('active', active);
    REFS.pickerBtn.querySelector('.label').textContent = active
      ? 'Picker actif (Esc)'
      : "Sélecteur d'élément";
  }

  function onElementPicked(msg) {
    const descriptor = msg.descriptor || { selector: '?', tag: null, id: null, classes: [], text: null, outerHTML: null };
    const voiceParts = [STATE.currentVoiceBuffer.trim(), STATE.currentInterim.trim()].filter(Boolean);
    const voice = voiceParts.join(' ').replace(/\s+/g, ' ').trim();
    if (STATE.currentInterim && window.BIAIFIntentParser) {
      window.BIAIFIntentParser.detect(STATE.currentInterim).forEach((i) => STATE.pendingIntents.add(i));
    }
    const segment = {
      id: 'seg-' + (STATE.segments.length + 1),
      ts: Date.now(),
      intents: Array.from(STATE.pendingIntents),
      voice,
      element: descriptor,
      screenshot: msg.screenshot || null,
      metadata: msg.metadata || null,
    };
    STATE.segments.push(segment);
    STATE.currentVoiceBuffer = '';
    STATE.currentInterim = '';
    STATE.pendingIntents.clear();
    renderSegments();
    updateBufferPreview();
    persist();
    setStatus(
      `Segment ${segment.id} : ${shortLabel(descriptor)}` +
        (segment.intents.length ? ' — ' + segment.intents.map((i) => '#' + i).join(' ') : ''),
      'success'
    );
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
  function nextVoiceSegment() {
    const voiceParts = [STATE.currentVoiceBuffer.trim(), STATE.currentInterim.trim()].filter(Boolean);
    const voice = voiceParts.join(' ').replace(/\s+/g, ' ').trim();
    if (!voice) {
      setStatus('Rien à attacher — parle puis clique Suivant.', 'info');
      return;
    }
    if (STATE.currentInterim && window.BIAIFIntentParser) {
      window.BIAIFIntentParser.detect(STATE.currentInterim).forEach((i) => STATE.pendingIntents.add(i));
    }
    const segment = {
      id: 'seg-' + (STATE.segments.length + 1),
      ts: Date.now(),
      intents: Array.from(STATE.pendingIntents),
      voice,
      element: { selector: '(voix seule)', tag: null, id: null, classes: [], text: null, outerHTML: null },
      screenshot: null,
      metadata: null,
    };
    STATE.segments.push(segment);
    STATE.currentVoiceBuffer = '';
    STATE.currentInterim = '';
    STATE.pendingIntents.clear();
    renderSegments();
    updateBufferPreview();
    persist();
    setStatus(`Segment ${segment.id} : voix seule`, 'success');
  }

  function renderSegments() {
    REFS.segments.innerHTML = '';
    if (!STATE.segments.length) {
      REFS.empty.style.display = '';
      return;
    }
    REFS.empty.style.display = 'none';

    STATE.segments.forEach((seg, i) => {
      const card = document.createElement('article');
      card.className = 'biaif-segment';
      const label = shortLabel(seg.element);
      const fullSel = seg.element.selector || '';
      card.innerHTML = `
        <header>
          <span class="seg-num">#${i + 1}</span>
          <span class="seg-tags">${seg.intents.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</span>
          <button class="seg-del" data-i="${i}" title="Supprimer">×</button>
        </header>
        <div class="seg-selector" title="${escapeHtml(fullSel)}"><code>${escapeHtml(label)}</code></div>
        ${seg.voice ? `<div class="seg-voice">« ${escapeHtml(seg.voice)} »</div>` : ''}
      `;
      if (seg.screenshot) {
        const wrap = document.createElement('div');
        wrap.className = 'seg-thumb-wrap';
        const img = document.createElement('img');
        img.className = 'seg-thumb';
        img.src = seg.screenshot;
        img.alt = 'screenshot ' + (seg.element.selector || '');
        const btn = document.createElement('button');
        btn.className = 'seg-annotate';
        btn.dataset.i = String(i);
        btn.title = 'Annoter cette capture';
        btn.textContent = '✏️';
        btn.addEventListener('click', () => annotateSegment(i));
        wrap.appendChild(img);
        wrap.appendChild(btn);
        card.appendChild(wrap);
      }
      card.querySelector('.seg-del').addEventListener('click', (e) => {
        STATE.segments.splice(Number(e.currentTarget.dataset.i), 1);
        renderSegments();
        persist();
      });
      REFS.segments.appendChild(card);
    });
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
    renderShotPreview();
    setStatus(`Capture ${mode} OK — ${formatSize(getSize(resp.dataUrl))}`, 'success');
  }

  function renderShotPreview() {
    const wrap = REFS.shotPreview;
    if (!wrap) return;
    if (!STATE.lastShot) {
      wrap.innerHTML = '<div class="biaif-shot-empty">Aucune capture pour le moment.</div>';
      if (REFS.shotInfo) REFS.shotInfo.textContent = '';
      [REFS.shotCopy, REFS.shotSave, REFS.shotAttach, REFS.shotAnnotate].forEach((b) => { if (b) b.disabled = true; });
      return;
    }
    wrap.innerHTML = '';
    const img = document.createElement('img');
    img.src = STATE.lastShot;
    img.alt = 'capture ' + (STATE.lastShotMode || '');
    wrap.appendChild(img);
    if (REFS.shotInfo) REFS.shotInfo.textContent = `${STATE.lastShotMode || ''} · ${formatSize(getSize(STATE.lastShot))}`;
    [REFS.shotCopy, REFS.shotSave, REFS.shotAttach, REFS.shotAnnotate].forEach((b) => { if (b) b.disabled = false; });
  }

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
    if (!STATE.lastShot) return;
    const voiceParts = [STATE.currentVoiceBuffer.trim(), STATE.currentInterim.trim()].filter(Boolean);
    const segment = {
      id: 'seg-' + (STATE.segments.length + 1),
      ts: Date.now(),
      intents: [],
      voice: voiceParts.join(' ').replace(/\s+/g, ' ').trim(),
      element: {
        selector: '(capture ' + (STATE.lastShotMode || '') + ')',
        tag: null, id: null, classes: [], text: null, outerHTML: null,
      },
      screenshot: STATE.lastShot,
      metadata: null,
    };
    STATE.segments.push(segment);
    STATE.currentVoiceBuffer = '';
    STATE.currentInterim = '';
    renderSegments();
    updateBufferPreview();
    persist();
    setStatus(`Capture attachée comme ${segment.id}.`, 'success');
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
    const seg = STATE.segments[index];
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

  function buildPrompt({ inlineImages = false } = {}) {
    const notes = REFS.textarea.value.trim();
    const lines = [];
    lines.push('# Demandes de modification batchées');
    lines.push('');

    if (STATE.segments.length) {
      lines.push(`## Segments (${STATE.segments.length})`);
      lines.push('');
      STATE.segments.forEach((seg, i) => {
        lines.push(`### Segment ${i + 1}${seg.intents.length ? ' — ' + seg.intents.map((t) => '#' + t).join(' ') : ''}`);
        lines.push(`- **Sélecteur :** \`${seg.element.selector}\``);
        if (seg.element.tag)             lines.push(`- **Tag :** \`<${seg.element.tag}>\``);
        if (seg.element.id)              lines.push(`- **id :** \`${seg.element.id}\``);
        if (seg.element.classes?.length) lines.push(`- **classes :** \`${seg.element.classes.join(' ')}\``);
        if (seg.element.text)            lines.push(`- **texte :** « ${seg.element.text} »`);
        if (seg.voice) {
          lines.push('');
          lines.push('> ' + seg.voice.replace(/\n/g, '\n> '));
        }
        if (seg.element.outerHTML) {
          lines.push('');
          const fence = pickFence(seg.element.outerHTML);
          lines.push(fence + 'html');
          lines.push(seg.element.outerHTML);
          lines.push(fence);
        }
        if (seg.screenshot) {
          lines.push('');
          if (inlineImages) lines.push(`![${seg.element.selector}](${seg.screenshot})`);
          else              lines.push(`📷 Voir \`${seg.id}.png\` (à dropper avec ce prompt).`);
        }
        lines.push('');
      });
    }

    if (notes) {
      lines.push('## Notes additionnelles');
      lines.push('');
      lines.push(notes);
      lines.push('');
    }

    lines.push('---');
    lines.push('Pour chaque segment, propose un plan groupé puis applique. Déduplique si plusieurs segments touchent le même fichier.');
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
    if (!STATE.segments.length) {
      setStatus('Rien à télécharger.', 'info');
      return;
    }
    const text = buildPrompt({ inlineImages: false });
    downloadFile('biaif-prompt.md', new Blob([text], { type: 'text/markdown' }));
    for (const seg of STATE.segments) {
      if (!seg.screenshot) continue;
      const blob = await dataUrlToBlob(seg.screenshot);
      downloadFile(`${seg.id}.png`, blob);
    }
    setStatus(`${STATE.segments.length + 1} fichiers téléchargés.`, 'success');
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
    if (!confirm('Effacer la session ? (Tous les segments et notes seront perdus)')) return;
    STATE.segments = [];
    STATE.currentVoiceBuffer = '';
    STATE.currentInterim = '';
    STATE.pendingIntents.clear();
    STATE.lastShot = null;
    STATE.lastShotMode = null;
    REFS.textarea.value = '';
    REFS.interim.textContent = '';
    MIC.finalTranscript = '';
    renderSegments();
    renderShotPreview();
    updateBufferPreview();
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
