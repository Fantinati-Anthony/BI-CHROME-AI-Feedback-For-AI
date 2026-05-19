/**
 * MyFb Bindings — façade
 *
 * One-call orchestrator used by `sidepanel.js`. Each underlying module
 * registers itself on `window.MyFbBindings.<name>` when its script
 * loads; this file just wires them in the right order.
 *
 * Usage:
 *   MyFbBindings.ctx.init(STATE, REFS);
 *   MyFbBindings.bindAll();
 *   await MyFbStorage.hydrate(STATE, MyFbBindings.hydrate.applyToDOM);
 */
(function (window) {
  'use strict';
  window.MyFbBindings = window.MyFbBindings || {};

  function bindAll() {
    var B = window.MyFbBindings;
    B.events.bind();
    B.messages.bind();
    B.keyboard.bind();
    B.tabs.bind();
  }

  window.MyFbBindings.bindAll = bindAll;
})(window);
