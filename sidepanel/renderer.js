/**
 * MyFb Renderer (façade)
 *
 * Exposes the `MyFbRenderer` public API expected by `sidepanel.js`,
 * `sidepanel/session.js`, etc. All actual rendering lives in focused
 * modules under `sidepanel/render/*`. This file is intentionally tiny.
 *
 * Module map:
 *   render/ctx.js                — shared mutable context (STATE, REFS, drag…)
 *   render/icons.js              — SVG icon factory
 *   render/chips.js              — chip element factory + drag-drop
 *   render/editor.js             — current-demande editor + refs strip
 *   render/segment-card.js       — one segment card
 *   render/conversation-group.js — grouping logic + group card
 *   render/archive-zone.js       — collapsible archive section
 *   render/filter-chips.js       — active-filters bar
 *   render/segments.js           — top-level renderSegments orchestrator
 *   render/ui-state.js           — small DOM updates (master btn, armed,…)
 */
(function (window) {
  'use strict';

  function init(state, refs) {
    var R = window.MyFbRender;
    R.ctx.init(state, refs);
    R.chips.bindDragEvents();
  }

  var R = window.MyFbRender || {};
  var DOM = (window.MyFb && window.MyFb.dom) || {};

  window.MyFbRenderer = {
    init:                   init,
    esc:                    DOM.esc,
    setFilter:              function (k, v) { R.segments.setFilter(k, v); },
    renderSegments:         function ()       { R.segments.render(); },
    renderDemandeEditor:    function ()       { R.editor.render(); },
    renderDemandeRefsStrip: function ()       { R.editor.renderRefsStrip(); },
    appendChipToEditor:     function (i, ref) { R.editor.appendChip(i, ref); },
    makeChipElement:        function (i, ref, opts) { return R.chips.make(i, ref, opts); },
    renderTextWithChips:    function (t, refs, root, opts) { R.chips.renderTextWithChips(t, refs, root, opts); },
    updateMasterBtnLabel:   function () { R.uiState.updateMasterBtnLabel(); },
    updateArmedUi:          function () { R.uiState.updateArmedUi(); },
    updateErrorsBadges:     function () { R.uiState.updateErrorsBadges(); },
    updateSortToggleLabel:  function () { R.uiState.updateSortToggleLabel(); },
    applySegFontSize:       function () { R.uiState.applySegFontSize(); },
    bumpSegFontSize:        function (delta) { R.uiState.bumpSegFontSize(delta); },
    applySegTextLines:      function () { R.uiState.applySegTextLines(); },
    bumpSegTextLines:       function (delta) { R.uiState.bumpSegTextLines(delta); },
    updateEditorContext:    function (idx, url) { R.uiState.updateEditorContext(idx, url); },
  };

})(window);
