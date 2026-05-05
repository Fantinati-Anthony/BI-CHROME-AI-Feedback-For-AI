/**
 * BIAIF Element Selector (v0.2)
 *
 * Picker au survol et capture au clic. Au lieu de dispatcher des
 * CustomEvent dans la page (l'ancienne sidebar était dans la page,
 * maintenant elle est dans chrome.sidePanel donc dans un autre
 * contexte d'extension), on émet directement vers le SW via
 * chrome.runtime.sendMessage.
 *
 * On capture aussi le screenshot CROPPÉ ici, au moment du clic, parce
 * que le content script a accès au DOM live de l'élément.
 */

(function (window, document) {
  'use strict';

  const OVERLAY_ID = 'biaif-picker-overlay';
  const TAG_ID     = 'biaif-picker-tag';
  let _rafPending  = false;

  const ElementSelector = {
    state: {
      active: false,
      lastTarget: null,
    },

    overlay: null,
    tag: null,

    ensureOverlay() {
      if (this.overlay) return;
      const overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.style.cssText = [
        'position:fixed', 'pointer-events:none',
        'z-index:2147483646',
        'border:2px solid #2bd4d9',
        'background:rgba(43,212,217,0.15)',
        'box-shadow:0 0 0 9999px rgba(0,0,0,0.05)',
        'transition:all 60ms linear',
        'display:none',
      ].join(';');

      const tag = document.createElement('div');
      tag.id = TAG_ID;
      tag.style.cssText = [
        'position:fixed', 'pointer-events:none',
        'z-index:2147483647',
        'background:#0f172a', 'color:#e2e8f0',
        'font:12px/1.4 ui-monospace,Menlo,Consolas,monospace',
        'padding:4px 8px', 'border-radius:4px',
        'max-width:60vw', 'white-space:nowrap',
        'overflow:hidden', 'text-overflow:ellipsis',
        'display:none',
      ].join(';');

      document.documentElement.appendChild(overlay);
      document.documentElement.appendChild(tag);
      this.overlay = overlay;
      this.tag = tag;
    },

    isOverlayElement(el) {
      if (!el) return false;
      if (el.id === OVERLAY_ID || el.id === TAG_ID) return true;
      if (el.id === 'biaif-screenshot-loader') return true;
      if (el.id === 'biaif-shot-element-overlay' || el.id === 'biaif-shot-selection-overlay') return true;
      return false;
    },

    onMouseMove: function (e) {
      if (!ElementSelector.state.active) return;
      const target = e.target;
      if (_rafPending) return;
      _rafPending = true;
      requestAnimationFrame(function () {
        _rafPending = false;
        if (!ElementSelector.state.active) return;
        if (!target || ElementSelector.isOverlayElement(target)) {
          ElementSelector.overlay.style.display = 'none';
          ElementSelector.tag.style.display = 'none';
          return;
        }
        ElementSelector.state.lastTarget = target;

        const rect = target.getBoundingClientRect();
        ElementSelector.overlay.style.display = 'block';
        ElementSelector.overlay.style.left   = rect.left + 'px';
        ElementSelector.overlay.style.top    = rect.top  + 'px';
        ElementSelector.overlay.style.width  = rect.width  + 'px';
        ElementSelector.overlay.style.height = rect.height + 'px';

        const sel = window.BIAIFSelector.getUniqueSelector(target);
        ElementSelector.tag.textContent = sel;
        ElementSelector.tag.style.display = 'block';
        const tagTop = rect.top - 24 < 4 ? rect.bottom + 4 : rect.top - 24;
        ElementSelector.tag.style.left = Math.max(4, rect.left) + 'px';
        ElementSelector.tag.style.top  = tagTop + 'px';
      });
    },

    onClickCapture: async function (e) {
      if (!ElementSelector.state.active) return;
      const target = e.target;
      if (ElementSelector.isOverlayElement(target)) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const descriptor = window.BIAIFSelector.describeElement(target);
      // Capture du screenshot croppé autour de l'élément (in-tab : on a le DOM).
      let screenshot = null;
      let metadata = null;
      try {
        if (window.BIAIFScreenshot) {
          screenshot = await window.BIAIFScreenshot.captureElement(target);
          metadata   = window.BIAIFScreenshot.getMetadata();
        }
      } catch (err) {
        console.warn('[BIAIF] capture KO :', err && err.message);
      }

      // descriptor._el (référence DOM) n'est pas sérialisable : on l'omet.
      chrome.runtime.sendMessage({
        type: 'biaif:element-picked',
        descriptor,
        screenshot,
        metadata,
      }).catch(() => {});

      // Multi-pick par défaut : on reste actif. Échap, le bouton picker du
      // panel ou le STOP master pour quitter.
    },

    onKeyDown: function (e) {
      if (!ElementSelector.state.active) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        ElementSelector.disable();
      }
    },

    enable() {
      if (this.state.active) return;
      this.ensureOverlay();
      this.state.active = true;
      document.documentElement.style.cursor = 'crosshair';

      document.addEventListener('mousemove', this.onMouseMove,    true);
      document.addEventListener('click',     this.onClickCapture, true);
      document.addEventListener('keydown',   this.onKeyDown,      true);

      chrome.runtime.sendMessage({ type: 'biaif:picker-state', active: true }).catch(() => {});
    },

    disable() {
      if (!this.state.active) return;
      this.state.active = false;
      document.documentElement.style.cursor = '';

      if (this.overlay) this.overlay.style.display = 'none';
      if (this.tag)     this.tag.style.display     = 'none';

      document.removeEventListener('mousemove', this.onMouseMove,    true);
      document.removeEventListener('click',     this.onClickCapture, true);
      document.removeEventListener('keydown',   this.onKeyDown,      true);

      chrome.runtime.sendMessage({ type: 'biaif:picker-state', active: false }).catch(() => {});
    },

    toggle() {
      this.state.active ? this.disable() : this.enable();
    },
  };

  window.BIAIFElementSelector = ElementSelector;
})(window, document);
