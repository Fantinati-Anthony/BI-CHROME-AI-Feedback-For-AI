/**
 * BIAIF Service Worker — sidepanel auto-open
 *
 * Watches chrome.tabs.onActivated and onUpdated; opens the sidepanel
 * when the user lands on a tab that:
 *   - matches a known AI host (claude.ai, chatgpt.com, …)         and
 *     `autoOpenOnAiPage` is enabled, OR
 *   - matches a tracked segment's `conversationUrl` and the segment
 *     is active / done according to the corresponding setting.
 */

/* eslint-disable no-undef */

async function checkAutoOpenForTab(tabId, tabUrl) {
  if (!tabUrl || tabUrl.startsWith('chrome') || tabUrl.startsWith('about:') || tabUrl.startsWith('moz-extension:')) return;
  try {
    const result = await chrome.storage.local.get(self.BIAIF.STORAGE_KEY);
    const saved = result[self.BIAIF.STORAGE_KEY];
    if (!saved) return;
    const onActive  = !!saved.autoOpenOnKnownActive;
    const onDone    = !!saved.autoOpenOnKnownDone;
    const onAiPage  = !!saved.autoOpenOnAiPage;

    if (onAiPage) {
      try {
        const tabHostname = new URL(tabUrl).hostname;
        const isAiPage = (self.BIAIF.AI_ADAPTERS || []).some((a) =>
          tabHostname === a.host || tabHostname.endsWith('.' + a.host)
        );
        if (isAiPage) { await chrome.sidePanel.open({ tabId }); return; }
      } catch (_) {}
    }

    if (!onActive && !onDone) return;
    const demandes = saved.demandes || [];
    const shouldOpen = demandes.some((dem) => {
      if (!dem.conversationUrl) return false;
      // Tab URL starts with the conversation URL (handles trailing /new vs. /chat/ID)
      const urlMatch = tabUrl === dem.conversationUrl ||
        tabUrl.startsWith(dem.conversationUrl.split('?')[0]);
      if (!urlMatch) return false;
      const isDoneOrSubmitted = dem.status === 'done' || dem.status === 'submitted';
      return isDoneOrSubmitted ? onDone : onActive;
    });
    if (shouldOpen) await chrome.sidePanel.open({ tabId });
  } catch (_) {}
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    checkAutoOpenForTab(tabId, tab.url);
  } catch (_) {}
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    checkAutoOpenForTab(tabId, tab.url);
  }
});
