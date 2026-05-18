/**
 * MyFb Service Worker — entry point.
 *
 * importScripts() concatenates each file into the same global SW scope
 * (top-down). Modules under background/ rely on that: declarations in
 * lib.js (MSG, sleep, sendToActiveTabContent, …) are visible to every
 * file imported after it.
 *
 * Module map (load in order):
 *   shared/                — constants, config, utils, logger, AI adapters
 *   background/lib.js      — MSG, sleep, sendToActiveTabContent,
 *                            openSidePanelForActive, waitForTabLoaded
 *   background/capture.js  — captureVisibleTab queue + retry + rate-limit
 *   background/inject.js   — injectWithRetry (waits for editor DOM)
 *   background/context-menu.js — chrome.contextMenus (4 entries) + relay
 *   background/auto-open.js    — chrome.tabs.onActivated/onUpdated + auto-
 *                                open sidepanel on known AI / tracked URLs
 *   background/commands.js     — chrome.commands hotkey routing
 *   background/messages.js     — chrome.runtime.onMessage routing
 */

importScripts('shared/constants.js');
importScripts('shared/config.js');
importScripts('shared/utils.js');
importScripts('shared/logger.js');
importScripts('shared/ai-adapters.js');

importScripts('background/lib.js');
importScripts('background/capture.js');
importScripts('background/inject.js');
importScripts('background/context-menu.js');
importScripts('background/auto-open.js');
importScripts('background/commands.js');
importScripts('background/messages.js');

// Side panel: open on toolbar icon click. Must be registered at
// top-level so MV3 wakes the SW for action clicks.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
