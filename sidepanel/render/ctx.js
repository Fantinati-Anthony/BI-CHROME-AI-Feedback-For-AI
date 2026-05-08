// @ts-check
/**
 * BIAIF Render Context
 *
 * Single source of truth for the mutable context shared across every
 * `sidepanel/render/*.js` module:
 *   - STATE (the global app state, owned by sidepanel.js)
 *   - REFS  (cached DOM references, owned by sidepanel.js)
 *   - DRAG     ({ chip, sourceContainer })   — chip drag-drop within editor
 *   - SEG_DRAG ({ sourceIdx })                — segment drag-drop for merge
 *   - archiveTimer                            — module-level setInterval handle
 *
 * Modules **read** from ctx; only sidepanel.js writes to STATE/REFS through
 * BIAIFRenderer.init(). The drag/segDrag/archiveTimer fields are owned by
 * the renderer modules themselves but live here so they can be shared.
 */
(function (window) {
  'use strict';
  window.BIAIFRender = window.BIAIFRender || {};
  var ctx = {
    STATE:        null,
    REFS:         null,
    DRAG:         { chip: null, sourceContainer: null },
    SEG_DRAG:     { sourceIdx: -1 },
    archiveTimer: null,
  };
  ctx.init = function (state, refs) {
    ctx.STATE = state;
    ctx.REFS  = refs;
  };
  // Convenience accessor used by inline event handlers that capture by ref
  // (so they always see the latest STATE/REFS even if init() is called later).
  ctx.S = function () { return ctx.STATE; };
  ctx.R = function () { return ctx.REFS;  };

  window.BIAIFRender.ctx = ctx;
})(window);
