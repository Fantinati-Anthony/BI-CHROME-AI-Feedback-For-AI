/**
 * BIAIF Sidebar UI
 *
 * Sidebar injectée dans la page (Shadow DOM) qui orchestre :
 *   - le sélecteur d'éléments
 *   - le micro (speech-to-text)
 *   - la composition du prompt pour l'IA (Claude Code)
 */

(function (window, document) {
  'use strict';

  const HOST_ID = 'biaif-sidebar-host';

  const SidebarUI = {
    state: {
      open: false,
      pickerActive: false,
      micActive: false,
      pickedElements: [],
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
      if (this.state.pickerActive) window.BIAIFElementSelector.disable();
      if (this.state.micActive) window.BIAIFVoiceRecorder.stop();
    },

    toggle() {
      this.state.open ? this.close() : this.open();
    },

    mount() {
      if (this.host) return;

      const host = document.createElement('div');
      host.id = HOST_ID;
      host.style.cssText = [
        'position:fixed',
        'top:0',
        'right:0',
        'width:380px',
        'max-width:100vw',
        'height:100vh',
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
      const $ = (sel) => this.shadow.querySelector(sel);
      this.refs = {
        closeBtn: $('[data-act="close"]'),
        pickerBtn: $('[data-act="picker"]'),
        micBtn: $('[data-act="mic"]'),
        clearBtn: $('[data-act="clear"]'),
        copyBtn: $('[data-act="copy"]'),
        textarea: $('textarea[name="notes"]'),
        interim: $('.biaif-interim'),
        chips: $('.biaif-chips'),
        status: $('.biaif-status'),
        langSelect: $('select[name="lang"]'),
      };
    },

    bindEvents() {
      this.refs.closeBtn.addEventListener('click', () => this.close());
      this.refs.pickerBtn.addEventListener('click', () => window.BIAIFElementSelector.toggle());
      this.refs.micBtn.addEventListener('click', () => window.BIAIFVoiceRecorder.toggle());
      this.refs.clearBtn.addEventListener('click', () => this.clearAll());
      this.refs.copyBtn.addEventListener('click', () => this.copyPrompt());
      this.refs.langSelect.addEventListener('change', (e) => {
        window.BIAIFVoiceRecorder.setLang(e.target.value);
      });

      document.addEventListener('biaif:element-picked', (e) => this.onElementPicked(e.detail));
      document.addEventListener('biaif:picker-state', (e) => this.onPickerState(e.detail.active));
      document.addEventListener('biaif:voice-state', (e) => this.onVoiceState(e.detail.active));
      document.addEventListener('biaif:voice-transcript', (e) => this.onVoiceTranscript(e.detail.text));
      document.addEventListener('biaif:voice-interim', (e) => {
        this.refs.interim.textContent = e.detail.text || '';
      });
      document.addEventListener('biaif:voice-error', (e) => {
        this.setStatus('Micro : ' + e.detail.error, 'error');
      });
    },

    onPickerState(active) {
      this.state.pickerActive = active;
      this.refs.pickerBtn.classList.toggle('active', active);
      this.refs.pickerBtn.querySelector('.label').textContent = active ? 'Picker actif (Esc)' : "Sélecteur d'élément";
      this.setStatus(active ? 'Cliquez un élément. Maintenez Ctrl pour multi-pick.' : '', 'info');
    },

    onVoiceState(active) {
      this.state.micActive = active;
      this.refs.micBtn.classList.toggle('active', active);
      this.refs.micBtn.querySelector('.label').textContent = active ? 'Micro actif (cliquer pour stopper)' : 'Démarrer le micro';
      if (!active) this.refs.interim.textContent = '';
    },

    onElementPicked(descriptor) {
      if (!descriptor) return;
      this.state.pickedElements.push(descriptor);
      this.renderChips();
      this.insertAtCursor('`' + descriptor.selector + '` ');
      this.setStatus('Élément capturé : ' + descriptor.selector, 'success');
    },

    onVoiceTranscript(text) {
      if (!text) return;
      this.insertAtCursor(text + ' ');
    },

    insertAtCursor(text) {
      const ta = this.refs.textarea;
      ta.focus();
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
      const pos = start + text.length;
      ta.selectionStart = ta.selectionEnd = pos;
    },

    renderChips() {
      this.refs.chips.innerHTML = '';
      this.state.pickedElements.forEach((el, i) => {
        const chip = document.createElement('span');
        chip.className = 'biaif-chip';
        chip.title = el.selector;
        chip.innerHTML = `
          <code>${escapeHtml(el.selector)}</code>
          <button data-i="${i}" aria-label="Retirer">×</button>
        `;
        chip.querySelector('button').addEventListener('click', (e) => {
          const idx = Number(e.currentTarget.dataset.i);
          this.state.pickedElements.splice(idx, 1);
          this.renderChips();
        });
        this.refs.chips.appendChild(chip);
      });
    },

    clearAll() {
      this.state.pickedElements = [];
      this.refs.textarea.value = '';
      this.refs.interim.textContent = '';
      this.renderChips();
      window.BIAIFVoiceRecorder.reset();
      this.setStatus('Réinitialisé.', 'info');
    },

    buildPrompt() {
      const notes = this.refs.textarea.value.trim();
      const url = window.location.href;
      const title = document.title;

      const lines = [];
      lines.push('# Demande de modification');
      lines.push('');
      lines.push(`**Page :** ${title}`);
      lines.push(`**URL :** ${url}`);
      lines.push('');

      if (this.state.pickedElements.length) {
        lines.push('## Éléments ciblés');
        lines.push('');
        this.state.pickedElements.forEach((el, i) => {
          lines.push(`### ${i + 1}. \`${el.selector}\``);
          if (el.tag) lines.push(`- **tag :** \`<${el.tag}>\``);
          if (el.id) lines.push(`- **id :** \`${el.id}\``);
          if (el.classes && el.classes.length) {
            lines.push(`- **classes :** \`${el.classes.join(' ')}\``);
          }
          if (el.text) lines.push(`- **texte visible :** « ${el.text} »`);
          if (el.box) lines.push(`- **position (px) :** x=${el.box.x}, y=${el.box.y}, w=${el.box.w}, h=${el.box.h}`);
          if (el.outerHTML) {
            lines.push('');
            lines.push('```html');
            lines.push(el.outerHTML);
            lines.push('```');
          }
          lines.push('');
        });
      }

      lines.push('## Description (voix + texte)');
      lines.push('');
      lines.push(notes || '_(aucune description fournie)_');
      lines.push('');
      lines.push('---');
      lines.push("Merci de proposer les modifications correspondantes (HTML/CSS/JS), de référencer les sélecteurs ci-dessus et d'expliquer les changements.");

      return lines.join('\n');
    },

    async copyPrompt() {
      const text = this.buildPrompt();
      try {
        await navigator.clipboard.writeText(text);
        this.setStatus('Prompt copié — collez-le dans Claude Code.', 'success');
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); this.setStatus('Prompt copié.', 'success'); }
        catch (_) { this.setStatus('Impossible de copier : ' + e.message, 'error'); }
        ta.remove();
      }
    },

    setStatus(msg, kind) {
      this.refs.status.textContent = msg || '';
      this.refs.status.dataset.kind = kind || 'info';
    },

    template() {
      return `
        <style>${this.css()}</style>
        <div class="biaif-root">
          <header>
            <h1>BI AI Feedback</h1>
            <button class="icon-btn" data-act="close" title="Fermer (Alt+Shift+F)">×</button>
          </header>

          <section class="biaif-actions">
            <button class="biaif-btn" data-act="picker">
              <span class="dot"></span><span class="label">Sélecteur d'élément</span>
              <kbd>Alt+⇧+E</kbd>
            </button>
            <button class="biaif-btn" data-act="mic">
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

          <section class="biaif-chips" aria-label="Éléments capturés"></section>

          <section class="biaif-notes">
            <label>
              Notes pour l'IA (texte + voix)
              <textarea name="notes" placeholder="Décrivez ce que vous voulez modifier. Cliquez les éléments dans la page pour insérer leur sélecteur ici. Maintenez Ctrl pendant un clic pour en capturer plusieurs."></textarea>
            </label>
            <div class="biaif-interim" aria-live="polite"></div>
          </section>

          <footer>
            <button class="biaif-btn ghost" data-act="clear">Effacer tout</button>
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
          display: flex; flex-direction: column;
          height: 100%;
          font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #e2e8f0;
          background: #0f172a;
        }
        header {
          display:flex; align-items:center; justify-content:space-between;
          padding: 12px 14px; border-bottom: 1px solid #1e293b;
          background: linear-gradient(135deg,#0ea5b7,#1e293b);
        }
        header h1 { font-size: 14px; margin: 0; letter-spacing: .3px; }
        .icon-btn {
          background: transparent; color: #e2e8f0; border: 0;
          font-size: 22px; line-height: 1; cursor: pointer; padding: 0 4px;
        }
        .icon-btn:hover { color: #2bd4d9; }
        section { padding: 10px 14px; }
        .biaif-actions { display: flex; flex-direction: column; gap: 8px; }
        .biaif-btn {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 10px; border-radius: 6px;
          background: #1e293b; color: #e2e8f0; border: 1px solid #334155;
          cursor: pointer; font-size: 13px;
        }
        .biaif-btn:hover { border-color: #2bd4d9; }
        .biaif-btn.active { background: #064e54; border-color: #2bd4d9; }
        .biaif-btn .dot {
          width: 8px; height: 8px; border-radius: 50%; background: #475569;
          flex: 0 0 auto;
        }
        .biaif-btn.active .dot { background: #2bd4d9; box-shadow: 0 0 0 4px rgba(43,212,217,0.2); }
        .biaif-btn .label { flex: 1; text-align: left; }
        kbd {
          font: 11px/1 ui-monospace, Consolas, monospace;
          background: #0f172a; color: #94a3b8;
          padding: 2px 5px; border-radius: 3px; border: 1px solid #334155;
        }
        .biaif-lang label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #94a3b8; }
        .biaif-lang select {
          background: #1e293b; color: #e2e8f0; border: 1px solid #334155;
          padding: 6px; border-radius: 4px; font: inherit;
        }
        .biaif-chips { display: flex; flex-wrap: wrap; gap: 6px; min-height: 0; }
        .biaif-chip {
          display: inline-flex; align-items: center; gap: 6px;
          background: #1e293b; border: 1px solid #334155;
          padding: 3px 4px 3px 8px; border-radius: 12px;
          font-size: 11px; max-width: 100%;
        }
        .biaif-chip code {
          font: 11px/1.3 ui-monospace, Consolas, monospace;
          color: #2bd4d9;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          max-width: 240px;
        }
        .biaif-chip button {
          background: transparent; border: 0; color: #94a3b8; cursor: pointer;
          font-size: 14px; line-height: 1; padding: 0 4px;
        }
        .biaif-chip button:hover { color: #ef4444; }
        .biaif-notes { flex: 1; display: flex; flex-direction: column; min-height: 0; }
        .biaif-notes label {
          display: flex; flex-direction: column; gap: 6px;
          font-size: 12px; color: #94a3b8; height: 100%;
        }
        textarea {
          flex: 1; min-height: 120px; resize: vertical;
          background: #020617; color: #e2e8f0; border: 1px solid #334155;
          border-radius: 6px; padding: 10px; font: 13px/1.5 inherit;
        }
        textarea:focus { outline: 0; border-color: #2bd4d9; }
        .biaif-interim {
          margin-top: 6px; min-height: 18px;
          font-style: italic; color: #64748b; font-size: 12px;
        }
        footer {
          display: flex; gap: 8px; padding: 10px 14px;
          border-top: 1px solid #1e293b; background: #0b1220;
        }
        .biaif-btn.primary {
          background: #2bd4d9; color: #0f172a; border-color: #2bd4d9;
          font-weight: 600; flex: 1; justify-content: center;
        }
        .biaif-btn.primary:hover { background: #5be8eb; }
        .biaif-btn.ghost { background: transparent; }
        .biaif-status {
          padding: 8px 14px; font-size: 12px; min-height: 20px;
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
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.BIAIFSidebar = SidebarUI;
})(window, document);
