/**
 * BIAIF Toast — compact notification bar above footer.
 * Shows up to 4 toasts; oldest is dismissed when the bar is full.
 */
(function (window) {
  'use strict';

  var MAX_TOASTS = 4;
  var container  = null;

  function ensureContainer() {
    if (container) return container;
    container = document.getElementById('toast-container');
    return container;
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  window.BIAIFToast = { show: show };

})(window);
