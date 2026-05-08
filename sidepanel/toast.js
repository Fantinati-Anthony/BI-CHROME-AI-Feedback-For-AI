/**
 * BIAIF Toast — compact notification bar above footer.
 * Shows up to BIAIF.config.ui.MAX_TOASTS toasts; oldest dismissed when full.
 */
(function (window) {
  'use strict';

  var CFG = (window.BIAIF && window.BIAIF.config && window.BIAIF.config.ui) || {};
  var MAX_TOASTS = CFG.MAX_TOASTS || 4;
  var DOM = (window.BIAIF && window.BIAIF.dom) || {};
  var esc = DOM.esc || function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var container = null;

  function ensureContainer() {
    if (container) return container;
    container = document.getElementById('toast-container');
    return container;
  }

  /**
   * @param {string} message
   * @param {'info'|'success'|'error'} kind
   * @param {number} duration  ms before auto-dismiss (0 = sticky)
   */
  function show(message, kind, duration) {
    kind     = kind     || 'info';
    duration = duration !== undefined ? duration : (kind === 'error' ? 6000 : 3000);

    var c = ensureContainer();
    if (!c) return;

    // Evict oldest toast if bar is full
    while (c.children.length >= MAX_TOASTS) {
      dismiss(c.firstElementChild, true);
    }

    var toast = document.createElement('div');
    toast.className = 'biaif-toast biaif-toast--' + kind;
    toast.setAttribute('role', 'status');

    var icons = { success: '✓', error: '✕', info: 'ℹ' };
    var icon  = icons[kind] || icons.info;

    toast.innerHTML =
      '<span class="toast-icon" aria-hidden="true">' + icon + '</span>' +
      '<span class="toast-msg" title="' + esc(message) + '">' + esc(message) + '</span>';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.setAttribute('aria-label', 'Fermer');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', function () { dismiss(toast); });
    toast.appendChild(closeBtn);

    c.appendChild(toast);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        toast.classList.add('is-visible');
      });
    });

    if (duration > 0) {
      setTimeout(function () { dismiss(toast); }, duration);
    }

    return toast;
  }

  function dismiss(toast, immediate) {
    if (!toast || !toast.parentNode) return;
    if (immediate) {
      toast.parentNode.removeChild(toast);
      return;
    }
    toast.classList.remove('is-visible');
    toast.classList.add('is-leaving');
    function remove() { if (toast.parentNode) toast.parentNode.removeChild(toast); }
    toast.addEventListener('transitionend', remove, { once: true });
    setTimeout(remove, 400);
  }

  /**
   * Toast with an inline action button (e.g. "Annuler" right after a delete).
   * onClick fires when the user clicks the action button; the toast then dismisses.
   *
   * @param {string} message
   * @param {string} actionLabel
   * @param {Function} onClick
   * @param {object} [opts]  { kind?: 'info'|'success'|'error', duration?: number }
   */
  function showAction(message, actionLabel, onClick, opts) {
    opts     = opts     || {};
    var kind = opts.kind || 'info';
    var duration = opts.duration !== undefined ? opts.duration : 5000;

    var c = ensureContainer();
    if (!c) return;
    while (c.children.length >= MAX_TOASTS) dismiss(c.firstElementChild, true);

    var toast = document.createElement('div');
    toast.className = 'biaif-toast biaif-toast--' + kind + ' biaif-toast--with-action';
    toast.setAttribute('role', 'status');

    var icons = { success: '✓', error: '✕', info: 'ℹ' };
    var iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon'; iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = icons[kind] || icons.info;
    toast.appendChild(iconSpan);

    var msgSpan = document.createElement('span');
    msgSpan.className = 'toast-msg';
    msgSpan.title = message; msgSpan.textContent = message;
    toast.appendChild(msgSpan);

    var actBtn = document.createElement('button');
    actBtn.className = 'toast-action';
    actBtn.textContent = actionLabel;
    actBtn.addEventListener('click', function () {
      if (typeof onClick === 'function') onClick();
      dismiss(toast);
    });
    toast.appendChild(actBtn);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.setAttribute('aria-label', 'Fermer');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', function () { dismiss(toast); });
    toast.appendChild(closeBtn);

    c.appendChild(toast);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { toast.classList.add('is-visible'); });
    });
    if (duration > 0) setTimeout(function () { dismiss(toast); }, duration);
    return toast;
  }

  window.BIAIFToast = { show: show, showAction: showAction };

})(window);
