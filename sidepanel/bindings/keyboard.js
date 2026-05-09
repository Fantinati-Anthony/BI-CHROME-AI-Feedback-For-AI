/**
 * BIAIF Bindings — Keyboard
 *
 * Global keydown shortcuts:
 *   Ctrl/Cmd+Z          → undo
 *   Ctrl/Cmd+Shift+Z    → redo
 *   Ctrl+Y              → redo (Windows convention)
 *   Ctrl/Cmd+S          → save current demande (when armed)
 *   Ctrl/Cmd+N          → new conversation (when not armed)
 *   Ctrl/Cmd+K          → command palette (handled in palette.js — kept here for doc)
 *   Esc                 → contextual close
 */
(function (window) {
  'use strict';
  window.BIAIFBindings = window.BIAIFBindings || {};
  var ctx = window.BIAIFBindings.ctx;
  var H   = window.BIAIFBindings.helpers;

  function bind() {
    document.addEventListener('keydown', function (e) {
      var meta = e.ctrlKey || e.metaKey;

      // Undo / Redo — must come before single-key handlers
      if (meta && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) H.performRedo();
        else            H.performUndo();
        return;
      }
      if (e.ctrlKey && (e.key === 'y' || e.key === 'Y') && !e.shiftKey) {
        e.preventDefault(); H.performRedo(); return;
      }

      // Cmd+S — save current demande if armed, or save edit
      if (meta && (e.key === 's' || e.key === 'S') && !e.shiftKey) {
        e.preventDefault();
        if (ctx.STATE.armed && window.BIAIFSession) window.BIAIFSession.finalizeDemande(false);
        return;
      }

      // Cmd+N — new conversation if not in edit/new mode
      if (meta && (e.key === 'n' || e.key === 'N') && !e.shiftKey) {
        if (!ctx.STATE.armed) {
          e.preventDefault();
          var btn = document.querySelector('[data-act="new-conv"]');
          if (btn && !btn.disabled) btn.click();
        }
        return;
      }

      // Esc — contextual close (subline → edit mode → settings)
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
