/**
 * BIAIF Textarea Injector
 *
 * Injects a floating PromptDrop trigger button near focused <textarea> and
 * [contenteditable] elements on AI online pages and all other pages.
 *
 * On AI pages → opens sidepanel showing ALL segments (pick what to send).
 * On other pages → opens sidepanel filtered to the current page's hostname.
 */
(function () {
  'use strict';

  if (window.__BIAIF_TEXTAREA_INJECTOR__) return;
  window.__BIAIF_TEXTAREA_INJECTOR__ = true;

  const AI_HOSTS = [
    'claude.ai',
    'chatgpt.com',
    'gemini.google.com',
    'perplexity.ai',
    'grok.com',
    'x.com',
    'mistral.ai',
    'chat.deepseek.com',
    'chat.mistral.ai',
  ];

  const isAiPage = AI_HOSTS.some(
    (h) => location.hostname === h || location.hostname.endsWith('.' + h)
  );

  // ── Floating button ──────────────────────────────────────────────────────

  const FLOAT_ID = '__biaif_float_btn__';

  let _btn = null;
  let _blurTimer = null;
  let _currentTarget = null;

  function _getBtn() {
    if (_btn) return _btn;

    const style = document.createElement('style');
    style.textContent = `
      #${FLOAT_ID} {
        position: fixed;
        z-index: 2147483647;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: none;
        padding: 0;
        cursor: pointer;
        background: #6c47ff;
        box-shadow: 0 2px 8px rgba(0,0,0,.35);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transform: scale(.8);
        transition: opacity .15s, transform .15s;
        pointer-events: none;
        font-family: sans-serif;
      }
      #${FLOAT_ID}.is-visible {
        opacity: 1;
        transform: scale(1);
        pointer-events: auto;
      }
      #${FLOAT_ID}:hover {
        background: #7c5cff;
        transform: scale(1.1) !important;
      }
      #${FLOAT_ID} svg {
        width: 14px;
        height: 14px;
        display: block;
      }
      #${FLOAT_ID} .biaif-tooltip {
        position: absolute;
        bottom: calc(100% + 6px);
        right: 0;
        background: #1a1a2e;
        color: #fff;
        font-size: 11px;
        white-space: nowrap;
        padding: 4px 8px;
        border-radius: 4px;
        pointer-events: none;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity .1s, transform .1s;
      }
      #${FLOAT_ID}:hover .biaif-tooltip {
        opacity: 1;
        transform: translateY(0);
      }
    `;
    document.head.appendChild(style);

    _btn = document.createElement('button');
    _btn.id = FLOAT_ID;
    _btn.setAttribute('aria-label', 'Ouvrir PromptDrop');
    _btn.setAttribute('type', 'button');
    _btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
           stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="8 17 12 21 16 17"/>
        <line x1="12" y1="3" x2="12" y2="21"/>
        <polyline points="3 7 12 3 21 7"/>
      </svg>
      <span class="biaif-tooltip">PromptDrop</span>
    `;

    _btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // don't steal focus from textarea
      e.stopPropagation();
    });
    _btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _openPanel();
    });

    document.body.appendChild(_btn);
    return _btn;
  }

  function _positionNear(el) {
    const btn = _getBtn();
    const rect = el.getBoundingClientRect();
    const MARGIN = 4;

    let top  = rect.bottom - 28 - MARGIN;
    let left = rect.right  - 28 - MARGIN;

    // keep inside viewport
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (left + 28 > vw - 4)  left = vw - 28 - 4;
    if (left < 4)             left = 4;
    if (top + 28 > vh - 4)   top  = vh - 28 - 4;
    if (top < 4)              top  = rect.top + MARGIN;

    btn.style.top  = top  + 'px';
    btn.style.left = left + 'px';
  }

  function _showFor(el) {
    clearTimeout(_blurTimer);
    _currentTarget = el;
    _positionNear(el);
    _getBtn().classList.add('is-visible');
  }

  function _scheduleHide() {
    clearTimeout(_blurTimer);
    _blurTimer = setTimeout(() => {
      _getBtn().classList.remove('is-visible');
      _currentTarget = null;
    }, 200);
  }

  function _openPanel() {
    const filterUrl = isAiPage ? null : location.href;
    const msg = {
      type: (window.BIAIF && window.BIAIF.MSG && window.BIAIF.MSG.OPEN_WITH_FILTER)
              ? window.BIAIF.MSG.OPEN_WITH_FILTER
              : 'biaif:open-with-filter',
      filterUrl,
      pageUrl: location.href,
    };
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch (_) {}
  }

  // ── Focus / blur listeners ───────────────────────────────────────────────

  const SELECTOR = 'textarea, [contenteditable="true"], [contenteditable=""]';

  function _onFocus(e) {
    const el = e.target;
    if (!el.matches(SELECTOR)) return;
    // skip very small elements (inline widgets, hidden inputs)
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 20) return;
    _showFor(el);
  }

  function _onBlur(e) {
    if (!e.target.matches(SELECTOR)) return;
    _scheduleHide();
  }

  // keep button over the field on scroll / resize
  function _onScroll() {
    if (!_currentTarget) return;
    _positionNear(_currentTarget);
  }

  document.addEventListener('focusin',  _onFocus, true);
  document.addEventListener('focusout', _onBlur,  true);
  window.addEventListener('scroll',     _onScroll, { passive: true, capture: true });
  window.addEventListener('resize',     _onScroll, { passive: true });

  // ── MutationObserver : handle textareas added dynamically ───────────────

  // We rely purely on focusin events (which bubble) so no per-element binding
  // is needed. The MutationObserver is kept minimal — it only ensures the
  // floating button stays in the DOM if the host SPA clears document.body.
  const _observer = new MutationObserver(() => {
    if (_btn && !document.body.contains(_btn)) {
      _btn = null; // will be re-created on next _getBtn() call
    }
  });
  _observer.observe(document.documentElement, { childList: true, subtree: false });

})();
