/**
 * BIAIF Side Panel — UI v0.2
 *
 * Lives in a chrome.sidePanel context : persistent across tab switches,
 * one instance per browser window. Communicates with :
 *   - the offscreen document (via service worker) for the microphone
 *   - the active tab's content script (via service worker) for picker
 *     and screenshot capture
 */

(function () {
  'use strict';

  const STATE = {
    armed: false,
    pickerActive: false,
    micActive: false,
    currentVoiceBuffer: '',
    pendingIntents: new Set(),
    segments: [],          // [{ id, voice, intents, element, screenshot, ts, metadata }]
  };

  const REFS = {};
  let statusTimer = null;
  let timerInterval = null;
  let timerStart = 0;

  // ----------- bootstrap --------------------------------------------------

  document.addEventListener('DOMContentLoaded', () => {
    cacheRefs();
    bindEvents();
    bindRuntimeMessages();
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
  }

  function bindEvents() {
    REFS.masterBtn.addEventListener('click',   () => toggleSession());
    REFS.pickerBtn.addEventListener('click',   () => sendBg({ type: 'biaif:picker-toggle' }));
    REFS.micBtn.addEventListener('click',      () => toggleMic());
    REFS.clearBtn.addEventListener('click',    () => clearAll());
    REFS.copyBtn.addEventListener('click',     () => copyPrompt());
    REFS.downloadBtn.addEventListener('click', () => downloadBundle());
    REFS.langSelect.addEventListener('change', (e) => {
      sendBg({ type: 'biaif:mic-set-lang', lang: e.target.value });
    });
    // Click sur la zone de status : si erreur de permission, ouvre les réglages.
    REFS.status.addEventListener('click', () => {
      if (REFS.status.dataset.kind === 'error' && REFS.status.dataset.action === 'open-mic-settings') {
        chrome.tabs.create({ url: 'chrome://settings/content/microphone' });
      }
    });
  }

  function bindRuntimeMessages() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'biaif:voice-event') {
        onVoiceEvent(msg.subtype, msg.payload || {});
        return;
      }
      if (msg.type === 'biaif:element-picked') {
        onElementPicked(msg);
        return;
      }
      if (msg.type === 'biaif:picker-state') {
        onPickerState(!!msg.active);
        return;
      }
      if (msg.type === 'biaif:hotkey') {
        if (msg.action === 'toggle-mic')    toggleMic();
        if (msg.action === 'copy-prompt')   copyPrompt();
        // toggle-picker is handled by background → active tab directly
        return;
      }
    });
  }

  function sendBg(payload) {
    return chrome.runtime.sendMessage(payload).catch(() => null);
  }

  // ----------- mic permission (pre-flight from the panel context) --------

  /**
   * On demande la permission micro DEPUIS la side panel, pas depuis
   * l'offscreen document. Raison : l'offscreen est invisible, donc le
   * prompt Chrome n'a pas de surface UI naturelle (l'utilisateur ne le
   * voit pas, ou Chrome le bloque silencieusement). En appelant
   * getUserMedia ici, le prompt s'ancre sur le panneau visible.
   * Une fois accordée, l'offscreen hérite (même origine extension).
   */
  async function ensureMicPermission() {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' });
      if (status.state === 'granted') return { ok: true };
      if (status.state === 'denied')  return { ok: false, reason: 'denied-extension' };
      // 'prompt' → on continue avec getUserMedia
    } catch (_) { /* Permissions API non supportée */ }
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

  // ----------- master session --------------------------------------------

  function toggleSession() {
    STATE.armed ? stopSession() : startSession();
  }

  async function startSession() {
    if (STATE.armed) return;
    // Pré-flight permission micro depuis le panel (UI visible) avant de
    // demander à l'offscreen. Évite le prompt silencieux dans l'offscreen.
    const perm = await ensureMicPermission();
    if (!perm.ok) {
      setStatusError('Micro : ' + voiceErrorFr(perm.reason),
        perm.reason === 'denied-extension' ? 'open-mic-settings' : null);
      return;
    }
    STATE.armed = true;
    REFS.masterBtn.classList.add('armed');
    REFS.masterBtn.querySelector('.master-label').textContent = 'STOP';
    REFS.sessionInfo.textContent = 'Session active — parlez puis cliquez les éléments';
    startTimer();
    if (!STATE.pickerActive) sendBg({ type: 'biaif:picker-enable' });
    if (!STATE.micActive)    sendBg({ type: 'biaif:mic-start' });
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
    if (STATE.micActive)    sendBg({ type: 'biaif:mic-stop' });
    setStatus(`Session arrêtée — ${STATE.segments.length} segment(s) capturé(s).`, 'info');
  }

  async function toggleMic() {
    if (STATE.micActive) {
      sendBg({ type: 'biaif:mic-stop' });
      return;
    }
    const perm = await ensureMicPermission();
    if (!perm.ok) {
      setStatusError('Micro : ' + voiceErrorFr(perm.reason),
        perm.reason === 'denied-extension' ? 'open-mic-settings' : null);
      return;
    }
    sendBg({ type: 'biaif:mic-start' });
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

  // ----------- voice events ----------------------------------------------

  function onVoiceEvent(subtype, payload) {
    if (subtype === 'state') {
      STATE.micActive = !!payload.active;
      REFS.micBtn.classList.toggle('active', STATE.micActive);
      REFS.micBtn.querySelector('.label').textContent = STATE.micActive
        ? 'Micro actif'
        : 'Démarrer le micro';
      if (!STATE.micActive) REFS.interim.textContent = '';
      return;
    }
    if (subtype === 'interim') {
      REFS.interim.textContent = payload.text || '';
      return;
    }
    if (subtype === 'transcript') {
      const text = payload.text || '';
      if (!text) return;
      STATE.currentVoiceBuffer += (STATE.currentVoiceBuffer ? ' ' : '') + text;
      const intents = window.BIAIFIntentParser ? window.BIAIFIntentParser.detect(text) : [];
      intents.forEach((i) => STATE.pendingIntents.add(i));
      insertAtCursor(text + ' ');
      return;
    }
    if (subtype === 'error') {
      const code = payload.error;
      const isPermDenied = code === 'not-allowed' || code === 'service-not-allowed' || code === 'denied-extension';
      setStatusError('Micro : ' + voiceErrorFr(code), isPermDenied ? 'open-mic-settings' : null);
      return;
    }
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

  // ----------- picker / element-picked -----------------------------------

  function onPickerState(active) {
    STATE.pickerActive = active;
    REFS.pickerBtn.classList.toggle('active', active);
    REFS.pickerBtn.querySelector('.label').textContent = active
      ? 'Picker actif (Esc)'
      : "Sélecteur d'élément";
  }

  function onElementPicked(msg) {
    const descriptor = msg.descriptor || { selector: '?', tag: null, id: null, classes: [], text: null, outerHTML: null };
    const segment = {
      id: 'seg-' + (STATE.segments.length + 1),
      ts: Date.now(),
      intents: Array.from(STATE.pendingIntents),
      voice: STATE.currentVoiceBuffer.trim(),
      element: descriptor,
      screenshot: msg.screenshot || null,
      metadata: msg.metadata || null,
    };
    STATE.segments.push(segment);
    STATE.currentVoiceBuffer = '';
    STATE.pendingIntents.clear();
    renderSegments();
    setStatus(
      `Segment ${segment.id} : ${descriptor.selector}` +
        (segment.intents.length ? ' — ' + segment.intents.map((i) => '#' + i).join(' ') : ''),
      'success'
    );
  }

  // ----------- segments rendering ----------------------------------------

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
      card.innerHTML = `
        <header>
          <span class="seg-num">#${i + 1}</span>
          <span class="seg-tags">${seg.intents.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</span>
          <button class="seg-del" data-i="${i}" title="Supprimer">×</button>
        </header>
        <div class="seg-selector"><code>${escapeHtml(seg.element.selector)}</code></div>
        ${seg.voice ? `<div class="seg-voice">« ${escapeHtml(seg.voice)} »</div>` : ''}
      `;
      if (seg.screenshot) {
        const wrap = document.createElement('div');
        wrap.className = 'seg-thumb-wrap';
        const img = document.createElement('img');
        img.className = 'seg-thumb';
        img.src = seg.screenshot;
        img.alt = 'screenshot ' + (seg.element.selector || '');
        wrap.appendChild(img);
        card.appendChild(wrap);
      } else {
        const noshot = document.createElement('div');
        noshot.className = 'seg-no-shot';
        noshot.textContent = 'Pas de screenshot';
        card.appendChild(noshot);
      }
      card.querySelector('.seg-del').addEventListener('click', (e) => {
        STATE.segments.splice(Number(e.currentTarget.dataset.i), 1);
        renderSegments();
      });
      REFS.segments.appendChild(card);
    });
  }

  // ----------- prompt build / copy / download ----------------------------

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
        if (seg.element.tag)            lines.push(`- **Tag :** \`<${seg.element.tag}>\``);
        if (seg.element.id)             lines.push(`- **id :** \`${seg.element.id}\``);
        if (seg.element.classes?.length) lines.push(`- **classes :** \`${seg.element.classes.join(' ')}\``);
        if (seg.element.text)           lines.push(`- **texte :** « ${seg.element.text} »`);
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

  // ----------- reset / status --------------------------------------------

  function clearAll() {
    STATE.segments = [];
    STATE.currentVoiceBuffer = '';
    STATE.pendingIntents.clear();
    REFS.textarea.value = '';
    REFS.interim.textContent = '';
    renderSegments();
    sendBg({ type: 'biaif:mic-reset' });
    setStatus('Tout effacé.', 'info');
  }

  function setStatus(msg, kind) {
    if (!REFS.status) return;
    REFS.status.textContent = msg || '';
    REFS.status.dataset.kind = kind || 'info';
    delete REFS.status.dataset.action;
    REFS.status.style.cursor = '';
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    if (msg && (kind === 'success' || kind === 'info')) {
      statusTimer = setTimeout(() => {
        if (REFS.status && REFS.status.textContent === msg) REFS.status.textContent = '';
      }, 5000);
    }
  }

  // Status d'erreur cliquable (ex: ouvre chrome://settings/content/microphone)
  function setStatusError(msg, action) {
    setStatus(msg, 'error');
    if (action) {
      REFS.status.dataset.action = action;
      REFS.status.style.cursor = 'pointer';
      REFS.status.title = 'Cliquer pour ouvrir les réglages micro de Chrome';
    }
  }

  // ----------- helpers ---------------------------------------------------

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

  function voiceErrorFr(code) {
    switch (code) {
      case 'denied-extension':
      case 'not-allowed':
      case 'service-not-allowed':
        return "micro bloqué pour BIAIF — clique ici pour ouvrir les réglages Chrome, retire l'extension de la liste 'Bloqué'";
      case 'no-speech':              return 'rien entendu';
      case 'audio-capture':          return 'aucun micro détecté';
      case 'network':                return 'erreur réseau';
      case 'aborted':                return 'reconnaissance interrompue';
      case 'language-not-supported': return 'langue non supportée';
      case 'bad-grammar':            return 'grammaire invalide';
      case 'auto-restart-failed':    return 'session coupée par le navigateur — recliquez sur le micro';
      case 'no-media-devices':       return 'API media non disponible';
      case 'not-supported':          return 'reconnaissance vocale non supportée par le navigateur';
      case 'init-failed':            return 'initialisation impossible';
      case 'start-failed':           return 'impossible de démarrer le micro';
      default:                       return code || 'erreur inconnue';
    }
  }
})();
