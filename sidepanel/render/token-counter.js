/**
 * BIAIF Render — token counter
 *
 * Shows a live estimate of the prompt token count next to the
 * "Enregistrer" button. Approximation: chars/4 (matches Claude/GPT
 * tokenization within ±15% on prose; good enough for context-window
 * budgeting). Color thresholds are configurable via STATE.
 *
 *   ─ < 4k    : neutral
 *   ─ < 32k   : info (blue)
 *   ─ < 100k  : warn (amber)
 *   ─ ≥ 100k  : danger (red, pulsing)
 *
 * Invocation: BIAIFRender.tokenCounter.update() — debounced from the
 * editor input listener and from segment renders.
 */
(function (window) {
  'use strict';
  window.BIAIFRender = window.BIAIFRender || {};
  var ctx = window.BIAIFRender.ctx;

  var THRESHOLDS = { info: 4000, warn: 32000, danger: 100000 };

  function _format(n) {
    if (n < 1000)   return n + '';
    if (n < 10000)  return (n / 1000).toFixed(1) + 'k';
    return Math.round(n / 1000) + 'k';
  }

  function _estimate(text) {
    return Math.ceil((text || '').length / 4);
  }

  function _kindFor(tokens) {
    if (tokens >= THRESHOLDS.danger) return 'danger';
    if (tokens >= THRESHOLDS.warn)   return 'warn';
    if (tokens >= THRESHOLDS.info)   return 'info';
    return 'neutral';
  }

  function _ensureBadge() {
    var badge = document.querySelector('.token-counter');
    if (badge) return badge;
    var anchor = document.querySelector('.session-bar');
    if (!anchor) return null;
    badge = document.createElement('span');
    badge.className = 'token-counter';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    badge.title = 'Estimation tokens (chars/4)';
    anchor.appendChild(badge);
    return badge;
  }

  function update() {
    var STATE = ctx.STATE;
    if (!STATE) return;
    var text   = (STATE.currentDemande && STATE.currentDemande.text) || '';
    var tokens = _estimate(text);
    var badge  = _ensureBadge();
    if (!badge) return;
    if (!STATE.armed || !text) { badge.hidden = true; return; }
    badge.hidden = false;
    badge.dataset.kind = _kindFor(tokens);
    badge.textContent  = '~' + _format(tokens) + ' tok';
  }

  window.BIAIFRender.tokenCounter = { update: update, _estimate: _estimate, _kindFor: _kindFor };
})(window);
