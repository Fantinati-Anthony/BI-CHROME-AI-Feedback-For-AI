/**
 * BIAIF Service Worker — context menus
 *
 * Registers four entries on right-click and routes the corresponding
 * action to either the active tab's content script (picker) or the
 * sidepanel (capture / text / image).
 */

/* eslint-disable no-undef */

function setupContextMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'biaif-element',
      title: 'BIAIF — Ajouter cet élément (sélecteur)',
      contexts: ['page', 'frame', 'image', 'link', 'selection'],
    });
    chrome.contextMenus.create({
      id: 'biaif-capture-visible',
      title: 'BIAIF — Capturer le viewport visible',
      contexts: ['page', 'frame', 'image', 'link', 'selection'],
    });
    chrome.contextMenus.create({
      id: 'biaif-selection',
      title: 'BIAIF — Ajouter cette sélection à la demande',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'biaif-new-segment',
      title: 'BIAIF — Créer un segment depuis la sélection',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'biaif-append-text',
      title: 'BIAIF — Ajouter à la demande en cours',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'biaif-image',
      title: 'BIAIF — Ajouter cette image',
      contexts: ['image'],
    });
  });
}
chrome.runtime.onInstalled.addListener(setupContextMenus);
chrome.runtime.onStartup.addListener(setupContextMenus);

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try { if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id }); } catch (_) {}

    if (info.menuItemId === 'biaif-element') {
      sendToActiveTabContent({ type: MSG.COMMAND, action: 'picker-enable' });
      chrome.runtime.sendMessage({
        type: MSG.CONTEXT_STATUS,
        msg: 'Sélecteur activé — cliquez l\'élément à référencer.',
      }).catch(() => {});
    } else if (info.menuItemId === 'biaif-capture-visible') {
      chrome.runtime.sendMessage({
        type: MSG.CONTEXT_SHOT, mode: 'visible',
        pageUrl: info.pageUrl || tab?.url || null,
      }).catch(() => {});
    } else if (info.menuItemId === 'biaif-selection') {
      chrome.runtime.sendMessage({
        type: MSG.CONTEXT_ADD_TEXT,
        text: info.selectionText || '',
        pageUrl: info.pageUrl || tab?.url || null,
      }).catch(() => {});
    } else if (info.menuItemId === 'biaif-new-segment') {
      chrome.runtime.sendMessage({
        type: MSG.CONTEXT_NEW_SEGMENT,
        text: info.selectionText || '',
        pageUrl: info.pageUrl || tab?.url || null,
      }).catch(() => {});
    } else if (info.menuItemId === 'biaif-append-text') {
      chrome.runtime.sendMessage({
        type: MSG.CONTEXT_APPEND_TEXT,
        text: info.selectionText || '',
        pageUrl: info.pageUrl || tab?.url || null,
      }).catch(() => {});
    } else if (info.menuItemId === 'biaif-image') {
      chrome.runtime.sendMessage({
        type: MSG.CONTEXT_ADD_IMAGE,
        srcUrl: info.srcUrl || '',
        pageUrl: info.pageUrl || tab?.url || null,
      }).catch(() => {});
    }
  });
}
