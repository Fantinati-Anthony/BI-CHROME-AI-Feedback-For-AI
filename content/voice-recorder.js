/**
 * BIAIF Voice Recorder
 *
 * Reconnaissance vocale via Web Speech API (webkitSpeechRecognition).
 * Émet `biaif:voice-transcript` (texte final) et `biaif:voice-interim`
 * (résultat partiel en cours).
 */

(function (window, document) {
  'use strict';

  const VoiceRecorder = {
    state: {
      active: false,
      recognition: null,
      finalTranscript: '',
    },

    config: {
      lang: 'fr-FR',
    },

    isSupported() {
      return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    },

    /**
     * Vérifie la permission micro AVANT de démarrer SpeechRecognition.
     * Renvoie { ok, reason } où reason ∈
     *   'not-allowed'      → l'utilisateur a refusé pour ce site
     *   'audio-capture'    → aucun micro détecté / non lisible
     *   'no-media-devices' → API mediaDevices indisponible
     *   'unknown'          → autre erreur
     * Si la permission n'est pas encore demandée ('prompt') OU déjà
     * accordée ('granted'), on renvoie ok:true sans déclencher de prompt
     * inutile (SpeechRecognition.start() le fera lui-même si besoin).
     */
    async checkPermission() {
      // Tentative 1 : Permissions API (n'affiche pas de prompt)
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const status = await navigator.permissions.query({ name: 'microphone' });
          if (status.state === 'denied') return { ok: false, reason: 'not-allowed' };
          if (status.state === 'granted') return { ok: true, state: 'granted' };
          // 'prompt' → on tombe sur la sonde getUserMedia ci-dessous
        }
      } catch (_) {
        // Permissions API parfois sans support pour 'microphone' selon le navigateur
      }
      // Tentative 2 : sonde via getUserMedia (déclenche le prompt si besoin —
      // c'est exactement ce que l'utilisateur attend en cliquant START).
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return { ok: false, reason: 'no-media-devices' };
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // On relâche immédiatement, on voulait juste valider la permission.
        stream.getTracks().forEach((t) => t.stop());
        return { ok: true, state: 'granted' };
      } catch (e) {
        if (e && e.name === 'NotAllowedError')  return { ok: false, reason: 'not-allowed' };
        if (e && e.name === 'NotFoundError')    return { ok: false, reason: 'audio-capture' };
        if (e && e.name === 'NotReadableError') return { ok: false, reason: 'audio-capture' };
        return { ok: false, reason: 'unknown' };
      }
    },

    init() {
      if (!this.isSupported()) {
        console.warn('[BIAIF] Web Speech API indisponible');
        return false;
      }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = this.config.lang;

      rec.onresult = (event) => {
        let finalChunk = '';
        let interimChunk = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const txt = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalChunk += txt + ' ';
          else interimChunk += txt;
        }
        if (finalChunk) {
          this.state.finalTranscript += finalChunk;
          document.dispatchEvent(
            new CustomEvent('biaif:voice-transcript', {
              detail: { text: finalChunk.trim(), full: this.state.finalTranscript },
            })
          );
        }
        if (interimChunk) {
          document.dispatchEvent(
            new CustomEvent('biaif:voice-interim', { detail: { text: interimChunk } })
          );
        }
      };

      rec.onerror = (event) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        document.dispatchEvent(
          new CustomEvent('biaif:voice-error', { detail: { error: event.error } })
        );
      };

      rec.onend = () => {
        // Auto-restart si toujours actif (la Web Speech API coupe parfois
        // après silence). Backoff léger pour éviter de tight-looper si
        // Chrome rate-limite ou si le backend est down.
        if (!this.state.active) {
          document.dispatchEvent(new CustomEvent('biaif:voice-state', { detail: { active: false } }));
          return;
        }
        setTimeout(() => {
          if (!this.state.active) return;
          try {
            rec.start();
          } catch (e) {
            // start() peut throw si Chrome a définitivement coupé la
            // session : on remet l'UI en cohérence et on remonte l'erreur.
            console.warn('[BIAIF] voice auto-restart KO :', e?.message || e);
            this.state.active = false;
            document.dispatchEvent(
              new CustomEvent('biaif:voice-error', { detail: { error: 'auto-restart-failed' } })
            );
            document.dispatchEvent(
              new CustomEvent('biaif:voice-state', { detail: { active: false } })
            );
          }
        }, 200);
      };

      this.state.recognition = rec;
      return true;
    },

    setLang(lang) {
      this.config.lang = lang;
      if (this.state.recognition) this.state.recognition.lang = lang;
    },

    async start() {
      if (this.state.active) return true;
      if (!this.isSupported()) {
        document.dispatchEvent(
          new CustomEvent('biaif:voice-error', { detail: { error: 'not-supported' } })
        );
        return false;
      }
      const perm = await this.checkPermission();
      if (!perm.ok) {
        document.dispatchEvent(
          new CustomEvent('biaif:voice-error', { detail: { error: perm.reason } })
        );
        return false;
      }
      if (!this.state.recognition && !this.init()) return false;
      try {
        this.state.recognition.start();
        this.state.active = true;
        document.dispatchEvent(new CustomEvent('biaif:voice-state', { detail: { active: true } }));
        return true;
      } catch (e) {
        console.warn('[BIAIF] voice start error', e);
        document.dispatchEvent(
          new CustomEvent('biaif:voice-error', { detail: { error: 'start-failed' } })
        );
        return false;
      }
    },

    stop() {
      if (!this.state.active) return;
      this.state.active = false;
      try { this.state.recognition.stop(); } catch (_) {}
    },

    toggle() {
      this.state.active ? this.stop() : this.start();
    },

    reset() {
      this.state.finalTranscript = '';
    },
  };

  window.BIAIFVoiceRecorder = VoiceRecorder;
})(window, document);
