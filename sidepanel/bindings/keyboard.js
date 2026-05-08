/**
 * BIAIF Bindings — Keyboard
 *
 * Global keydown handler. Currently:
 *   Ctrl/Cmd+Z       → undo
 *   Esc              → close capture subline / exit edit mode / close settings
 */
(function (window) {
  'use strict';
  window.BIAIFBindings = window.BIAIFBindings || {};
  var ctx = window.BIAIFBindings.ctx;
  var H   = window.BIAIFBindings.helpers;

  function bind() {
    document.addEventListener('keydown', function (e) {
      // Ctrl/Cmd+Z → Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        H.performUndo();
        return;
      }
      if (e.key === 'Escape') {
        var sub = document.querySelector('.quick-tools-subline');
        if (sub && !sub.hasAttribute('hidden')) { H.closeCaptureSubline(); return; }
        if (ctx.STATE.editingDemandeIdx !== null) { window.BIAIFSession.exitEditMode(); return; }
        var pop = ctx.REFS.settingsPopover;
        if (pop && !pop.hasAttribute('hidden')) { pop.setAttribute('hidden', ''); return; }
      }
    });
  }

  window.BIAIFBindings.keyboard = { bind: bind };
})(window);
