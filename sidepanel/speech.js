/**
 * BIAIF Speech
 * SpeechRecognition lifecycle, mic test, device enumeration.
 * Runs exclusively in the side panel context (not in any content script).
 */
(function (window) {
  'use strict';

  var STATE, REFS;
  var MIC = { rec: null, finalTranscript: '', lastEventAt: 0 };
  var micTestHandle  = null;
  var srWatchdog     = null;

  function init(state, refs) {
    STATE = state;
    REFS  = refs;
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', function () { refreshMicDevices(false); });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && micTestHandle) stopMicTest();
    });
    refreshMicDevices(false);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------
  function isMicSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  async function ensureMicPermission() {
    try {
      var status = await navigator.permissions.query({ name: 'microphone' });
      if (status.state === 'granted') return { ok: true };
      if (status.state === 'denied')  return { ok: false, reason: 'denied-extension' };
    } catch (_) {}
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      return { ok: false, reason: 'no-media-devices' };
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(function (t) { t.stop(); });
      return { ok: true };
    } catch (e) {
      if (e && e.name === 'NotAllowedError')  return { ok: false, reason: 'denied-extension' };
      if (e && e.name === 'NotFoundError')    return { ok: false, reason: 'audio-capture' };
      if (e && e.name === 'NotReadableError') return { ok: false, reason: 'audio-capture' };
      return { ok: false, reason: 'unknown' };
    }
  }

  async function startMic() {
    if (STATE.micActive) return true;
    if (!isMicSupported()) { _onVoiceError('not-supported'); return false; }
    var perm = await ensureMicPermission();
    if (!perm.ok) { _onVoiceError(perm.reason); return false; }
    if (!_initRec()) { _onVoiceError('init-failed'); return false; }
    try {
      MIC.rec.start();
      STATE.micActive = true;
      _setMicActive(true);
      _startWatchdog();
      refreshMicDevices(false);
      return true;
    } catch (e) {
      _onVoiceError('start-failed');
      return false;
    }
  }

  function stopMic() {
    if (!STATE.micActive) return;
    STATE.micActive = false;
    _stopWatchdog();
    try { MIC.rec && MIC.rec.stop(); } catch (_) {}
  }

  async function toggleMic() {
    if (STATE.micActive) stopMic();
    else await startMic();
  }

  // -----------------------------------------------------------------------
  // Mic test (live audio level meter)
  // -----------------------------------------------------------------------
  async function startMicTest(deviceId) {
    stopMicTest();
    try {
      var constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
      var stream = await navigator.mediaDevices.getUserMedia(constraints);
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      var ctx      = new AudioCtx();
      var source   = ctx.createMediaStreamSource(stream);
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      var data = new Uint8Array(analyser.frequencyBinCount);
      micTestHandle = { stream: stream, ctx: ctx, analyser: analyser, data: data, raf: 0 };
      if (REFS.micMeter)    REFS.micMeter.hidden = false;
      if (REFS.micTestBtn)  REFS.micTestBtn.textContent = _t('mic.test_btn_stop', '⏹ Stop test');
      if (window.BIAIFToast) window.BIAIFToast.show(_t('mic.test_running', 'Test micro en cours — parle pour voir le niveau.'), 'info');

      refreshMicDevices(false);
      (function tick() {
        if (!micTestHandle) return;
        analyser.getByteFrequencyData(data);
        var sum = 0;
        for (var i = 0; i < data.length; i++) sum += data[i];
        var pct = Math.min(100, Math.round((sum / data.length / 96) * 100));
        if (REFS.micMeterBar) REFS.micMeterBar.style.width = pct + '%';
        micTestHandle.raf = requestAnimationFrame(tick);
      })();
    } catch (e) {
      var msg = e && e.name === 'NotAllowedError'  ? 'permission refusée' :
                e && e.name === 'NotFoundError'    ? 'micro introuvable' :
                e && e.name === 'NotReadableError' ? 'micro déjà utilisé' :
                (e && e.message || String(e));
      if (window.BIAIFToast) window.BIAIFToast.show(_t('mic.test_fail', 'Test micro KO : ' + msg, { err: msg }), 'error');
    }
  }

  function stopMicTest() {
    if (!micTestHandle) return;
    cancelAnimationFrame(micTestHandle.raf);
    try { micTestHandle.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
    try { micTestHandle.ctx.close(); } catch (_) {}
    micTestHandle = null;
    if (REFS.micMeter)    REFS.micMeter.hidden = true;
    if (REFS.micMeterBar) REFS.micMeterBar.style.width = '0%';
    if (REFS.micTestBtn)  REFS.micTestBtn.textContent = _t('mic.test_btn_default', '🔊 Tester');
  }

  async function refreshMicDevices(forcePrompt) {
    if (!REFS.micDeviceSelect) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      var alreadyGranted = false;
      try {
        var status = await navigator.permissions.query({ name: 'microphone' });
        alreadyGranted = status.state === 'granted';
      } catch (_) {}
      if (alreadyGranted || forcePrompt) {
        try {
          var temp = await navigator.mediaDevices.getUserMedia({ audio: true });
          temp.getTracks().forEach(function (t) { t.stop(); });
        } catch (_) {}
      }
      var devices = await navigator.mediaDevices.enumerateDevices();
      var inputs  = devices.filter(function (d) { return d.kind === 'audioinput'; });
      var sel      = REFS.micDeviceSelect;
      var previous = STATE.micDeviceId || sel.value || '';
      sel.innerHTML = '';
      var def = document.createElement('option');
      def.value = ''; def.textContent = _t('settings.voice.mic_default', 'Système par défaut');
      sel.appendChild(def);
      inputs.forEach(function (d) {
        var opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || 'Micro (' + (d.deviceId || '').slice(0, 8) + '…)';
        sel.appendChild(opt);
      });
      if ([].some.call(sel.options, function (o) { return o.value === previous; })) sel.value = previous;
    } catch (e) {
      console.warn('[BIAIF Speech] enumerateDevices failed', e && e.message);
    }
  }

  // -----------------------------------------------------------------------
  // Voice output routing
  // -----------------------------------------------------------------------
  function onVoiceInterim(text) {
    STATE.currentInterim = text || '';
    _renderInterimGhost(text || '');
  }

  function onVoiceTranscript(text) {
    if (!text) return;
    STATE.currentInterim = '';
    clearInterimGhost();
    if (typeof STATE.editingDemandeIdx === 'number') {
      _appendVoiceToDemande(STATE.editingDemandeIdx, text);
    } else if (typeof STATE.dictationTarget === 'number') {
      _appendVoiceToDemande(STATE.dictationTarget, text);
    } else {
      _appendVoiceToEditor(text);
    }
  }

  function clearInterimGhost() {
    document.querySelectorAll('.voice-interim-ghost').forEach(function (g) { g.parentNode && g.parentNode.removeChild(g); });
  }

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------
  function _t(key, fallback, vars) {
    if (window.BIAIFi18n && window.BIAIFi18n.t) {
      var v = window.BIAIFi18n.t(key, vars);
      if (v && v !== key) return v;
    }
    return fallback || key;
  }

  function voiceErrorFr(code) {
    switch (code) {
      case 'denied-extension':
      case 'not-allowed':
      case 'service-not-allowed':   return _t('mic.err.denied');
      case 'no-speech':             return _t('mic.err.no_speech', 'rien entendu');
      case 'audio-capture':         return _t('mic.err.audio_capture', 'aucun micro détecté');
      case 'network':               return _t('mic.err.network', 'erreur réseau');
      case 'aborted':               return _t('mic.err.aborted', 'reconnaissance interrompue');
      case 'language-not-supported': return _t('mic.err.lang_unsupported', 'langue non supportée');
      case 'bad-grammar':           return _t('mic.err.bad_grammar', 'grammaire invalide');
      case 'auto-restart-failed':   return _t('mic.err.auto_restart', 'session coupée par le navigateur — recliquez sur le micro');
      case 'no-media-devices':      return _t('mic.err.no_media', 'API media non disponible');
      case 'not-supported':         return _t('mic.err.not_supported', 'reconnaissance vocale non supportée par le navigateur');
      case 'init-failed':           return _t('mic.err.init_failed', 'initialisation impossible');
      case 'start-failed':          return _t('mic.err.start_failed', 'impossible de démarrer le micro');
      default:                      return code || 'erreur inconnue';
    }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------
  function _initRec() {
    if (MIC.rec) return true;
    if (!isMicSupported()) return false;
    var SR  = window.SpeechRecognition || window.webkitSpeechRecognition;
    var rec = new SR();
    rec.continuous      = true;
    rec.interimResults  = true;
    rec.lang            = STATE.lang;

    rec.onstart       = function () { MIC.lastEventAt = Date.now(); };
    rec.onaudiostart  = function () { MIC.lastEventAt = Date.now(); };
    rec.onspeechstart = function () { MIC.lastEventAt = Date.now(); };

    rec.onresult = function (event) {
      MIC.lastEventAt = Date.now();
      var finalChunk  = '';
      var interimChunk = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var txt = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalChunk  += txt + ' ';
        else                           interimChunk += txt;
      }
      if (finalChunk)  { MIC.finalTranscript += finalChunk; onVoiceTranscript(finalChunk.trim()); }
      if (interimChunk) onVoiceInterim(interimChunk);
    };

    rec.onerror = function (event) {
      MIC.lastEventAt = Date.now();
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      _onVoiceError(event.error);
    };

    rec.onend = function () {
      if (!STATE.micActive) { _setMicActive(false); return; }
      setTimeout(function () {
        if (!STATE.micActive) return;
        try { rec.start(); }
        catch (_) { STATE.micActive = false; _onVoiceError('auto-restart-failed'); _setMicActive(false); }
      }, 200);
    };

    MIC.rec = rec;
    return true;
  }

  function _setMicActive(active) {
    STATE.micActive = active;
    if (REFS.micBtn) {
      REFS.micBtn.classList.toggle('active', active);
      REFS.micBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
      var lbl = REFS.micBtn.querySelector('.label');
      if (lbl) lbl.textContent = active ? _t('mic.label_active', 'Micro ✓') : _t('tools.mic', 'Micro');
    }
    if (!active) clearInterimGhost();
  }

  function _onVoiceError(code) {
    var isPermDenied = code === 'not-allowed' || code === 'service-not-allowed' || code === 'denied-extension';
    if (window.BIAIFToast) window.BIAIFToast.show(_t('mic.error_prefix', 'Micro : ' + voiceErrorFr(code), { err: voiceErrorFr(code) }), 'error');
    if (isPermDenied) {
      try { chrome.tabs.create({ url: 'chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2F' + chrome.runtime.id }); } catch (_) {}
    }
  }

  function _startWatchdog() {
    _stopWatchdog();
    MIC.lastEventAt = Date.now();
    srWatchdog = setInterval(function () {
      if (!STATE.micActive) { _stopWatchdog(); return; }
      var idle = Date.now() - (MIC.lastEventAt || 0);
      if (idle > 12000 && window.BIAIFToast) {
        window.BIAIFToast.show(_t('mic.idle_warning', 'Aucun signal audio depuis 12 s — vérifiez le micro par défaut dans Chrome.'), 'error', 5000);
      }
    }, 3000);
  }
  function _stopWatchdog() { if (srWatchdog) { clearInterval(srWatchdog); srWatchdog = null; } }

  function _getActiveEditable() {
    if (typeof STATE.editingDemandeIdx === 'number')
      return document.querySelector('.demande-text[data-i="' + STATE.editingDemandeIdx + '"]');
    return REFS.demandeEditor;
  }

  function _renderInterimGhost(text) {
    var target = _getActiveEditable();
    if (!target) return;
    var ghost = target.querySelector('.voice-interim-ghost');
    if (!text) { if (ghost) ghost.parentNode && ghost.parentNode.removeChild(ghost); return; }
    if (!ghost) {
      ghost = document.createElement('span');
      ghost.className = 'voice-interim-ghost';
      ghost.contentEditable = 'false';
      target.appendChild(ghost);
    } else if (ghost.parentNode !== target) {
      ghost.parentNode && ghost.parentNode.removeChild(ghost);
      target.appendChild(ghost);
    }
    var prev = ghost.previousSibling;
    var prefix = '';
    if (prev && prev.nodeType === Node.TEXT_NODE) {
      var last = prev.textContent.slice(-1);
      if (last && !/\s/.test(last)) prefix = ' ';
    }
    ghost.textContent = prefix + text;
  }

  function _appendVoiceToEditor(text) {
    var ed = REFS.demandeEditor;
    if (!ed || !text) return;
    if (window.BIAIFSession) window.BIAIFSession.insertTextAtSelection(ed, text);
    if (window.BIAIFSession) window.BIAIFSession.syncCurrentDemandeFromEditor();
    if (window.BIAIFStorage) window.BIAIFStorage.persist(STATE);
  }

  function _appendVoiceToDemande(idx, text) {
    var dem = STATE.demandes[idx];
    if (!dem || !text) return;
    var textEl = document.querySelector('.demande-text[data-i="' + idx + '"]');
    if (textEl) {
      if (window.BIAIFSession) window.BIAIFSession.insertTextAtSelection(textEl, text);
      if (window.BIAIFSession) window.BIAIFSession.syncDemandeFromTextEl(textEl, dem);
    } else {
      var trimmed = text.replace(/^\s+|\s+$/g, '');
      var cur     = dem.text || '';
      var sep     = cur && !/\s$/.test(cur) ? ' ' : '';
      dem.text    = (cur + sep + trimmed + ' ').replace(/\s{2,}/g, ' ').replace(/\s+$/, ' ');
      if (window.BIAIFRenderer) window.BIAIFRenderer.renderSegments();
    }
    if (window.BIAIFStorage) window.BIAIFStorage.persist(STATE);
  }

  window.BIAIFSpeech = {
    init:                init,
    isMicSupported:      isMicSupported,
    ensureMicPermission: ensureMicPermission,
    startMic:            startMic,
    stopMic:             stopMic,
    toggleMic:           toggleMic,
    onVoiceInterim:      onVoiceInterim,
    onVoiceTranscript:   onVoiceTranscript,
    clearInterimGhost:   clearInterimGhost,
    startMicTest:        startMicTest,
    stopMicTest:         stopMicTest,
    refreshMicDevices:   refreshMicDevices,
    voiceErrorFr:        voiceErrorFr,
    getMicState:         function () { return MIC; },
  };

})(window);
