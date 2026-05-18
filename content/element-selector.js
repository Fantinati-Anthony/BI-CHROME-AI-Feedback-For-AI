/**
 * MyFb Element Selector (v0.2)
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

  const HOST_ID    = 'myfb-picker-host';
  const OVERLAY_ID = 'myfb-picker-overlay';
  const TAG_ID     = 'myfb-picker-tag';
  let _rafPending  = false;

  // chrome.runtime.sendMessage throws SYNCHRONOUSLY (not via the returned
  // promise) when the extension has been reloaded — the .catch() handler
  // does not catch synchronous throws. Wrap every call so a stale
  // content script doesn't leak "Extension context invalidated" errors
  // into the host page console.
  function _safeSend(msg) {
    try {
      var p = chrome.runtime.sendMessage(msg);
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (_) { /* extension reloaded — ignore */ }
  }

  const ElementSelector = {
    state: {
      active: false,
      lastTarget: null,
    },

    host:    null,   // Shadow root host (sees no host-page CSS)
    overlay: null,
    tag:     null,

    ensureOverlay() {
      if (this.overlay) return;
      // Host element + Shadow DOM — picker UI is fully isolated from
      // the visited page's CSS (no leaks in either direction).
      let host = document.getElementById(HOST_ID);
      if (!host) {
        host = document.createElement('div');
        host.id = HOST_ID;
        host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none';
        document.documentElement.appendChild(host);
      }
      const root = host.shadowRoot || host.attachShadow({ mode: 'closed' });

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

      root.appendChild(overlay);
      root.appendChild(tag);
      this.host    = host;
      this.overlay = overlay;
      this.tag     = tag;
    },

    isOverlayElement(el) {
      if (!el) return false;
      // Anything inside the picker host falls back to the host id check.
      if (el.id === HOST_ID || el.id === OVERLAY_ID || el.id === TAG_ID) return true;
      if (el.id === 'myfb-screenshot-loader') return true;
      if (el.id === 'myfb-shot-element-overlay' || el.id === 'myfb-shot-selection-overlay') return true;
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

        const sel = window.MyFbSelector.getUniqueSelector(target);
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

      const descriptor = window.MyFbSelector.describeElement(target);
      // Capture du screenshot croppé autour de l'élément (in-tab : on a le DOM).
      let screenshot = null;
      let metadata = null;
      try {
        if (window.MyFbScreenshot) {
          screenshot = await window.MyFbScreenshot.captureElement(target);
          metadata   = window.MyFbScreenshot.getMetadata();
        }
      } catch (err) {
        console.warn('[MyFb] capture KO :', err && err.message);
      }

      // descriptor._el (référence DOM) n'est pas sérialisable : on l'omet.
      _safeSend({
        type: 'myfb:element-picked',
        descriptor,
        screenshot,
        metadata,
      });

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

      _safeSend({ type: 'myfb:picker-state', active: true });
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

      _safeSend({ type: 'myfb:picker-state', active: false });
    },

    toggle() {
      this.state.active ? this.disable() : this.enable();
    },
  };

  window.MyFbElementSelector = ElementSelector;
})(window, document);
