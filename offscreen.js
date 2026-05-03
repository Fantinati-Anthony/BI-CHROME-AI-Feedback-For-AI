/**
 * BIAIF Offscreen Document — Voice Recorder
 *
 * Single SpeechRecognition instance for the whole extension. Driven by
 * messages from the side panel via the service worker.
 *
 * IN  : { type:'biaif:offscreen-cmd', action:'start'|'stop'|'set-lang'|'reset', lang? }
 * OUT : { type:'biaif:voice-event', subtype:'transcript'|'interim'|'error'|'state', payload }
 */

(function () {
  'use strict';

  const STATE = {
    active: false,
    recognition: null,
    finalTranscript: '',
    lang: 'fr-FR',
  };

  function emit(subtype, payload) {
    chrome.runtime.sendMessage({ type: 'biaif:voice-event', subtype, payload }).catch(() => {});
  }

  function isSupported() {
    return !!(self.SpeechRecognition || self.webkitSpeechRecognition);
  }

  async function checkPermission() {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const status = await navigator.permissions.query({ name: 'microphone' });
        if (status.state === 'denied')  return { ok: false, reason: 'not-allowed' };
        if (status.state === 'granted') return { ok: true };
      }
    } catch (_) {}
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { ok: false, reason: 'no-media-devices' };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return { ok: true };
    } catch (e) {
      if (e && e.name === 'NotAllowedError')  return { ok: false, reason: 'not-allowed' };
      if (e && e.name === 'NotFoundError')    return { ok: false, reason: 'audio-capture' };
      if (e && e.name === 'NotReadableError') return { ok: false, reason: 'audio-capture' };
      return { ok: false, reason: 'unknown' };
    }
  }

  function init() {
    if (!isSupported()) return false;
    const SR = self.SpeechRecognition || self.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = STATE.lang;

    rec.onresult = (event) => {
      let finalChunk = '';
      let interimChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const txt = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalChunk += txt + ' ';
        else interimChunk += txt;
      }
      if (finalChunk) {
        STATE.finalTranscript += finalChunk;
        emit('transcript', { text: finalChunk.trim(), full: STATE.finalTranscript });
      }
      if (interimChunk) emit('interim', { text: interimChunk });
    };

    rec.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      emit('error', { error: event.error });
    };

    rec.onend = () => {
      if (!STATE.active) {
        emit('state', { active: false });
        return;
      }
      // Backoff before auto-restart to avoid tight-looping when Chrome
      // rate-limits start() after several quick onend cycles.
      setTimeout(() => {
        if (!STATE.active) return;
        try {
          rec.start();
        } catch (e) {
          STATE.active = false;
          emit('error', { error: 'auto-restart-failed' });
          emit('state', { active: false });
        }
      }, 200);
    };

    STATE.recognition = rec;
    return true;
  }

  async function start() {
    if (STATE.active) return;
    if (!isSupported()) {
      emit('error', { error: 'not-supported' });
      return;
    }
    const perm = await checkPermission();
    if (!perm.ok) {
      emit('error', { error: perm.reason });
      return;
    }
    if (!STATE.recognition && !init()) {
      emit('error', { error: 'init-failed' });
      return;
    }
    try {
      STATE.recognition.start();
      STATE.active = true;
      emit('state', { active: true });
    } catch (e) {
      emit('error', { error: 'start-failed' });
    }
  }

  function stop() {
    if (!STATE.active) return;
    STATE.active = false;
    try { STATE.recognition && STATE.recognition.stop(); } catch (_) {}
  }

  function setLang(lang) {
    STATE.lang = lang;
    if (STATE.recognition) STATE.recognition.lang = lang;
  }

  function reset() {
    STATE.finalTranscript = '';
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'biaif:offscreen-cmd') return;
    switch (msg.action) {
      case 'start':    start(); break;
      case 'stop':     stop(); break;
      case 'set-lang': setLang(msg.lang); break;
      case 'reset':    reset(); break;
    }
  });

  // Signal readiness so the side panel can hide a "loading" state if needed.
  emit('state', { active: false, ready: true });
})();
