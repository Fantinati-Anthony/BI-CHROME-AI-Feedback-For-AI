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

  var BUTTON_KEYS = ['inject', 'vscode', 'copilot', 'copy', 'download',
    'claude_online', 'chatgpt', 'gemini', 'perplexity', 'grok', 'lechat', 'deepseek'];
  var DEFAULT_FALSE = ['claude_online', 'chatgpt', 'gemini', 'perplexity', 'grok', 'lechat', 'deepseek'];

  function applyToDOM() {
    var STATE = ctx.STATE, REFS = ctx.REFS;
    if (REFS.langSelect && STATE.lang) REFS.langSelect.value = STATE.lang;

    // Button-visibility checkboxes
    BUTTON_KEYS.forEach(function (key) {
      var cb = document.getElementById('vis-' + key);
      if (!cb) return;
      var fallback = DEFAULT_FALSE.indexOf(key) >= 0 ? false : true;
      var v = STATE.visibleButtons[key];
      cb.checked = (v === undefined) ? fallback : !!v;
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
    if (cbHideTa && cbAutoSub) {
      var on = cbAutoSub.checked;
      cbHideTa.disabled = !on;
      var row = cbHideTa.closest('.sp-toggle-row');
      if (row) row.classList.toggle('is-disabled', !on);
      if (!on && cbHideTa.checked) { cbHideTa.checked = false; STATE.hideAiTextarea = false; }
    }

    H.updateSpFontVal();
    window.BIAIFRenderer.updateSortToggleLabel();
    window.BIAIFRenderer.applySegFontSize();
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
