/**
 * BIAIF Service Worker — chrome.commands hotkey routing
 *
 *   Alt+Shift+F → toggle-sidebar  (open the side panel for the active tab)
 *   Alt+Shift+E → toggle-picker   (relayed to the active tab content)
 *   Alt+Shift+M → toggle-mic      (relayed to sidepanel via HOTKEY)
 *   Alt+Shift+C → copy-prompt     (relayed to sidepanel via HOTKEY)
 */

/* eslint-disable no-undef */

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-sidebar') { openSidePanelForActive(); return; }
  if (command === 'toggle-picker') {
    sendToActiveTabContent({ type: MSG.COMMAND, action: 'toggle-picker' });
    return;
  }
  if (command === 'toggle-mic' || command === 'copy-prompt') {
    chrome.runtime.sendMessage({ type: MSG.HOTKEY, action: command }).catch(() => {});
  }
});
