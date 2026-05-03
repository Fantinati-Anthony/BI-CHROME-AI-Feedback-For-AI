/**
 * BI Chrome AI Feedback - Service Worker
 *
 * Relaie les hotkeys (chrome.commands) et les clics sur l'icône
 * d'extension vers le content script de l'onglet actif.
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
    // Le content script peut ne pas être chargé (page chrome://, store, etc.)
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
