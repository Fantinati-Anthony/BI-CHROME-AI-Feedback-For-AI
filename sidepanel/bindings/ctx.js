/**
 * MyFb Bindings Context
 *
 * Same pattern as `sidepanel/render/ctx.js`: a shared accessor for the
 * STATE / REFS objects owned by `sidepanel.js`. Every binding module
 * imports through this so we don't have to thread STATE/REFS via
 * function arguments.
 */
(function (window) {
  'use strict';
  window.MyFbBindings = window.MyFbBindings || {};
  var ctx = { STATE: null, REFS: null };
  ctx.init = function (state, refs) { ctx.STATE = state; ctx.REFS = refs; };
  ctx.S = function () { return ctx.STATE; };
  ctx.R = function () { return ctx.REFS; };
  window.MyFbBindings.ctx = ctx;
})(window);
