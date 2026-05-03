/**
 * BI Chrome AI Feedback - Service Worker
 *
 * Relaie :
 *   - les hotkeys (chrome.commands) et clics sur l'icône vers le content script
 *   - les demandes de capture (chrome.tabs.captureVisibleTab) depuis la page
 */

const COMMAND_TO_ACTION = {
  'toggle-sidebar': 'toggle-sidebar',
  'toggle-picker': 'toggle-picker',
  'toggle-mic': 'toggle-mic',
  'copy-prompt': 'copy-prompt',
};

async function sendToActiveTab(action) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'biaif:command', action });
  } catch (err) {
    console.warn('[BIAIF] sendMessage failed:', err?.message || err);
  }
}

chrome.commands.onCommand.addListener((command) => {
  const action = COMMAND_TO_ACTION[command];
  if (action) sendToActiveTab(action);
});

chrome.action.onClicked.addListener(() => {
  sendToActiveTab('toggle-sidebar');
});

/**
 * Capture du tab visible (appelé depuis content/screenshot.js).
 * captureVisibleTab nécessite la permission `activeTab` ET un user gesture
 * récent (clic icône, hotkey, ou interaction utilisateur dans la page).
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'biaif:capture-tab') return false;
  const windowId = sender.tab?.windowId;
  try {
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ dataUrl });
      }
    });
  } catch (e) {
    sendResponse({ error: e.message });
  }
  return true; // réponse asynchrone
});
