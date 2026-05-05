/**
 * BIAIF Toast Notification System
 * Replaces the ephemeral status bar messages with a proper toast stack.
 */
(function (window) {
  'use strict';

  let container = null;

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

    const c = ensureContainer();
    if (!c) return;

    const toast = document.createElement('div');
    toast.className = 'biaif-toast biaif-toast--' + kind;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const icon  = icons[kind] || icons.info;

    toast.innerHTML =
      '<span class="toast-icon" aria-hidden="true">' + icon + '</span>' +
      '<span class="toast-msg">' + esc(message) + '</span>';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.setAttribute('aria-label', 'Fermer la notification');
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

  function dismiss(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.remove('is-visible');
    toast.classList.add('is-leaving');
    function remove() { if (toast.parentNode) toast.parentNode.removeChild(toast); }
    toast.addEventListener('transitionend', remove, { once: true });
    setTimeout(remove, 500);
  }

  window.BIAIFToast = { show: show };

})(window);
