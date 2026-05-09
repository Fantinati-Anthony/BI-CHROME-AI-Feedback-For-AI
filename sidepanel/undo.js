// @ts-check
/**
 * BIAIF Undo / Redo Stack
 * Snapshots pushed before every persist(). Ctrl+Z restores; Ctrl+Shift+Z re-applies.
 */
(function (window) {
  'use strict';

  var MAX = 50;
  /** @type {string[]} */
  var _undo = [];
  /** @type {string[]} */
  var _redo = [];

  function push(snapshot) {
    try {
      _undo.push(JSON.stringify(snapshot));
      if (_undo.length > MAX) _undo.shift();
      _redo = []; // new action invalidates redo history
    } catch (e) {
      console.warn('[BIAIF Undo] push failed', e && e.message);
    }
  }

  // Undo: pop from undo stack, save current to redo stack
  function pop(currentSnapshot) {
    if (!_undo.length) return null;
    try {
      if (currentSnapshot) {
        _redo.push(JSON.stringify(currentSnapshot));
        if (_redo.length > MAX) _redo.shift();
      }
      return JSON.parse(_undo.pop());
    } catch (e) { return null; }
  }

  // Redo: pop from redo stack
  function popRedo() {
    if (!_redo.length) return null;
    try { return JSON.parse(_redo.pop()); } catch (e) { return null; }
  }

  function canUndo() { return _undo.length > 0; }
  function canRedo() { return _redo.length > 0; }
  function clear()   { _undo = []; _redo = []; }
  function size()    { return _undo.length; }

  window.BIAIFUndo = { push, pop, popRedo, canUndo, canRedo, clear, size };
})(window);
