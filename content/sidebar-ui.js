/**
 * BIAIF Sidebar UI (v0.2 — Phase 1)
 *
 * Nouveautés :
 *   - Gros bouton master START / STOP qui arme micro + picker en même temps
 *   - Notion de "segment" : { voice, element, screenshot, intents[] }
 *   - Capture screenshot automatique de l'élément cliqué (via BIAIFScreenshot)
 *   - Intent parser : verbes-déclencheurs détectés dans la voix
 *   - Compilation du prompt en mode batch (un bloc par segment)
 */

(function (window, document) {
  'use strict';

  const HOST_ID = 'biaif-sidebar-host';

  const SidebarUI = {
    state: {
      open: false,
      armed: false,                 // master switch
      pickerActive: false,
      micActive: false,
      currentVoiceBuffer: '',       // voix accumulée depuis le dernier segment
      pendingIntents: new Set(),    // intents détectés en attente d'un élément
      segments: [],                 // [{ id, voice, intents, element, screenshot, ts }]
    },
    host: null,
    shadow: null,
    refs: {},

    open() {
      if (this.state.open) return;
      this.mount();
      this.state.open = true;
      this.host.style.transform = 'translateX(0)';
    },

    close() {
      if (!this.state.open) return;
      this.state.open = false;
      if (this.host) this.host.style.transform = 'translateX(100%)';
      if (this.state.armed) this.stopSession();
    },

    toggle() {
      this.state.open ? this.close() : this.open();
    },

    mount() {
      if (this.host) return;
      const host = document.createElement('div');
      host.id = HOST_ID;
      host.style.cssText = [
        'position:fixed', 'top:0', 'right:0',
        'width:420px', 'max-width:100vw', 'height:100vh',
        'z-index:2147483645',
        'transform:translateX(100%)',
        'transition:transform 200ms ease',
        'box-shadow:-2px 0 20px rgba(0,0,0,0.25)',
      ].join(';');

      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = this.template();

      document.documentElement.appendChild(host);
      this.host = host;
      this.shadow = shadow;

      this.cacheRefs();
      this.bindEvents();
    },

    cacheRefs() {
      const $ = (s) => this.shadow.querySelector(s);
      this.refs = {
        closeBtn:   $('[data-act="close"]'),
        masterBtn:  $('[data-act="master"]'),
        pickerBtn:  $('[data-act="picker"]'),
        micBtn:     $('[data-act="mic"]'),
        clearBtn:   $('[data-act="clear"]'),
        copyBtn:    $('[data-act="copy"]'),
        downloadBtn:$('[data-act="download"]'),
        textarea:   $('textarea[name="notes"]'),
        interim:    $('.biaif-interim'),
        segments:   $('.biaif-segments'),
        empty:      $('.biaif-empty'),
        status:     $('.biaif-status'),
        timer:      $('.biaif-timer'),
        langSelect: $('select[name="lang"]'),
        sessionInfo:$('.biaif-session-info'),
      };
    },

    bindEvents() {
      this.refs.closeBtn.addEventListener('click', () => this.close());
      this.refs.masterBtn.addEventListener('click', () => this.toggleSession());
      this.refs.pickerBtn.addEventListener('click', () => window.BIAIFElementSelector.toggle());
      this.refs.micBtn.addEventListener('click', () => window.BIAIFVoiceRecorder.toggle());
      this.refs.clearBtn.addEventListener('click', () => this.clearAll());
      this.refs.copyBtn.addEventListener('click', () => this.copyPrompt());
      this.refs.downloadBtn.addEventListener('click', () => this.downloadBundle());
      this.refs.langSelect.addEventListener('change', (e) => {
        window.BIAIFVoiceRecorder.setLang(e.target.value);
      });

      document.addEventListener('biaif:element-picked', (e) => this.onElementPicked(e.detail));
      document.addEventListener('biaif:picker-state',   (e) => this.onPickerState(e.detail.active));
      document.addEventListener('biaif:voice-state',    (e) => this.onVoiceState(e.detail.active));
      document.addEventListener('biaif:voice-transcript',(e) => this.onVoiceTranscript(e.detail.text));
      document.addEventListener('biaif:voice-interim',  (e) => {
        this.refs.interim.textContent = e.detail.text || '';
      });
      document.addEventListener('biaif:voice-error',    (e) => {
        this.setStatus('Micro : ' + e.detail.error, 'error');
      });
    },

    // ---------------------------------------------------------------------
    // Master session (gros bouton START/STOP)
    // ---------------------------------------------------------------------

    toggleSession() {
      this.state.armed ? this.stopSession() : this.startSession();
    },

    startSession() {
      this.state.armed = true;
      this.refs.masterBtn.classList.add('armed');
      this.refs.masterBtn.querySelector('.master-label').textContent = 'STOP';
      this.refs.sessionInfo.textContent = 'Session active — parlez puis cliquez les éléments';
      this.startTimer();
      // Arme picker + mic
      if (!this.state.pickerActive) window.BIAIFElementSelector.enable();
      if (!this.state.micActive) window.BIAIFVoiceRecorder.start();
      this.setStatus('Session démarrée.', 'success');
    },

    stopSession() {
      this.state.armed = false;
      this.refs.masterBtn.classList.remove('armed');
      this.refs.masterBtn.querySelector('.master-label').textContent = 'START';
      this.refs.sessionInfo.textContent = 'Session arrêtée';
      this.stopTimer();
      if (this.state.pickerActive) window.BIAIFElementSelector.disable();
      if (this.state.micActive) window.BIAIFVoiceRecorder.stop();
      this.setStatus('Session arrêtée — ' + this.state.segments.length + ' segment(s) capturé(s).', 'info');
    },

    startTimer() {
      this.timerStart = Date.now();
      this.timerInterval = setInterval(() => {
        const ms = Date.now() - this.timerStart;
        const s = Math.floor(ms / 1000);
        const mm = String(Math.floor(s / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        this.refs.timer.textContent = `${mm}:${ss}`;
      }, 250);
    },

    stopTimer() {
      if (this.timerInterval) clearInterval(this.timerInterval);
      this.timerInterval = null;
      this.refs.timer.textContent = '00:00';
    },

    // ---------------------------------------------------------------------
    // États picker / mic
    // ---------------------------------------------------------------------

    onPickerState(active) {
      this.state.pickerActive = active;
      this.refs.pickerBtn.classList.toggle('active', active);
      this.refs.pickerBtn.querySelector('.label').textContent = active
        ? 'Picker actif (Esc)'
        : "Sélecteur d'élément";
    },

    onVoiceState(active) {
      this.state.micActive = active;
      this.refs.micBtn.classList.toggle('active', active);
      this.refs.micBtn.querySelector('.label').textContent = active
        ? 'Micro actif'
        : 'Démarrer le micro';
      if (!active) this.refs.interim.textContent = '';
    },

    // ---------------------------------------------------------------------
    // Capture d'un segment (voix accumulée + élément + screenshot)
    // ---------------------------------------------------------------------

    onVoiceTranscript(text) {
      if (!text) return;
      this.state.currentVoiceBuffer += (this.state.currentVoiceBuffer ? ' ' : '') + text;

      // Détection d'intentions au fil de l'eau
      const intents = window.BIAIFIntentParser
        ? window.BIAIFIntentParser.detect(text)
        : [];
      intents.forEach((i) => this.state.pendingIntents.add(i));

      // Reflet dans la textarea libre (toujours dispo en complément)
      this.insertAtCursor(text + ' ');
    },

    async onElementPicked(descriptor) {
      if (!descriptor) return;

      // Capture screenshot croppé autour de l'élément
      let screenshot = null;
      let metadata = null;
      try {
        if (window.BIAIFScreenshot) {
          screenshot = await window.BIAIFScreenshot.captureElement(descriptor._el || this.lookupElement(descriptor.selector));
          metadata = window.BIAIFScreenshot.getMetadata();
        }
      } catch (e) {
        console.warn('[BIAIF] screenshot KO :', e.message);
        this.setStatus('Screenshot impossible : ' + e.message, 'error');
      }

      const segment = {
        id: 'seg-' + (this.state.segments.length + 1),
        ts: Date.now(),
        intents: Array.from(this.state.pendingIntents),
        voice: this.state.currentVoiceBuffer.trim(),
        element: descriptor,
        screenshot,
        metadata,
      };
      this.state.segments.push(segment);

      // Reset du buffer pour le prochain segment
      this.state.currentVoiceBuffer = '';
      this.state.pendingIntents.clear();

      this.renderSegments();
      this.setStatus(
        `Segment ${segment.id} : ${descriptor.selector}` +
          (segment.intents.length ? ' — ' + segment.intents.map(i => '#'+i).join(' ') : ''),
        'success'
      );
    },

    /**
     * Si on n'a pas l'élément DOM en main (ex: pick venant d'ailleurs), on
     * tente de le retrouver via son sélecteur.
     */
    lookupElement(selector) {
      try { return document.querySelector(selector); } catch (_) { return null; }
    },

    insertAtCursor(text) {
      const ta = this.refs.textarea;
      if (!ta) return;
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
      const pos = start + text.length;
      ta.selectionStart = ta.selectionEnd = pos;
    },

    // ---------------------------------------------------------------------
    // Rendu des segments
    // ---------------------------------------------------------------------

    renderSegments() {
      const list = this.refs.segments;
      list.innerHTML = '';
      if (!this.state.segments.length) {
        this.refs.empty.style.display = '';
        return;
      }
      this.refs.empty.style.display = 'none';

      this.state.segments.forEach((seg, i) => {
        const card = document.createElement('article');
        card.className = 'biaif-segment';
        card.innerHTML = `
          <header>
            <span class="seg-num">#${i + 1}</span>
            <span class="seg-tags">${seg.intents.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</span>
            <button class="seg-del" data-i="${i}" title="Supprimer">×</button>
          </header>
          <div class="seg-selector"><code>${escapeHtml(seg.element.selector)}</code></div>
          ${seg.voice ? `<div class="seg-voice">« ${escapeHtml(seg.voice)} »</div>` : ''}
          ${seg.screenshot
            ? `<img class="seg-thumb" src="${seg.screenshot}" alt="screenshot ${seg.element.selector}" />`
            : `<div class="seg-no-shot">Pas de screenshot</div>`}
        `;
        card.querySelector('.seg-del').addEventListener('click', (e) => {
          this.state.segments.splice(Number(e.currentTarget.dataset.i), 1);
          this.renderSegments();
        });
        list.appendChild(card);
      });
    },

    // ---------------------------------------------------------------------
    // Reset / export
    // ---------------------------------------------------------------------

    clearAll() {
      this.state.segments = [];
      this.state.currentVoiceBuffer = '';
      this.state.pendingIntents.clear();
      this.refs.textarea.value = '';
      this.refs.interim.textContent = '';
      this.renderSegments();
      window.BIAIFVoiceRecorder.reset();
      this.setStatus('Tout effacé.', 'info');
    },

    buildPrompt({ inlineImages = false } = {}) {
      const notes = this.refs.textarea.value.trim();
      const md = window.BIAIFScreenshot ? window.BIAIFScreenshot.getMetadata() : null;

      const lines = [];
      lines.push('# Demandes de modification batchées');
      lines.push('');
      if (md) {
        lines.push(`**Page :** ${md.title}`);
        lines.push(`**URL :** ${md.url}`);
        lines.push(`**Viewport :** ${md.viewport.w}×${md.viewport.h} (DPR ${md.devicePixelRatio})`);
        lines.push(`**Browser / OS :** ${md.browser} / ${md.os} (${md.device})`);
      }
      lines.push('');

      if (this.state.segments.length) {
        lines.push(`## Segments (${this.state.segments.length})`);
        lines.push('');
        this.state.segments.forEach((seg, i) => {
          lines.push(`### Segment ${i + 1}${seg.intents.length ? ' — ' + seg.intents.map(t => '#' + t).join(' ') : ''}`);
          lines.push(`- **Sélecteur :** \`${seg.element.selector}\``);
          if (seg.element.tag) lines.push(`- **Tag :** \`<${seg.element.tag}>\``);
          if (seg.element.id) lines.push(`- **id :** \`${seg.element.id}\``);
          if (seg.element.classes?.length) lines.push(`- **classes :** \`${seg.element.classes.join(' ')}\``);
          if (seg.element.text) lines.push(`- **texte :** « ${seg.element.text} »`);
          if (seg.voice) {
            lines.push('');
            lines.push('> ' + seg.voice.replace(/\n/g, '\n> '));
          }
          if (seg.element.outerHTML) {
            lines.push('');
            lines.push('```html');
            lines.push(seg.element.outerHTML);
            lines.push('```');
          }
          if (seg.screenshot) {
            if (inlineImages) {
              lines.push('');
              lines.push(`![${seg.element.selector}](${seg.screenshot})`);
            } else {
              lines.push('');
              lines.push(`📷 Voir \`${seg.id}.png\` (à dropper avec ce prompt).`);
            }
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
    },

    async copyPrompt() {
      const text = this.buildPrompt({ inlineImages: false });
      try {
        await navigator.clipboard.writeText(text);
        this.setStatus('Prompt copié — collez dans Claude Code et drag-droppez les screenshots.', 'success');
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); this.setStatus('Prompt copié.', 'success'); }
        catch (_) { this.setStatus('Copie impossible : ' + e.message, 'error'); }
        ta.remove();
      }
    },

    /**
     * Téléchargement individuel : prompt.md + un PNG par segment.
     * (Phase 3 ajoutera File System Access API pour déposer dans le repo.)
     */
    async downloadBundle() {
      if (!this.state.segments.length) {
        this.setStatus('Rien à télécharger.', 'info');
        return;
      }
      const text = this.buildPrompt({ inlineImages: false });
      this.downloadFile('biaif-prompt.md', new Blob([text], { type: 'text/markdown' }));
      for (const seg of this.state.segments) {
        if (!seg.screenshot) continue;
        const blob = await dataUrlToBlob(seg.screenshot);
        this.downloadFile(`${seg.id}.png`, blob);
      }
      this.setStatus(`${this.state.segments.length + 1} fichiers téléchargés.`, 'success');
    },

    downloadFile(name, blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    setStatus(msg, kind) {
      this.refs.status.textContent = msg || '';
      this.refs.status.dataset.kind = kind || 'info';
    },

    // ---------------------------------------------------------------------
    // Template & styles
    // ---------------------------------------------------------------------

    template() {
      return `
        <style>${this.css()}</style>
        <div class="biaif-root">
          <header class="biaif-header">
            <h1>BI AI Feedback</h1>
            <button class="icon-btn" data-act="close" title="Fermer (Alt+Shift+F)">×</button>
          </header>

          <section class="biaif-master">
            <button class="master-btn" data-act="master">
              <span class="master-pulse"></span>
              <span class="master-label">START</span>
            </button>
            <div class="biaif-master-meta">
              <div class="biaif-timer">00:00</div>
              <div class="biaif-session-info">Session arrêtée</div>
            </div>
          </section>

          <section class="biaif-actions">
            <button class="biaif-btn small" data-act="picker">
              <span class="dot"></span><span class="label">Sélecteur d'élément</span>
              <kbd>Alt+⇧+E</kbd>
            </button>
            <button class="biaif-btn small" data-act="mic">
              <span class="dot"></span><span class="label">Démarrer le micro</span>
              <kbd>Alt+⇧+M</kbd>
            </button>
          </section>

          <section class="biaif-lang">
            <label>Langue micro
              <select name="lang">
                <option value="fr-FR" selected>Français (FR)</option>
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="es-ES">Español</option>
                <option value="de-DE">Deutsch</option>
                <option value="it-IT">Italiano</option>
              </select>
            </label>
          </section>

          <section class="biaif-segments-wrap">
            <h2>Segments capturés</h2>
            <div class="biaif-empty">Aucun segment. Démarrez la session, parlez et cliquez les éléments.</div>
            <div class="biaif-segments"></div>
          </section>

          <section class="biaif-notes">
            <label>
              Notes libres (texte + voix non-attribuée)
              <textarea name="notes" placeholder="Tout ce que la voix capte arrive aussi ici. Vous pouvez compléter à la main."></textarea>
            </label>
            <div class="biaif-interim" aria-live="polite"></div>
          </section>

          <footer class="biaif-footer">
            <button class="biaif-btn ghost" data-act="clear">Effacer</button>
            <button class="biaif-btn ghost" data-act="download">Télécharger .md + PNGs</button>
            <button class="biaif-btn primary" data-act="copy">
              Copier pour Claude Code <kbd>Alt+⇧+C</kbd>
            </button>
          </footer>

          <div class="biaif-status" data-kind="info"></div>
        </div>
      `;
    },

    css() {
      return `
        :host { all: initial; }
        * { box-sizing: border-box; }
        .biaif-root {
          display: flex; flex-direction: column; height: 100%;
          font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #e2e8f0; background: #0f172a;
        }
        .biaif-header {
          display:flex; align-items:center; justify-content:space-between;
          padding: 12px 14px; border-bottom: 1px solid #1e293b;
          background: linear-gradient(135deg,#0ea5b7,#1e293b);
        }
        .biaif-header h1 { font-size: 14px; margin: 0; letter-spacing: .3px; }
        .icon-btn {
          background: transparent; color: #e2e8f0; border: 0;
          font-size: 22px; line-height: 1; cursor: pointer; padding: 0 4px;
        }
        .icon-btn:hover { color: #2bd4d9; }

        section { padding: 10px 14px; }

        /* Master button */
        .biaif-master { display: flex; gap: 12px; align-items: center; padding: 14px; border-bottom: 1px solid #1e293b; }
        .master-btn {
          position: relative; flex: 0 0 auto;
          width: 96px; height: 96px; border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, #475569, #1e293b);
          color: #e2e8f0; font-weight: 700; font-size: 16px; letter-spacing: 1px;
          border: 3px solid #334155; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: transform 80ms ease, border-color 200ms;
        }
        .master-btn:hover { transform: scale(1.03); }
        .master-btn:active { transform: scale(0.97); }
        .master-btn.armed {
          background: radial-gradient(circle at 30% 30%, #ef4444, #7f1d1d);
          border-color: #fca5a5; color: #fff;
        }
        .master-pulse {
          position: absolute; inset: -3px; border-radius: 50%;
          border: 3px solid transparent; pointer-events: none;
        }
        .master-btn.armed .master-pulse {
          border-color: #fca5a5;
          animation: biaif-pulse 1.4s ease-out infinite;
        }
        @keyframes biaif-pulse {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        .master-label { z-index: 1; }
        .biaif-master-meta { display: flex; flex-direction: column; gap: 4px; }
        .biaif-timer {
          font: 700 22px/1 ui-monospace, Menlo, Consolas, monospace;
          color: #2bd4d9;
        }
        .biaif-session-info { font-size: 11px; color: #94a3b8; }

        /* Action buttons */
        .biaif-actions { display: flex; flex-direction: column; gap: 6px; }
        .biaif-btn {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 10px; border-radius: 6px;
          background: #1e293b; color: #e2e8f0; border: 1px solid #334155;
          cursor: pointer; font-size: 13px;
        }
        .biaif-btn.small { padding: 6px 8px; font-size: 12px; }
        .biaif-btn:hover { border-color: #2bd4d9; }
        .biaif-btn.active { background: #064e54; border-color: #2bd4d9; }
        .biaif-btn .dot {
          width: 8px; height: 8px; border-radius: 50%; background: #475569; flex: 0 0 auto;
        }
        .biaif-btn.active .dot { background: #2bd4d9; box-shadow: 0 0 0 4px rgba(43,212,217,0.2); }
        .biaif-btn .label { flex: 1; text-align: left; }
        kbd {
          font: 11px/1 ui-monospace, Consolas, monospace;
          background: #0f172a; color: #94a3b8;
          padding: 2px 5px; border-radius: 3px; border: 1px solid #334155;
        }

        .biaif-lang label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #94a3b8; }
        .biaif-lang select {
          background: #1e293b; color: #e2e8f0; border: 1px solid #334155;
          padding: 5px; border-radius: 4px; font: inherit;
        }

        /* Segments */
        .biaif-segments-wrap { flex: 1; overflow-y: auto; min-height: 100px; }
        .biaif-segments-wrap h2 { font-size: 12px; margin: 0 0 8px; color: #94a3b8; text-transform: uppercase; letter-spacing: .5px; }
        .biaif-empty { font-size: 12px; color: #64748b; font-style: italic; padding: 16px 0; text-align: center; }
        .biaif-segments { display: flex; flex-direction: column; gap: 8px; }
        .biaif-segment {
          background: #020617; border: 1px solid #1e293b; border-radius: 6px;
          padding: 8px;
        }
        .biaif-segment header {
          display: flex; align-items: center; gap: 6px; margin-bottom: 6px;
        }
        .seg-num { font: 700 12px/1 ui-monospace, Consolas, monospace; color: #2bd4d9; }
        .seg-tags { flex: 1; display: flex; gap: 4px; flex-wrap: wrap; }
        .seg-tags .tag {
          background: #064e54; color: #2bd4d9; border-radius: 10px;
          font-size: 10px; padding: 1px 7px; text-transform: lowercase;
        }
        .seg-del {
          background: transparent; border: 0; color: #94a3b8; cursor: pointer;
          font-size: 16px; line-height: 1; padding: 0 4px;
        }
        .seg-del:hover { color: #ef4444; }
        .seg-selector code {
          font: 11px/1.4 ui-monospace, Consolas, monospace;
          color: #5be8eb;
          word-break: break-all;
        }
        .seg-voice {
          margin-top: 6px; font-size: 12px; color: #cbd5e1;
          font-style: italic;
        }
        .seg-thumb {
          margin-top: 8px; max-width: 100%; max-height: 200px;
          border: 1px solid #334155; border-radius: 4px; display: block;
        }
        .seg-no-shot { margin-top: 6px; font-size: 11px; color: #64748b; }

        /* Notes textarea */
        .biaif-notes { display: flex; flex-direction: column; }
        .biaif-notes label {
          display: flex; flex-direction: column; gap: 6px;
          font-size: 11px; color: #94a3b8;
        }
        textarea {
          min-height: 60px; resize: vertical;
          background: #020617; color: #e2e8f0; border: 1px solid #334155;
          border-radius: 6px; padding: 8px; font: 12px/1.5 inherit;
        }
        textarea:focus { outline: 0; border-color: #2bd4d9; }
        .biaif-interim {
          margin-top: 4px; min-height: 16px;
          font-style: italic; color: #64748b; font-size: 11px;
        }

        /* Footer */
        .biaif-footer {
          display: flex; gap: 6px; padding: 10px 14px;
          border-top: 1px solid #1e293b; background: #0b1220;
          flex-wrap: wrap;
        }
        .biaif-btn.primary {
          background: #2bd4d9; color: #0f172a; border-color: #2bd4d9;
          font-weight: 600; flex: 1; justify-content: center;
        }
        .biaif-btn.primary:hover { background: #5be8eb; }
        .biaif-btn.ghost { background: transparent; }

        .biaif-status {
          padding: 6px 14px; font-size: 11px; min-height: 18px;
          border-top: 1px solid #1e293b;
        }
        .biaif-status[data-kind="success"] { color: #22c55e; }
        .biaif-status[data-kind="error"] { color: #ef4444; }
        .biaif-status[data-kind="info"] { color: #94a3b8; }
      `;
    },
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function dataUrlToBlob(dataUrl) {
    return fetch(dataUrl).then((r) => r.blob());
  }

  window.BIAIFSidebar = SidebarUI;
})(window, document);
