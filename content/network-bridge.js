/**
 * My-Feedbacks Network Bridge (isolated world)
 *
 * Listens to the __myfb_network_failure__ CustomEvent fired by
 * content/network-monitor.js (MAIN world) and keeps a per-tab buffer
 * of recent network failures. The side panel pulls this buffer via
 * chrome.tabs.sendMessage('myfb:network:get').
 *
 * MAIN → isolated bridge mirrors error-bridge.js (which already
 * forwards page errors). Kept separate because the two domains have
 * different lifecycles : page errors flow continuously to the side
 * panel via CONSOLE_ERROR, network failures are pulled on submit.
 */

(function () {
  'use strict';

  if (window.__MYFB_NETWORK_BRIDGE__) return;
  window.__MYFB_NETWORK_BRIDGE__ = true;

  var MAX  = 20;
  var ring = [];

  window.addEventListener('__myfb_network_failure__', function (e) {
    var detail = e && e.detail;
    if (!detail) return;
    ring.push(detail);
    if (ring.length > MAX) ring.shift();
  });

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'myfb:network:get') return;
    if (sender.id && sender.id !== chrome.runtime.id) return;
    sendResponse({ failures: ring.slice() });
    return false;
  });

  // Test export
  window.MyFbNetworkBridge = {
    list:  function () { return ring.slice(); },
    clear: function () { ring = []; },
  };
})();
