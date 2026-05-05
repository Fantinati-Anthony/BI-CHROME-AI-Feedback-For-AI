/**
 * BIAIF Undo Stack
 * Snapshots (demandes + currentDemande) pushed before every persist().
 * Ctrl+Z in the side panel restores the previous snapshot.
 */
(function (window) {
  'use strict';

  var MAX = 20;
  var stack = [];

  function push(snapshot) {
    try {
      stack.push(JSON.stringify(snapshot));
      if (stack.length > MAX) stack.shift();
    } catch (e) {
      console.warn('[BIAIF Undo] push failed', e && e.message);
    }
  }

  function pop() {
    if (!stack.length) return null;
    try {
      return JSON.parse(stack.pop());
    } catch (e) {
      return null;
    }
  }

  function canUndo() { return stack.length > 0; }

  function clear() { stack = []; }

  function size() { return stack.length; }

  window.BIAIFUndo = { push: push, pop: pop, canUndo: canUndo, clear: clear, size: size };

})(window);
