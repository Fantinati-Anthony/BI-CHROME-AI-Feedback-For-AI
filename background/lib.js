/**
 * MyFb Service Worker — shared library
 *
 * Imported via importScripts() into the global SW scope. Declares the
 * cross-module constants (MSG, sleep, sendToActiveTabContent,
 * openSidePanelForActive, waitForTabLoaded). Other background/*.js files
 * reference these by their bare names since importScripts shares scope.
 */

/* global self */

const MSG = self.MyFb.MSG;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openSidePanelForActive() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) await chrome.sidePanel.open({ tabId: tab.id });
  } catch (e) {
    console.warn('[MyFb] sidePanel.open failed', e?.message || e);
  }
}

async function sendToActiveTabContent(payload) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return { error: 'no active tab' };
    return await chrome.tabs.sendMessage(tab.id, payload);
  } catch (e) {
    console.warn('[MyFb] sendToActiveTabContent failed', e?.message || e);
    return { error: e?.message || String(e) };
  }
}

// Resolves when the tab finishes loading (status === 'complete') or after
// timeoutMs. Used before injectWithRetry() to avoid hammering the editor
// before the page has even rendered.
function waitForTabLoaded(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs || 15000);
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}
