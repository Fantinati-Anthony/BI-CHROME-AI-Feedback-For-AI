/**
 * BIAIF Bindings — Post-hydration DOM sync
 *
 * Called once by `BIAIFStorage.hydrate(STATE, callback)` after the saved
 * payload has been merged into STATE. Restores every checkbox, select,
 * font-size readout, language, etc., from the now-populated STATE — and
 * fires the initial render.
 */
(function (window) {
  'use strict';
  window.BIAIFBindings = window.BIAIFBindings || {};
  var ctx   = window.BIAIFBindings.ctx;
  var H     = window.BIAIFBindings.helpers;
  var UTILS = (window.BIAIF && window.BIAIF.utils) || {};
  function _t(k, fb, vars) { return UTILS.t ? UTILS.t(k, fb, vars) : (fb || k); }

  function applyToDOM() {
    var STATE = ctx.STATE, REFS = ctx.REFS;
    // Apply theme as the very first DOM mutation to avoid flash-of-wrong-theme.
    document.documentElement.setAttribute('data-theme', STATE.theme || 'dark');
    if (REFS.langSelect && STATE.lang) REFS.langSelect.value = STATE.lang;

    // Button-visibility checkboxes — derived from BIAIF.ALL_BUTTONS registry.
    var ALL = (window.BIAIF && window.BIAIF.ALL_BUTTONS) || [];
    ALL.forEach(function (def) {
      var cb = document.getElementById('vis-' + def.key);
      if (!cb) return;
      var v = STATE.visibleButtons[def.key];
      cb.checked = (v === undefined) ? !!def.defaultVisible : !!v;
    });

    // Auto-open checkboxes
    var cbActive = document.getElementById('aop-active');
    var cbDone   = document.getElementById('aop-done');
    var cbAiPage = document.getElementById('aop-ai');
    if (cbActive) cbActive.checked = !!STATE.autoOpenOnKnownActive;
    if (cbDone)   cbDone.checked   = !!STATE.autoOpenOnKnownDone;
    if (cbAiPage) cbAiPage.checked = !!STATE.autoOpenOnAiPage;

    // Behaviour checkboxes + dependency
    var cbHideTa  = document.getElementById('hide-ai-textarea');
    var cbAutoSub = document.getElementById('auto-submit-inject');
    if (cbHideTa)  cbHideTa.checked  = !!STATE.hideAiTextarea;
    if (cbAutoSub) cbAutoSub.checked = !!STATE.autoSubmitAfterInject;
    var cbStaysArmed = document.getElementById('save-stays-armed');
    if (cbStaysArmed) cbStaysArmed.checked = STATE.saveStaysArmed !== false;
    // Shortcut mode radio: pre-check the saved value (default 'smart').
    var smode = STATE.shortcutMode || 'smart';
    var smRadio = document.getElementById('shortcut-mode-' + smode);
    if (smRadio) smRadio.checked = true;
    var cbConsole = document.getElementById('show-console-btn');
    var logsBtn   = document.querySelector('.topbar-logs-btn');
    if (cbConsole) cbConsole.checked = !!STATE.showConsoleBtn;
    if (logsBtn)   logsBtn.hidden    = !STATE.showConsoleBtn;
    var cbTopBottom = document.getElementById('topbar-bottom');
    var root        = document.querySelector('.biaif-root');
    if (cbTopBottom) cbTopBottom.checked = STATE.topbarPosition === 'bottom';
    if (root)        root.classList.toggle('topbar-bottom', STATE.topbarPosition === 'bottom');
    if (cbHideTa && cbAutoSub) {
      var on = cbAutoSub.checked;
      cbHideTa.disabled = !on;
      var row = cbHideTa.closest('.sp-toggle-row');
      if (row) row.classList.toggle('is-disabled', !on);
      if (!on && cbHideTa.checked) { cbHideTa.checked = false; STATE.hideAiTextarea = false; }
    }

    H.updateSpFontVal();
    H.updateSpLinesVal();
    window.BIAIFRenderer.updateSortToggleLabel();
    window.BIAIFRenderer.applySegFontSize();
    window.BIAIFRenderer.applySegTextLines();
    window.BIAIFRenderer.renderDemandeEditor();
    window.BIAIFRenderer.renderSegments();
    window.BIAIFRenderer.updateArmedUi();

    var uiLang = STATE.uiLang || (window.BIAIFi18n && window.BIAIFi18n.detectBrowserLang && window.BIAIFi18n.detectBrowserLang());
    if (window.BIAIFi18n) window.BIAIFi18n.setLang(uiLang || 'fr');
    window.BIAIFToast.show(_t('toast.ready', 'Prêt.'), 'info', 1500);

    if (window.BIAIFWizard) {
      window.BIAIFWizard.init(STATE, function () { window.BIAIFStorage.persist(STATE); });
    }
  }

  window.BIAIFBindings.hydrate = { applyToDOM: applyToDOM };
})(window);
