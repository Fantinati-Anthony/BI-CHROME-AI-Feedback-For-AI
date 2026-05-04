// Intercepts console logs and outputs them directly in the UI panel

(function() {
  window.addEventListener('DOMContentLoaded', () => {
    const logBtn = document.querySelector('[data-act="toggle-logs"]');
    const logPanel = document.getElementById('logs-panel');
    const logContainer = document.getElementById('logs-container');
    const clearLogsBtn = document.getElementById('clear-logs');
    
    if (logBtn && logPanel) {
      logBtn.addEventListener('click', () => {
        logPanel.style.display = logPanel.style.display === 'none' ? 'flex' : 'none';
      });
    }
    if (clearLogsBtn && logContainer) {
      clearLogsBtn.addEventListener('click', () => { logContainer.innerHTML = ''; });
    }

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    
    function addToConsole(type, msg) {
      if (!logContainer) return;
      const div = document.createElement('div');
      div.style.color = type === 'error' ? '#f87171' : (type === 'warn' ? '#fbbf24' : '#a1a1aa');
      div.style.marginBottom = '6px';
      div.style.fontSize = '11px';
      div.style.wordBreak = 'break-all';
      div.style.fontFamily = 'monospace';
      div.textContent = '[' + type.toUpperCase() + '] ' + msg;
      logContainer.appendChild(div);
      logContainer.scrollTop = logContainer.scrollHeight;
    }
    
    console.log = function(...args) {
      originalLog.apply(console, args);
      addToConsole('log', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    };
    console.warn = function(...args) {
      originalWarn.apply(console, args);
      addToConsole('warn', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    };
    console.error = function(...args) {
      originalError.apply(console, args);
      addToConsole('error', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    };
  });
})();