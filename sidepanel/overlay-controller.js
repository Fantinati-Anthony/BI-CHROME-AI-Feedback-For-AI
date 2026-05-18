/**
 * My-Feedbacks Overlay Controller (side panel side)
 *
 * Owns the user-facing toggle "Afficher les zones sélectionnées sur la
 * page" and orchestrates the broadcast to content scripts.
 *
 * State:
 *   - Preference (visible/hidden) is persisted in chrome.storage.local
 *     under the key `myfb:overlays:visible`. Defaults to false (OFF).
 *
 * Broadcast strategy:
 *   - When the user toggles ON:
 *     • collect refs from the current STATE (only those whose pageUrl
 *       matches the active tab's URL)
 *     • for each ref, attach its demande index (1-based) + the demande
 *       text snippet for the tooltip
 *     • chrome.tabs.sendMessage(activeTabId, { type: OVERLAYS_RENDER, refs })
 *   - When the user toggles OFF, send OVERLAYS_CLEAR to the active tab.
 *
 * Re-broadcasts on demande mutation (add / delete / edit refs) when the
 * toggle is ON. Listening to the legacy STATE is done lazily via a
 * polling tick when integration is wired in PR 5 (renderer hooks).
 */

(function (window) {
  'use strict';

  var STORAGE_KEY = 'myfb:overlays:visible';
  var _visible = false;
  var _lastBroadcastTabId = null;

  var MSG = (window.MyFb && window.MyFb.MSG) || {};

  function init() {
    // Load persisted preference, then update the button state.
    try {
      chrome.storage.local.get([STORAGE_KEY], function (out) {
        _visible = !!(out && out[STORAGE_KEY]);
        _updateButtonUI();
        if (_visible) broadcast();
      });
    } catch (_) {
      _updateButtonUI();
    }
    _wireButton();
    _wireFocusMessage();
  }

  function isVisible() { return _visible; }

  function toggle() {
    setVisible(!_visible);
  }

  function setVisible(v) {
    _visible = !!v;
    var toSet = {};
    toSet[STORAGE_KEY] = _visible;
    try { chrome.storage.local.set(toSet); } catch (_) {}
    _updateButtonUI();
    if (_visible) broadcast();
    else          clearActiveTab();
  }

  function broadcast() {
    if (!_visible) return;
    var STATE = window.MyFbBindings && window.MyFbBindings.ctx && window.MyFbBindings.ctx.STATE;
    if (!STATE || !Array.isArray(STATE.demandes)) return;

    _activeTab().then(function (tab) {
      if (!tab || !tab.url) return;
      var entries = _collectEntriesForUrl(STATE.demandes, tab.url);
      _lastBroadcastTabId = tab.id;
      try {
        chrome.tabs.sendMessage(tab.id, {
          type: MSG.OVERLAYS_RENDER || 'myfb:overlays-render',
          refs: entries,
        }).catch(function () { /* tab not ready */ });
      } catch (_) {}
    });
  }

  function clearActiveTab() {
    _activeTab().then(function (tab) {
      if (!tab) return;
      try {
        chrome.tabs.sendMessage(tab.id, {
          type: MSG.OVERLAYS_CLEAR || 'myfb:overlays-clear',
        }).catch(function () {});
      } catch (_) {}
    });
  }

  function _collectEntriesForUrl(demandes, url) {
    var out = [];
    for (var i = 0; i < demandes.length; i++) {
      var d = demandes[i];
      if (!d || !Array.isArray(d.refs)) continue;
      var demandeIndex = i + 1;
      var demandeText  = (d.text || '').replace(/\s+/g, ' ').trim();
      for (var j = 0; j < d.refs.length; j++) {
        var ref = d.refs[j];
        if (!ref) continue;
        // Match by tabUrl on the ref OR by demande.url
        var refUrl = ref.tabUrl || d.url || null;
        if (!_urlMatches(refUrl, url)) continue;
        out.push({
          ref: {
            id:       ref.id || ('ref-' + i + '-' + j),
            type:     ref.type,
            selector: ref.selector || null,
            box:      ref.box || null,
            tabUrl:   refUrl,
          },
          demandeIndex: demandeIndex,
          demandeId:    d.id,
          demandeText:  demandeText,
        });
      }
    }
    return out;
  }

  function _urlMatches(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    // Strip hash for SPA tolerance
    var stripHash = function (u) { try { return u.split('#')[0]; } catch (_) { return u; } };
    return stripHash(a) === stripHash(b);
  }

  function _activeTab() {
    return new Promise(function (resolve) {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          resolve((tabs && tabs[0]) || null);
        });
      } catch (_) { resolve(null); }
    });
  }

  // ── Button UI (in topbar-extras) ────────────────────────────────────

  function _wireButton() {
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-act=toggle-overlays]');
      if (!btn) return;
      e.stopPropagation();
      toggle();
    });
  }

  function _updateButtonUI() {
    var btns = document.querySelectorAll('[data-act=toggle-overlays]');
    btns.forEach(function (btn) {
      btn.classList.toggle('is-on', _visible);
      btn.setAttribute('aria-pressed', _visible ? 'true' : 'false');
    });
  }

  // ── Receive badge-click messages from content scripts ───────────────

  function _wireFocusMessage() {
    try {
      chrome.runtime.onMessage.addListener(function (msg, sender) {
        if (!msg || !msg.type) return;
        if (sender.id && sender.id !== chrome.runtime.id) return;
        if (msg.type === (MSG.OVERLAYS_FOCUS_REF || 'myfb:overlays-focus-ref')) {
          _focusDemandeCard(msg.demandeId);
        }
      });
    } catch (_) {}
  }

  function _focusDemandeCard(demandeId) {
    // Scroll to + briefly highlight the segment card. The renderer
    // attaches data-id on each card; if not found, we no-op.
    var card = document.querySelector('.myfb-segment[data-id="' + (demandeId || '').replace(/"/g, '\\"') + '"]');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('is-flash');
    setTimeout(function () { card.classList.remove('is-flash'); }, 1400);
  }

  window.MyFbOverlayController = {
    init:       init,
    isVisible:  isVisible,
    toggle:     toggle,
    setVisible: setVisible,
    broadcast:  broadcast,
    _collectEntriesForUrl: _collectEntriesForUrl,
    _urlMatches: _urlMatches,
  };
})(window);
