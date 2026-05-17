/**
 * MyFb Service Worker — context menus
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
      id: 'myfb-element',
      title: 'MyFb — Ajouter cet élément (sélecteur)',
      contexts: ['page', 'frame', 'image', 'link', 'selection'],
    });
    chrome.contextMenus.create({
      id: 'myfb-capture-visible',
      title: 'MyFb — Capturer le viewport visible',
      contexts: ['page', 'frame', 'image', 'link', 'selection'],
    });
    chrome.contextMenus.create({
      id: 'myfb-selection',
      title: 'MyFb — Ajouter cette sélection à la demande',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'myfb-new-segment',
      title: 'MyFb — Créer un segment depuis la sélection',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'myfb-append-text',
      title: 'MyFb — Ajouter à la demande en cours',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'myfb-image',
      title: 'MyFb — Ajouter cette image',
      contexts: ['image'],
    });
  });
}
chrome.runtime.onInstalled.addListener(setupContextMenus);
chrome.runtime.onStartup.addListener(setupContextMenus);

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try { if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id }); } catch (_) {}

    if (info.menuItemId === 'myfb-element') {
      sendToActiveTabContent({ type: MSG.COMMAND, action: 'picker-enable' });
      chrome.runtime.sendMessage({
        type: MSG.CONTEXT_STATUS,
        msg: 'Sélecteur activé — cliquez l\'élément à référencer.',
      }).catch(() => {});
    } else if (info.menuItemId === 'myfb-capture-visible') {
      chrome.runtime.sendMessage({
        type: MSG.CONTEXT_SHOT, mode: 'visible',
        pageUrl: info.pageUrl || tab?.url || null,
      }).catch(() => {});
    } else if (info.menuItemId === 'myfb-selection') {
      chrome.runtime.sendMessage({
        type: MSG.CONTEXT_ADD_TEXT,
        text: info.selectionText || '',
        pageUrl: info.pageUrl || tab?.url || null,
      }).catch(() => {});
    } else if (info.menuItemId === 'myfb-new-segment') {
      chrome.runtime.sendMessage({
        type: MSG.CONTEXT_NEW_SEGMENT,
        text: info.selectionText || '',
        pageUrl: info.pageUrl || tab?.url || null,
      }).catch(() => {});
    } else if (info.menuItemId === 'myfb-append-text') {
      chrome.runtime.sendMessage({
        type: MSG.CONTEXT_APPEND_TEXT,
        text: info.selectionText || '',
        pageUrl: info.pageUrl || tab?.url || null,
      }).catch(() => {});
    } else if (info.menuItemId === 'myfb-image') {
      chrome.runtime.sendMessage({
        type: MSG.CONTEXT_ADD_IMAGE,
        srcUrl: info.srcUrl || '',
        pageUrl: info.pageUrl || tab?.url || null,
      }).catch(() => {});
    }
  });
}
