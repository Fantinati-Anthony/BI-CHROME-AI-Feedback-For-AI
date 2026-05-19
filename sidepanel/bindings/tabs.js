/**
 * MyFb Bindings — Tab lifecycle
 *
 * - chrome.tabs.onActivated / onUpdated listeners
 * - "Tab not ready" detection (content script not injected yet → reload modal)
 * - Re-arming the picker on the new active tab during a session
 * - Console errors refresh + console-message progress listener
 */
(function (window) {
  'use strict';
  window.MyFbBindings = window.MyFbBindings || {};
  var ctx = window.MyFbBindings.ctx;
  var H   = window.MyFbBindings.helpers;

  async function _waitForTabReady(ms) {
    var deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      try {
        var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        var tab  = tabs[0];
        if (!tab || !tab.id) break;
        var r = await chrome.tabs.sendMessage(tab.id, { type: H.msgKey('COMMAND'), action: 'ping' }).catch(function () { return null; });
        if (r && r.ok) return true;
      } catch (_) {}
      await new Promise(function (res) { setTimeout(res, 200); });
    }
    return false;
  }

  async function _rearmPickerOnActiveTab() {
    var STATE = ctx.STATE, REFS = ctx.REFS;
    var resp = await H.sendBg({ type: H.msgKey('PICKER_ENABLE') });
    if (resp && !resp.error) {
      STATE.pickerActive = true;
      if (REFS.pickerBtn) {
        REFS.pickerBtn.classList.add('active');
        REFS.pickerBtn.setAttribute('aria-pressed', 'true');
      }
    }
    H.hideReloadModal();
  }

  async function checkActiveTabReady() {
    var STATE = ctx.STATE;
    if (STATE.armed) return;
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      var tab  = tabs[0];
      if (!tab || !tab.id) return;
      if (!/^https?:|^file:/.test(tab.url || '')) { H.hideReloadModal(); return; }
      var resp = null;
      try { resp = await chrome.tabs.sendMessage(tab.id, { type: H.msgKey('COMMAND'), action: 'ping' }); }
      catch (e) { resp = { error: String(e) }; }
      if (!resp || resp.error) H.showReloadModal();
      else H.hideReloadModal();
    } catch (_) {}
  }

  async function onTabSwitch() {
    H.refreshErrorsFromActiveTab();
    if (ctx.STATE.armed) {
      await _waitForTabReady(800);
      _rearmPickerOnActiveTab();
      H.updateLinkedSessionBanner();
    } else {
      checkActiveTabReady();
    }
  }

  function bind() {
    var STATE = ctx.STATE;
    if (chrome && chrome.tabs && chrome.tabs.onActivated) {
      chrome.tabs.onActivated.addListener(function () { onTabSwitch(); });
    }
    if (chrome && chrome.tabs && chrome.tabs.onUpdated) {
      chrome.tabs.onUpdated.addListener(function (_id, info, tab) {
        if (!tab || !tab.active) return;
        if (info.status === 'loading') {
          STATE.consoleErrors = [];
          window.MyFbRenderer.updateErrorsBadges();
        } else if (info.status === 'complete') {
          checkActiveTabReady();
          H.refreshErrorsFromActiveTab();
          if (STATE.armed) _rearmPickerOnActiveTab();
        }
      });
    }
    // Capture-progress listener (full-page screenshot stitching)
    chrome.runtime.onMessage.addListener(function (msg) {
      if (!msg || msg.type !== H.msgKey('CAPTURE_PROGRESS')) return;
      H.updateCaptureProgress(msg.current, msg.total, msg.label);
    });
  }

  window.MyFbBindings.tabs = {
    bind:                   bind,
    onTabSwitch:            onTabSwitch,
    checkActiveTabReady:    checkActiveTabReady,
    rearmPickerOnActiveTab: _rearmPickerOnActiveTab,
    waitForTabReady:        _waitForTabReady,
  };
})(window);
