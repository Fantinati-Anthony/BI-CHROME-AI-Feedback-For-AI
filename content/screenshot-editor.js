/**
 * BIAIF Screenshot Editor — adapté de wp-blazing-minds/screenshot-editor.js
 *
 * Annotateur canvas pour les captures BIAIF :
 *   - Outils : pen, ligne, flèche, rectangle, ellipse, texte
 *   - Choix couleur + taille
 *   - Undo (jusqu'à 20 états), Clear (revient à l'image originale)
 *   - Touch support
 *   - Tout rendu dans un modal Shadow DOM (zéro conflit CSS avec la page hôte)
 *
 * Usage :
 *   const newDataUrl = await BIAIFScreenshotEditor.open(dataUrl);
 *   // newDataUrl === null si l'utilisateur annule
 */

(function (window, document) {
  'use strict';

  const HOST_ID = 'biaif-editor-host';

  const Editor = {
    state: {
      open: false,
      tool: 'pen',
      color: '#e74c3c',
      size: 4,
      drawing: false,
      startX: 0,
      startY: 0,
      history: [],
      historyIndex: -1,
      original: null,
      resolve: null,
    },
    host: null,
    shadow: null,
    canvas: null,
    ctx: null,
    refs: {},

    /**
     * Ouvre l'éditeur sur l'image donnée. Renvoie une Promise qui
     * résout sur le nouveau dataURL (ou null si annulé).
     */
    open(dataUrl) {
      return new Promise((resolve) => {
        this.state.resolve = resolve;
        this.mount();
        this.state.open = true;
        this.host.style.display = 'block';
        this.loadImage(dataUrl);
      });
    },

    close(result = null) {
      this.state.open = false;
      if (this.host) this.host.style.display = 'none';
      this.state.history = [];
      this.state.historyIndex = -1;
      this.state.original = null;
      const cb = this.state.resolve;
      this.state.resolve = null;
      if (cb) cb(result);
    },

    mount() {
      if (this.host) return;
      const host = document.createElement('div');
      host.id = HOST_ID;
      host.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:2147483646',
        'display:none',
      ].join(';');
      // Closed shadow root: host-page CSS / scripts cannot reach into
      // our annotator UI (consistent with content/element-selector.js).
      const shadow = host.attachShadow({ mode: 'closed' });
      shadow.innerHTML = this.template();
      document.documentElement.appendChild(host);

      this.host = host;
      this.shadow = shadow;
      this.canvas = shadow.querySelector('canvas');
      this.ctx = this.canvas.getContext('2d');
      this.cacheRefs();
      this.bindEvents();
    },

    cacheRefs() {
      const $ = (s) => this.shadow.querySelector(s);
      const $$ = (s) => this.shadow.querySelectorAll(s);
      this.refs = {
        overlay:  $('.editor-overlay'),
        modal:    $('.editor-modal'),
        toolBtns: $$('.tool-btn'),
        color:    $('input[type=color]'),
        size:     $('select[name=size]'),
        undo:     $('[data-act=undo]'),
        clear:    $('[data-act=clear]'),
        cancel:   $('[data-act=cancel]'),
        save:     $('[data-act=save]'),
        wrap:     $('.canvas-wrap'),
        sizeLabel:$('.size-label'),
      };
    },

    bindEvents() {
      this.refs.toolBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.state.tool = btn.dataset.tool;
          this.refs.toolBtns.forEach((b) => b.classList.toggle('active', b === btn));
        });
      });
      this.refs.color.addEventListener('change', (e) => { this.state.color = e.target.value; });
      this.refs.size.addEventListener('change', (e) => {
        this.state.size = parseInt(e.target.value, 10);
        this.refs.sizeLabel.textContent = this.state.size + ' px';
      });
      this.refs.undo.addEventListener('click', () => this.undo());
      this.refs.clear.addEventListener('click', () => this.clearAll());
      this.refs.cancel.addEventListener('click', () => this.close(null));
      this.refs.save.addEventListener('click', () => this.save());
      this.refs.overlay.addEventListener('click', (e) => {
        if (e.target === this.refs.overlay) this.close(null);
      });
      window.addEventListener('keydown', (e) => {
        if (!this.state.open) return;
        if (e.key === 'Escape') { e.preventDefault(); this.close(null); }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault(); this.undo();
        }
      }, true);

      // Canvas events
      const c = this.canvas;
      c.addEventListener('mousedown', (e) => this.onDown(e));
      c.addEventListener('mousemove', (e) => this.onMove(e));
      c.addEventListener('mouseup',   (e) => this.onUp(e));
      c.addEventListener('mouseleave',(e) => this.onUp(e));
      c.addEventListener('touchstart', (e) => this.onTouch('mousedown', e), { passive: false });
      c.addEventListener('touchmove',  (e) => this.onTouch('mousemove', e), { passive: false });
      c.addEventListener('touchend',   (e) => this.onTouch('mouseup', e), { passive: false });
    },

    loadImage(dataUrl) {
      const img = new Image();
      img.onload = () => {
        this.state.original = img;
        this.canvas.width = img.width;
        this.canvas.height = img.height;
        this.fitCanvasToWrap();
        this.ctx.drawImage(img, 0, 0, img.width, img.height);
        this.state.history = [];
        this.state.historyIndex = -1;
        this.saveState();
      };
      img.onerror = () => this.close(null);
      img.src = dataUrl;
    },

    /**
     * Redimensionne le canvas à l'écran (CSS) pour rentrer dans le wrap
     * tout en gardant la résolution originale en interne.
     */
    fitCanvasToWrap() {
      const wrap = this.refs.wrap;
      const maxW = wrap.clientWidth - 16;
      const maxH = wrap.clientHeight - 16;
      const scale = Math.min(maxW / this.canvas.width, maxH / this.canvas.height, 1);
      this.canvas.style.width = Math.floor(this.canvas.width * scale) + 'px';
      this.canvas.style.height = Math.floor(this.canvas.height * scale) + 'px';
    },

    save() {
      if (!this.canvas) return;
      const dataUrl = this.canvas.toDataURL('image/png');
      this.close(dataUrl);
    },

    // -------------------------------------------------------------------
    // Drawing
    // -------------------------------------------------------------------

    getPos(e) {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },

    onDown(e) {
      e.preventDefault();
      this.state.drawing = true;
      const p = this.getPos(e);
      this.state.startX = p.x; this.state.startY = p.y;
      if (this.state.tool === 'pen') {
        this.ctx.beginPath();
        this.ctx.moveTo(p.x, p.y);
      } else if (this.state.tool === 'text') {
        this.addText(p.x, p.y);
        this.state.drawing = false;
      }
    },

    onMove(e) {
      if (!this.state.drawing) return;
      e.preventDefault();
      const p = this.getPos(e);
      if (this.state.tool === 'pen') {
        this.drawPen(p.x, p.y);
      } else {
        this.restoreState();
        this.drawShape(p.x, p.y);
      }
    },

    onUp(e) {
      if (!this.state.drawing) return;
      this.state.drawing = false;
      if (this.state.tool !== 'pen') {
        const p = this.getPos(e);
        this.restoreState();
        this.drawShape(p.x, p.y);
      }
      this.saveState();
    },

    onTouch(type, e) {
      e.preventDefault();
      const t = e.touches[0] || e.changedTouches[0];
      const me = new MouseEvent(type, {
        clientX: t ? t.clientX : 0,
        clientY: t ? t.clientY : 0,
      });
      if (type === 'mousedown') this.onDown(me);
      else if (type === 'mousemove') this.onMove(me);
      else this.onUp(me);
    },

    drawPen(x, y) {
      this.ctx.lineWidth = this.state.size;
      this.ctx.lineCap = 'round';
      this.ctx.strokeStyle = this.state.color;
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
    },

    drawShape(endX, endY) {
      this.ctx.strokeStyle = this.state.color;
      this.ctx.lineWidth = this.state.size;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      const sx = this.state.startX, sy = this.state.startY;
      const w = endX - sx, h = endY - sy;

      switch (this.state.tool) {
        case 'line':
          this.ctx.beginPath();
          this.ctx.moveTo(sx, sy);
          this.ctx.lineTo(endX, endY);
          this.ctx.stroke();
          break;
        case 'arrow':
          this.drawArrow(sx, sy, endX, endY);
          break;
        case 'rect':
          this.ctx.beginPath();
          this.ctx.strokeRect(sx, sy, w, h);
          break;
        case 'circle': {
          const cx = sx + w / 2, cy = sy + h / 2;
          this.ctx.beginPath();
          this.ctx.ellipse(cx, cy, Math.abs(w / 2), Math.abs(h / 2), 0, 0, 2 * Math.PI);
          this.ctx.stroke();
          break;
        }
        case 'highlight': {
          this.ctx.save();
          this.ctx.globalAlpha = 0.35;
          this.ctx.fillStyle = this.state.color;
          this.ctx.fillRect(sx, sy, w, h);
          this.ctx.restore();
          break;
        }
      }
    },

    drawArrow(fromX, fromY, toX, toY) {
      const head = Math.max(10, this.state.size * 3);
      const angle = Math.atan2(toY - fromY, toX - fromX);
      this.ctx.beginPath();
      this.ctx.moveTo(fromX, fromY);
      this.ctx.lineTo(toX, toY);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.moveTo(toX, toY);
      this.ctx.lineTo(toX - head * Math.cos(angle - Math.PI / 6), toY - head * Math.sin(angle - Math.PI / 6));
      this.ctx.moveTo(toX, toY);
      this.ctx.lineTo(toX - head * Math.cos(angle + Math.PI / 6), toY - head * Math.sin(angle + Math.PI / 6));
      this.ctx.stroke();
    },

    addText(x, y) {
      const text = window.prompt('Texte de l\'annotation :');
      if (!text) return;
      this.ctx.font = `${this.state.size * 4}px -apple-system, Segoe UI, sans-serif`;
      this.ctx.fillStyle = this.state.color;
      this.ctx.textBaseline = 'top';
      this.ctx.fillText(text, x, y);
      this.saveState();
    },

    saveState() {
      this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
      this.state.history.push(this.canvas.toDataURL());
      this.state.historyIndex = this.state.history.length - 1;
      if (this.state.history.length > 20) {
        this.state.history.shift();
        this.state.historyIndex--;
      }
    },

    restoreState() {
      const dataUrl = this.state.history[this.state.historyIndex];
      if (!dataUrl) return;
      const img = new Image();
      img.src = dataUrl;
      // Image déjà chargée car déjà créée localement → on peut dessiner sync
      // après onload (synchrone via cache des dataURL data:image/png).
      if (img.complete && img.width) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(img, 0, 0);
      } else {
        img.onload = () => {
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
          this.ctx.drawImage(img, 0, 0);
        };
      }
    },

    undo() {
      if (this.state.historyIndex <= 0) return;
      this.state.historyIndex--;
      const img = new Image();
      img.onload = () => {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(img, 0, 0);
      };
      img.src = this.state.history[this.state.historyIndex];
    },

    clearAll() {
      if (!this.state.original) return;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(this.state.original, 0, 0, this.state.original.width, this.state.original.height);
      this.saveState();
    },

    // -------------------------------------------------------------------
    // Template & styles
    // -------------------------------------------------------------------

    template() {
      const tools = [
        ['pen',       '✏️',  'Crayon'],
        ['line',      '╱',   'Ligne'],
        ['arrow',     '➤',   'Flèche'],
        ['rect',      '▭',   'Rectangle'],
        ['circle',    '◯',   'Ellipse'],
        ['highlight', '▥',   'Surligneur'],
        ['text',      'T',   'Texte'],
      ].map(([id, ico, label]) => `
        <button class="tool-btn ${id === 'pen' ? 'active' : ''}" data-tool="${id}" title="${label}">
          <span class="tool-ico">${ico}</span>
        </button>
      `).join('');

      return `
        <style>${this.css()}</style>
        <div class="editor-overlay">
          <div class="editor-modal" role="dialog" aria-label="Annoter la capture">
            <header class="editor-header">
              <h2>Annoter la capture</h2>
              <button class="hbtn" data-act="cancel" title="Fermer (Échap)">×</button>
            </header>

            <div class="editor-toolbar">
              <div class="tool-group">${tools}</div>

              <div class="tool-group">
                <label class="picker">
                  Couleur
                  <input type="color" value="#e74c3c" />
                </label>
                <label class="picker">
                  Taille <span class="size-label">4 px</span>
                  <select name="size">
                    <option value="2">Fin</option>
                    <option value="4" selected>Moyen</option>
                    <option value="8">Gras</option>
                    <option value="14">Énorme</option>
                  </select>
                </label>
              </div>

              <div class="tool-group right">
                <button class="ghost" data-act="undo" title="Annuler (Ctrl/Cmd+Z)">↶ Undo</button>
                <button class="ghost" data-act="clear" title="Tout effacer">⟲ Reset</button>
                <button class="ghost" data-act="cancel">Annuler</button>
                <button class="primary" data-act="save">Enregistrer</button>
              </div>
            </div>

            <div class="canvas-wrap">
              <canvas></canvas>
            </div>
          </div>
        </div>
      `;
    },

    css() {
      return `
        :host { all: initial; }
        * { box-sizing: border-box; }
        .editor-overlay {
          position: fixed; inset: 0;
          background: rgba(2, 6, 23, 0.85);
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .editor-modal {
          background: #0f172a; color: #e2e8f0;
          width: min(96vw, 1400px); height: min(94vh, 900px);
          border-radius: 10px; border: 1px solid #1e293b;
          display: flex; flex-direction: column;
          box-shadow: 0 25px 60px rgba(0,0,0,0.55);
          overflow: hidden;
        }
        .editor-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px; border-bottom: 1px solid #1e293b;
          background: linear-gradient(135deg,#0ea5b7,#1e293b);
        }
        .editor-header h2 { margin: 0; font-size: 14px; }
        .hbtn {
          background: transparent; border: 0; color: #e2e8f0;
          font-size: 22px; line-height: 1; cursor: pointer; padding: 0 4px;
        }
        .hbtn:hover { color: #2bd4d9; }

        .editor-toolbar {
          display: flex; flex-wrap: wrap; gap: 12px;
          padding: 8px 12px;
          background: #0b1220;
          border-bottom: 1px solid #1e293b;
          align-items: center;
        }
        .tool-group { display: flex; gap: 4px; align-items: center; }
        .tool-group.right { margin-left: auto; }

        .tool-btn {
          width: 34px; height: 34px;
          background: #1e293b; color: #e2e8f0;
          border: 1px solid #334155; border-radius: 6px;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          font-size: 16px;
        }
        .tool-btn:hover { border-color: #2bd4d9; }
        .tool-btn.active {
          background: #064e54; border-color: #2bd4d9; color: #2bd4d9;
        }

        .picker {
          display: flex; align-items: center; gap: 6px;
          font-size: 11px; color: #94a3b8;
        }
        .picker input[type=color] {
          width: 32px; height: 28px; border: 1px solid #334155;
          background: #1e293b; border-radius: 4px; cursor: pointer; padding: 1px;
        }
        .picker select {
          background: #1e293b; color: #e2e8f0; border: 1px solid #334155;
          border-radius: 4px; padding: 4px 6px; font: inherit;
        }
        .size-label { color: #2bd4d9; font: 600 11px ui-monospace, Consolas, monospace; }

        button.ghost, button.primary {
          padding: 6px 12px; border-radius: 6px; cursor: pointer;
          border: 1px solid #334155; background: #1e293b; color: #e2e8f0;
          font: 600 12px inherit;
        }
        button.ghost:hover { border-color: #2bd4d9; }
        button.primary {
          background: #2bd4d9; border-color: #2bd4d9; color: #0f172a;
        }
        button.primary:hover { background: #5be8eb; }

        .canvas-wrap {
          flex: 1; min-height: 0; overflow: auto;
          display: flex; align-items: center; justify-content: center;
          background:
            linear-gradient(45deg, #0a0f1c 25%, transparent 25%),
            linear-gradient(-45deg, #0a0f1c 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #0a0f1c 75%),
            linear-gradient(-45deg, transparent 75%, #0a0f1c 75%);
          background-size: 20px 20px;
          background-position: 0 0, 0 10px, 10px -10px, -10px 0;
          padding: 8px;
        }
        canvas {
          background: #fff;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5);
          cursor: crosshair;
          max-width: 100%; max-height: 100%;
        }
      `;
    },
  };

  window.BIAIFScreenshotEditor = Editor;
})(window, document);
