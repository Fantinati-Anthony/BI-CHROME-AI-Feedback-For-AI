// @ts-check
/**
 * MyFb Console Panel
 * Intercepts console.log/warn/error and mirrors them to the in-panel log viewer.
 * Uses a queue so entries captured before DOMContentLoaded are not lost.
 */
(function () {
  'use strict';

  var queue = [];
  var ready = false;
  var logContainer = null;

  var originalLog   = console.log.bind(console);
  var originalWarn  = console.warn.bind(console);
  var originalError = console.error.bind(console);

  function stringify(a) {
    if (a == null) return String(a);
    if (typeof a === 'object') { try { return JSON.stringify(a); } catch (_) { return String(a); } }
    return String(a);
  }

  function flush() {
    if (!logContainer) return;
    queue.forEach(function (entry) { appendEntry(entry.type, entry.msg); });
    queue = [];
  }

  function appendEntry(type, msg) {
    if (!logContainer) { queue.push({ type: type, msg: msg }); return; }
    var div = document.createElement('div');
    div.style.cssText = [
      'color:' + (type === 'error' ? '#f87171' : type === 'warn' ? '#fbbf24' : '#a1a1aa'),
      'margin-bottom:6px', 'font-size:11px',
      'word-break:break-all', 'font-family:monospace',
    ].join(';');
    div.textContent = '[' + type.toUpperCase() + '] ' + msg;
    logContainer.appendChild(div);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  console.log = function () {
    originalLog.apply(console, arguments);
    appendEntry('log', Array.prototype.map.call(arguments, stringify).join(' '));
  };
  console.warn = function () {
    originalWarn.apply(console, arguments);
    appendEntry('warn', Array.prototype.map.call(arguments, stringify).join(' '));
  };
  console.error = function () {
    originalError.apply(console, arguments);
    appendEntry('error', Array.prototype.map.call(arguments, stringify).join(' '));
  };

  window.addEventListener('DOMContentLoaded', function () {
    logContainer = document.getElementById('logs-container');
    ready = true;

    var logBtn      = document.querySelector('[data-act="toggle-logs"]');
    var logPanel    = document.getElementById('logs-panel');
    var clearBtn    = document.getElementById('clear-logs');
    var closeBtn    = document.getElementById('close-logs');

    function openPanel()   { if (logPanel) logPanel.removeAttribute('hidden'); }
    function closePanel()  { if (logPanel) logPanel.setAttribute('hidden', ''); }
    function togglePanel() { if (!logPanel) return; logPanel.hasAttribute('hidden') ? openPanel() : closePanel(); }

    if (logBtn)   logBtn.addEventListener('click',  function (e) { e.stopPropagation(); togglePanel(); });
    if (closeBtn) closeBtn.addEventListener('click', function (e) { e.stopPropagation(); closePanel(); });
    if (clearBtn && logContainer) {
      clearBtn.addEventListener('click', function (e) { e.stopPropagation(); logContainer.innerHTML = ''; queue = []; });
    }

    flush();
  });
})();
