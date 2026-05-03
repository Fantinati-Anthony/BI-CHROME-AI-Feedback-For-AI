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
    currentVoiceBuffer: '',
    pendingIntents: new Set(),
    segments: [],          // [{ id, voice, intents, element, screenshot, ts, metadata }]
    lastShot: null,        // dernier screenshot manuel
    lastShotMode: null,
    lang: 'fr-FR',
  };

  const REFS = {};
  const STORAGE_KEY = 'biaif:v03:state';

  let statusTimer = null;
  let timerInterval = null;
  let timerStart = 0;

  // Mic (SpeechRecognition lives in this context now)
  const MIC = {
    rec: null,
    finalTranscript: '',
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
    // Shot tools
    REFS.shotButtons = document.querySelectorAll('[data-shot]');
    REFS.shotPreview = document.querySelector('.biaif-shot-preview');
    REFS.shotInfo    = document.querySelector('.biaif-shot-info');
    REFS.shotCopy    = document.querySelector('[data-act="shot-copy"]');
    REFS.shotSave    = document.querySelector('[data-act="shot-save"]');
    REFS.shotAttach  = document.querySelector('[data-act="shot-attach"]');
    REFS.shotAnnotate= document.querySelector('[data-act="shot-annotate"]');
  }

  function bindEvents() {
    REFS.masterBtn.addEventListener('click',   () => toggleSession());
    REFS.pickerBtn.addEventListener('click',   () => sendBg({ type: 'biaif:picker-toggle' }));
    REFS.micBtn.addEventListener('click',      () => toggleMic());
    REFS.clearBtn.addEventListener('click',    () => clearAll());
    REFS.copyBtn.addEventListener('click',     () => copyPrompt());
    REFS.downloadBtn.addEventListener('click', () => downloadBundle());
    REFS.langSelect.addEventListener('change', (e) => {
      STATE.lang = e.target.value;
      if (MIC.rec) MIC.rec.lang = STATE.lang;
      persist();
    });

    // Shot tools
    REFS.shotButtons.forEach((btn) => {
      btn.addEventListener('click', () => runShotMode(btn.dataset.shot));
    });
    if (REFS.shotCopy)     REFS.shotCopy.addEventListener('click',     () => copyLastShot());
    if (REFS.shotSave)     REFS.shotSave.addEventListener('click',     () => downloadLastShot());
    if (REFS.shotAttach)   REFS.shotAttach.addEventListener('click',   () => attachLastShotAsSegment());
    if (REFS.shotAnnotate) REFS.shotAnnotate.addEventListener('click', () => annotateLastShot());

    // Click on status zone : if a permission error is shown, jump to BIAIF's
    // per-site permission page.
    REFS.status.addEventListener('click', () => {
      if (REFS.status.dataset.kind === 'error' && REFS.status.dataset.action === 'open-mic-settings') {
        const url = `chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2F${chrome.runtime.id}`;
        chrome.tabs.create({ url });
      }
    });
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
      notes: REFS.textarea ? REFS.textarea.value : '',
    };
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: payload }).catch(() => {
        // storage.local cap is ~5MB ; if exceeded, drop screenshots.
        const slim = {
          ...payload,
          segments: payload.segments.map((s) => ({ ...s, screenshot: null })),
        };
        chrome.storage.local.set({ [STORAGE_KEY]: slim }).catch(() => {});
      });
    } catch (_) {}
  }

  // Save notes on input (debounced)
  let notesTimer = null;
  document.addEventListener('input', (e) => {
    if (e.target && e.target === REFS.textarea) {
      if (notesTimer) clearTimeout(notesTimer);
      notesTimer = setTimeout(persist, 600);
    }
  });

  // ============================================================
  // MIC : SpeechRecognition runs HERE (sidepanel context)
  // ============================================================

  function isMicSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  /**
   * Pre-flight permission. The side panel is visible, so the prompt
   * (when state === 'prompt') anchors to the panel UI cleanly.
   */
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

    rec.onresult = (event) => {
      let finalChunk = '';
      let interimChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const txt = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalChunk += txt + ' ';
        else interimChunk += txt;
      }
      if (finalChunk) {
        MIC.finalTranscript += finalChunk;
        onVoiceTranscript(finalChunk.trim());
      }
      if (interimChunk) onVoiceInterim(interimChunk);
    };

    rec.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      onVoiceError(event.error);
    };

    rec.onend = () => {
      if (!STATE.micActive) {
        setMicActive(false);
        return;
      }
      // Auto-restart with backoff (Chrome cuts the session sometimes).
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
      return true;
    } catch (e) {
      onVoiceError('start-failed');
      return false;
    }
  }

  function stopMic() {
    if (!STATE.micActive) return;
    STATE.micActive = false;
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
    REFS.interim.textContent = text || '';
  }

  function onVoiceTranscript(text) {
    if (!text) return;
    STATE.currentVoiceBuffer += (STATE.currentVoiceBuffer ? ' ' : '') + text;
    const intents = window.BIAIFIntentParser ? window.BIAIFIntentParser.detect(text) : [];
    intents.forEach((i) => STATE.pendingIntents.add(i));
    insertAtCursor(text + ' ');
    persist();
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
    if (!STATE.pickerActive) sendBg({ type: 'biaif:picker-enable' });
    if (!STATE.micActive)    await startMic();
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
    persist();
    setStatus(
      `Segment ${segment.id} : ${descriptor.selector}` +
        (segment.intents.length ? ' — ' + segment.intents.map((i) => '#' + i).join(' ') : ''),
      'success'
    );
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
        const btn = document.createElement('button');
        btn.className = 'seg-annotate';
        btn.dataset.i = String(i);
        btn.title = 'Annoter cette capture';
        btn.textContent = '✏️';
        btn.addEventListener('click', () => annotateSegment(i));
        wrap.appendChild(img);
        wrap.appendChild(btn);
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
        persist();
      });
      REFS.segments.appendChild(card);
    });
  }

  // ============================================================
  // MANUAL SCREENSHOT TOOLS
  // The capture itself happens IN the active tab content script
  // (it owns the DOM). Panel just orchestrates via SW + sendMessage.
  // ============================================================

  async function runShotMode(mode) {
    setStatus('Capture (' + mode + ')…', 'info');
    const resp = await sendBg({ type: 'biaif:capture-mode', mode });
    if (!resp || resp.error) {
      setStatus('Capture KO : ' + (resp ? resp.error : 'pas de réponse'), 'error');
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
    const segment = {
      id: 'seg-' + (STATE.segments.length + 1),
      ts: Date.now(),
      intents: [],
      voice: STATE.currentVoiceBuffer.trim(),
      element: {
        selector: '(capture ' + (STATE.lastShotMode || '') + ')',
        tag: null, id: null, classes: [], text: null, outerHTML: null,
      },
      screenshot: STATE.lastShot,
      metadata: null,
    };
    STATE.segments.push(segment);
    STATE.currentVoiceBuffer = '';
    renderSegments();
    persist();
    setStatus(`Capture attachée comme ${segment.id}.`, 'success');
  }

  // ============================================================
  // ANNOTATOR (modal lives in content script of active tab)
  // ============================================================

  async function annotateLastShot() {
    if (!STATE.lastShot) return;
    setStatus("Annotateur ouvert dans l'onglet actif…", 'info');
    const resp = await sendBg({ type: 'biaif:annotate', dataUrl: STATE.lastShot });
    if (!resp || resp.cancelled) { setStatus('Annotation annulée.', 'info'); return; }
    if (resp.error || !resp.dataUrl) { setStatus('Annotation KO : ' + (resp.error || 'no result'), 'error'); return; }
    STATE.lastShot = resp.dataUrl;
    renderShotPreview();
    setStatus('Annotation enregistrée.', 'success');
  }

  async function annotateSegment(index) {
    const seg = STATE.segments[index];
    if (!seg || !seg.screenshot) return;
    setStatus("Annotateur ouvert dans l'onglet actif…", 'info');
    const resp = await sendBg({ type: 'biaif:annotate', dataUrl: seg.screenshot });
    if (!resp || resp.cancelled) { setStatus('Annotation annulée.', 'info'); return; }
    if (resp.error || !resp.dataUrl) { setStatus('Annotation KO : ' + (resp.error || 'no result'), 'error'); return; }
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
    STATE.pendingIntents.clear();
    STATE.lastShot = null;
    STATE.lastShotMode = null;
    REFS.textarea.value = '';
    REFS.interim.textContent = '';
    MIC.finalTranscript = '';
    renderSegments();
    renderShotPreview();
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
      REFS.status.title = 'Cliquer pour ouvrir les réglages micro de Chrome';
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
