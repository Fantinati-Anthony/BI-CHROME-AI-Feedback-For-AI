/**
 * BIAIF Render — UI state sync
 *
 * Small DOM updates that don't fit into a renderer for a specific structure:
 *   - Master button label (Démarrer / Suivant / Terminer)
 *   - Armed / editing CSS classes on .biaif-root
 *   - Console-errors badge counter
 *   - Sort A→Z / Z→A toggle label
 *   - Segment text font-size (CSS custom property)
 */
(function (window) {
  'use strict';
  window.BIAIFRender = window.BIAIFRender || {};
  var ctx   = window.BIAIFRender.ctx;
  var CFG   = (window.BIAIF && window.BIAIF.config) || {};
  var UI    = CFG.ui || {};
  var UTILS = (window.BIAIF && window.BIAIF.utils) || {};
  function _t(k, fb, vars) { return UTILS.t ? UTILS.t(k, fb, vars) : (fb || k); }

  function updateMasterBtnLabel() {
    var REFS = ctx.REFS, STATE = ctx.STATE;
    if (!REFS.masterBtn) return;
    var lbl = REFS.masterBtn.querySelector('.master-label');
    if (!lbl) return;
    var hasContent = !!((STATE.currentDemande.text || '').trim() || STATE.currentDemande.refs.length);
    if (typeof STATE.editingDemandeIdx === 'number') {
      // Session bar is CSS-hidden during segment edit, but keep label correct.
      lbl.textContent = _t('session.update', 'Mettre à jour ✓');
      REFS.masterBtn.disabled = false;
    } else {
      lbl.textContent = _t('session.save', 'Enregistrer →');
      REFS.masterBtn.disabled = !hasContent;
    }
  }

  function updateArmedUi() {
    var STATE = ctx.STATE;
    var root  = document.querySelector('.biaif-root');
    var editing = typeof STATE.editingDemandeIdx === 'number';
    var hasContent = !!((STATE.currentDemande.text || '').trim() || STATE.currentDemande.refs.length);
    var empty   = !editing && !STATE.demandes.length && !hasContent;
    if (root) {
      root.classList.toggle('is-armed', !!STATE.armed);
      root.classList.toggle('is-editing-segment', editing);
      root.classList.toggle('is-empty-state', empty);
    }
    // Quick tools always accessible — no is-hidden / is-locked toggling
  }

  function updateErrorsBadges() {
    var n = ctx.STATE.consoleErrors.length;
    var tip = document.querySelector('[data-act="open-errors"] .tool-badge');
    if (tip) tip.textContent = String(n);
    var btn = document.querySelector('[data-act="open-errors"]');
    if (btn) {
      btn.classList.toggle('has-errors', n > 0);
      btn.setAttribute('aria-label', _t('aria.errors_count', 'Erreurs console (' + n + ')', { n: n }));
    }
  }

  function updateSortToggleLabel() {
    var REFS = ctx.REFS;
    if (!REFS.sortToggle) return;
    var lbl = REFS.sortToggle.querySelector('.sort-label');
    if (lbl) lbl.textContent = ctx.STATE.sortOrder === 'desc' ? 'Z→A' : 'A→Z';
  }

  function applySegFontSize() {
    var STATE = ctx.STATE;
    var wrap = document.querySelector('.biaif-segments-wrap');
    if (wrap) wrap.style.setProperty('--seg-text-size', (STATE.segFontSize || UI.DEFAULT_SEG_FONT_PX || 13) + 'px');
    var fontDown = document.querySelector('[data-act="seg-font-down"]');
    var fontUp   = document.querySelector('[data-act="seg-font-up"]');
    var min = UI.MIN_SEG_FONT_PX || 8;
    var max = UI.MAX_SEG_FONT_PX || 16;
    if (fontDown) fontDown.disabled = STATE.segFontSize <= min;
    if (fontUp)   fontUp.disabled   = STATE.segFontSize >= max;
  }

  function bumpSegFontSize(delta) {
    var STATE = ctx.STATE;
    var min = UI.MIN_SEG_FONT_PX || 8;
    var max = UI.MAX_SEG_FONT_PX || 16;
    var next = Math.max(min, Math.min(max, (STATE.segFontSize || UI.DEFAULT_SEG_FONT_PX || 13) + delta));
    if (next === STATE.segFontSize) return;
    STATE.segFontSize = next;
    applySegFontSize();
    if (window.BIAIFStorage) window.BIAIFStorage.persist(STATE);
  }

  window.BIAIFRender.uiState = {
    updateMasterBtnLabel:  updateMasterBtnLabel,
    updateArmedUi:         updateArmedUi,
    updateErrorsBadges:    updateErrorsBadges,
    updateSortToggleLabel: updateSortToggleLabel,
    applySegFontSize:      applySegFontSize,
    bumpSegFontSize:       bumpSegFontSize,
  };
})(window);
