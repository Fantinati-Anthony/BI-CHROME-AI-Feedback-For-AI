/**
 * MyFb Render — UI state sync
 *
 * Small DOM updates that don't fit into a renderer for a specific structure:
 *   - Master button label (Démarrer / Suivant / Terminer)
 *   - Armed / editing CSS classes on .myfb-root
 *   - Console-errors badge counter
 *   - Sort A→Z / Z→A toggle label
 *   - Segment text font-size (CSS custom property)
 */
(function (window) {
  'use strict';
  window.MyFbRender = window.MyFbRender || {};
  var ctx   = window.MyFbRender.ctx;
  var CFG   = (window.MyFb && window.MyFb.config) || {};
  var UI    = CFG.ui || {};
  var UTILS = (window.MyFb && window.MyFb.utils) || {};
  function _t(k, fb, vars) { return UTILS.t ? UTILS.t(k, fb, vars) : (fb || k); }

  function updateMasterBtnLabel() {
    var REFS = ctx.REFS, STATE = ctx.STATE;
    if (!REFS.masterBtn) return;
    var hasContent = !!((STATE.currentDemande.text || '').trim() || STATE.currentDemande.refs.length);
    var label;
    if (typeof STATE.editingDemandeIdx === 'number') {
      label = _t('session.update', 'Enregistrer');
      REFS.masterBtn.disabled = false;
    } else {
      label = _t('session.save', 'Enregistrer');
      REFS.masterBtn.disabled = !hasContent;
    }
    // The button is icon-only (✓ SVG inside .master-label) — expose the
    // i18n string via aria-label + title for screen readers + tooltip.
    REFS.masterBtn.setAttribute('aria-label', label);
    REFS.masterBtn.title = label;
    if (window.MyFbRender.tokenCounter) window.MyFbRender.tokenCounter.update();
  }

  function updateArmedUi() {
    var STATE = ctx.STATE;
    var root  = document.querySelector('.myfb-root');
    var editing = typeof STATE.editingDemandeIdx === 'number';
    var hasContent = !!((STATE.currentDemande.text || '').trim() || STATE.currentDemande.refs.length);
    var empty   = !STATE.armed && !editing && !STATE.demandes.length && !hasContent;
    if (root) {
      root.classList.toggle('is-armed', !!STATE.armed);
      root.classList.toggle('is-editing-segment', editing);
      root.classList.toggle('is-empty-state', empty);
    }
    var locked = !STATE.armed && !editing;
    var dz = document.querySelector('.demande-zone');
    if (dz) dz.classList.toggle('is-locked', locked);
    var qt = document.querySelector('.myfb-quick-tools');
    if (qt) qt.classList.toggle('is-locked', locked);
  }

  function updateErrorsBadges() {
    var n = ctx.STATE.consoleErrors.length;
    var btn = document.querySelector('[data-act="open-errors"]');
    if (btn) {
      btn.hidden = n === 0;
      btn.classList.toggle('has-errors', n > 0);
      btn.setAttribute('aria-label', _t('aria.errors_count', 'Erreurs console (' + n + ')', { n: n }));
    }
    var tip = document.querySelector('[data-act="open-errors"] .tool-badge');
    if (tip) {
      tip.textContent = String(n);
      tip.setAttribute('data-count', String(n));
    }
  }

  function updateSortToggleLabel() {
    var order = ctx.STATE.sortOrder;
    var asc   = document.querySelector('[data-act="sort-asc"]');
    var desc  = document.querySelector('[data-act="sort-desc"]');
    if (asc)  asc.classList.toggle('is-active',  order !== 'desc');
    if (desc) desc.classList.toggle('is-active', order === 'desc');
  }

  function applySegFontSize() {
    var STATE = ctx.STATE;
    var wrap = document.querySelector('.myfb-segments-wrap');
    if (wrap) wrap.style.setProperty('--seg-text-size', (STATE.segFontSize || UI.DEFAULT_SEG_FONT_PX || 13) + 'px');
    var fontDown = document.querySelector('[data-act="seg-font-down"]');
    var fontUp   = document.querySelector('[data-act="seg-font-up"]');
    var min = UI.MIN_SEG_FONT_PX || 8;
    var max = UI.MAX_SEG_FONT_PX || 16;
    if (fontDown) fontDown.disabled = STATE.segFontSize <= min;
    if (fontUp)   fontUp.disabled   = STATE.segFontSize >= max;
  }

  function applySegTextLines() {
    var STATE = ctx.STATE;
    var wrap  = document.querySelector('.myfb-segments-wrap');
    var n     = Math.max(1, Math.min(20, STATE.segTextLines || 5));
    if (wrap) wrap.style.setProperty('--seg-card-lines', String(n));
    var dn = document.querySelector('[data-act="seg-lines-down"]');
    var up = document.querySelector('[data-act="seg-lines-up"]');
    if (dn) dn.disabled = n <= 1;
    if (up) up.disabled = n >= 20;
  }

  function bumpSegTextLines(delta) {
    var STATE = ctx.STATE;
    var n = Math.max(1, Math.min(20, (STATE.segTextLines || 5) + delta));
    if (n === (STATE.segTextLines || 5)) return;
    STATE.segTextLines = n;
    applySegTextLines();
    if (window.MyFbStorage) window.MyFbStorage.persist(STATE);
    if (window.MyFbRenderer) window.MyFbRenderer.renderSegments();
  }

  function bumpSegFontSize(delta) {
    var STATE = ctx.STATE;
    var min = UI.MIN_SEG_FONT_PX || 8;
    var max = UI.MAX_SEG_FONT_PX || 16;
    var next = Math.max(min, Math.min(max, (STATE.segFontSize || UI.DEFAULT_SEG_FONT_PX || 13) + delta));
    if (next === STATE.segFontSize) return;
    STATE.segFontSize = next;
    applySegFontSize();
    if (window.MyFbStorage) window.MyFbStorage.persist(STATE);
  }

  function updateEditorContext(editingIdx, url) {
    var isEdit = typeof editingIdx === 'number';
    var title  = document.querySelector('.demande-title');
    if (title) {
      title.textContent = isEdit
        ? _t('demande.editing', 'Édition — demande #' + (editingIdx + 1), { n: editingIdx + 1 })
        : _t('demande.title', 'Demande en cours');
      title.classList.toggle('is-editing', isEdit);
    }
    // .demande-zone-ctx removed — the .demande-title.is-editing styling
    // above already conveys the editing state.
    var urlbar = document.querySelector('.demande-zone-urlbar');
    if (urlbar) {
      if (isEdit && url) {
        var link  = urlbar.querySelector('.demande-zone-url');
        var short = url;
        try { var u = new URL(url); short = u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 24) : ''); } catch (_) {}
        if (link) { link.textContent = short; link.href = url; link.title = url; }
        urlbar.hidden = false;
      } else {
        urlbar.hidden = true;
      }
    }
  }

  window.MyFbRender.uiState = {
    updateMasterBtnLabel:  updateMasterBtnLabel,
    updateArmedUi:         updateArmedUi,
    updateErrorsBadges:    updateErrorsBadges,
    updateSortToggleLabel: updateSortToggleLabel,
    applySegFontSize:      applySegFontSize,
    bumpSegFontSize:       bumpSegFontSize,
    applySegTextLines:     applySegTextLines,
    bumpSegTextLines:      bumpSegTextLines,
    updateEditorContext:   updateEditorContext,
  };
})(window);
