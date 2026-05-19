/**
 * MyFb Bindings — Keyboard
 *
 * Global keydown shortcuts:
 *   Ctrl/Cmd+Z          → undo
 *   Ctrl/Cmd+Shift+Z    → redo
 *   Ctrl+Y              → redo (Windows convention)
 *   Ctrl/Cmd+S          → save current demande (when armed)
 *   Ctrl/Cmd+N          → new conversation (when not armed)
 *   Ctrl/Cmd+K          → command palette (handled in palette.js — kept here for doc)
 *   Esc                 → contextual close
 *
 * Mode-aware shortcuts (mic + picker), governed by STATE.shortcutMode:
 *   Alt+Shift+M         → toggle/hold/smart mic     (uses MyFbSpeech.toggle/start/stop)
 *   Alt+Shift+E         → toggle/hold/smart picker  (uses PICKER_TOGGLE message)
 *
 * Mode semantics:
 *   - 'toggle': keydown → toggle. Keyup ignored. (Classic on/off click.)
 *   - 'hold'  : keydown → toggle (start). Keyup → toggle (stop). Always paired.
 *   - 'smart' : keydown → toggle. Keyup → toggle ONLY if held >= 250 ms.
 *               Quick tap behaves like a toggle (stays on); long press behaves
 *               like push-to-talk (auto-stops on release).
 *
 * Mode-aware listeners only fire when the sidepanel has focus. When triggered
 * from outside (page focus), the chrome.commands fallback always toggles.
 */
(function (window) {
  'use strict';
  window.MyFbBindings = window.MyFbBindings || {};
  var ctx = window.MyFbBindings.ctx;
  var H   = window.MyFbBindings.helpers;

  var SMART_THRESHOLD_MS = 250;

  // Per-action timing state. null when key is up.
  var _press = { mic: null, picker: null };

  function _isAltShift(e, key) {
    return e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey &&
      (e.key === key || e.key === key.toLowerCase() || e.code === 'Key' + key);
  }

  function _toggleMic() {
    if (window.MyFbSpeech && window.MyFbSpeech.toggleMic) window.MyFbSpeech.toggleMic();
  }
  function _togglePicker() {
    H.sendBg && H.sendBg({ type: H.msgKey('PICKER_TOGGLE') });
  }

  function _onActionKeyDown(action, toggleFn, e) {
    if (e.repeat) { e.preventDefault(); return; }
    e.preventDefault();
    _press[action] = Date.now();
    toggleFn();
  }

  function _onActionKeyUp(action, toggleFn, e) {
    var pressedAt = _press[action];
    if (pressedAt == null) return;
    _press[action] = null;
    e.preventDefault();
    var mode = (ctx.STATE && ctx.STATE.shortcutMode) || 'smart';
    if (mode === 'toggle') return; // ignore keyup
    var held = Date.now() - pressedAt;
    if (mode === 'hold' || (mode === 'smart' && held >= SMART_THRESHOLD_MS)) {
      toggleFn();
    }
  }

  function bind() {
    document.addEventListener('keydown', function (e) {
      var meta = e.ctrlKey || e.metaKey;

      // ── Mode-aware: Alt+Shift+M (mic), Alt+Shift+E (picker) ──
      if (_isAltShift(e, 'M')) { _onActionKeyDown('mic',    _toggleMic,    e); return; }
      if (_isAltShift(e, 'E')) { _onActionKeyDown('picker', _togglePicker, e); return; }

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
        if (ctx.STATE.armed && window.MyFbSession) window.MyFbSession.finalizeDemande(false);
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
        var sub = document.getElementById('capture-subline');
        if (sub && !sub.hasAttribute('hidden')) { H.closeCaptureSubline(); return; }
        if (ctx.STATE.editingDemandeIdx !== null) { window.MyFbSession.exitEditMode(); return; }
        var pop = ctx.REFS.settingsPopover;
        if (pop && !pop.hasAttribute('hidden')) { pop.setAttribute('hidden', ''); return; }
      }
    });

    document.addEventListener('keyup', function (e) {
      // Match by code so releasing Alt/Shift first doesn't strand the press
      // state (we only check the letter key).
      if (e.code === 'KeyM' || e.key === 'm' || e.key === 'M') {
        if (_press.mic != null) _onActionKeyUp('mic', _toggleMic, e);
      }
      if (e.code === 'KeyE' || e.key === 'e' || e.key === 'E') {
        if (_press.picker != null) _onActionKeyUp('picker', _togglePicker, e);
      }
    });

    // Safety: if window loses focus mid-press, treat as a release in modes
    // that require a release. Prevents stuck-mic when user Alt-tabs while
    // holding the key.
    window.addEventListener('blur', function () {
      var mode = (ctx.STATE && ctx.STATE.shortcutMode) || 'smart';
      if (mode === 'toggle') { _press.mic = null; _press.picker = null; return; }
      if (_press.mic != null)    { _press.mic = null;    _toggleMic(); }
      if (_press.picker != null) { _press.picker = null; _togglePicker(); }
    });
  }

  window.MyFbBindings.keyboard = { bind: bind };
})(window);
