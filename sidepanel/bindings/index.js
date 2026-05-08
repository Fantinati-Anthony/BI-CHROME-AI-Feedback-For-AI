/**
 * BIAIF Bindings — façade
 *
 * One-call orchestrator used by `sidepanel.js`. Each underlying module
 * registers itself on `window.BIAIFBindings.<name>` when its script
 * loads; this file just wires them in the right order.
 *
 * Usage:
 *   BIAIFBindings.ctx.init(STATE, REFS);
 *   BIAIFBindings.bindAll();
 *   await BIAIFStorage.hydrate(STATE, BIAIFBindings.hydrate.applyToDOM);
 */
(function (window) {
  'use strict';
  window.BIAIFBindings = window.BIAIFBindings || {};

  function bindAll() {
    var B = window.BIAIFBindings;
    B.events.bind();
    B.messages.bind();
    B.keyboard.bind();
    B.tabs.bind();
  }

  window.BIAIFBindings.bindAll = bindAll;
})(window);
