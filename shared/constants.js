// @ts-check
/**
 * MyFb Shared Constants
 * Single source of truth for all message types, storage keys, and version.
 * Loaded in service worker via importScripts(), in content scripts and side panel via <script>.
 */
(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};

  root.MyFb.VERSION = '0.5.0';

  root.MyFb.STORAGE_KEY = 'myfb:v1:state';
  root.MyFb.STORAGE_LEGACY_KEYS = ['myfb:legacy:dropped'];

  root.MyFb.MSG = Object.freeze({
    // Commands routed by SW to active tab content script
    COMMAND:           'myfb:command',
    // Picker
    PICKER_TOGGLE:     'myfb:picker-toggle',
    PICKER_ENABLE:     'myfb:picker-enable',
    PICKER_DISABLE:    'myfb:picker-disable',
    PICKER_STATE:      'myfb:picker-state',
    ELEMENT_PICKED:    'myfb:element-picked',
    // Capture
    CAPTURE_MODE:      'myfb:capture-mode',
    CAPTURE_TAB:       'myfb:capture-tab',
    CAPTURE_PROGRESS:  'myfb:capture-progress',
    // Annotation
    ANNOTATE:          'myfb:annotate',
    // Errors
    GET_ERRORS:        'myfb:get-errors',
    CONSOLE_ERROR:     'myfb:console-error',
    // Navigation & UI
    HOTKEY:            'myfb:hotkey',
    RELOAD_ACTIVE_TAB: 'myfb:reload-active-tab',
    // Context menu forwarding
    CONTEXT_STATUS:        'myfb:context-status',
    CONTEXT_SHOT:          'myfb:context-shot',
    CONTEXT_ADD_TEXT:      'myfb:context-add-text',
    CONTEXT_ADD_IMAGE:     'myfb:context-add-image',
    CONTEXT_NEW_SEGMENT:   'myfb:context-new-segment',
    CONTEXT_APPEND_TEXT:   'myfb:context-append-text',
    // CustomEvent name (MAIN world → isolated world bridge)
    PAGE_ERROR_EVENT:  '__myfb_page_error__',
    // Inject into external editor (Claude.ai)
    INJECT_TO_EDITOR:  'myfb:inject-to-editor',
    // Inject into VS Code via local bridge
    INJECT_TO_VSCODE:  'myfb:inject-to-vscode',
    // DB Bridge — extension → SW → user's site/server companion endpoint
    DB_BRIDGE_CALL:    'myfb:db-bridge-call',
    // Content script → SW → sidepanel: open panel filtered to a conversation
    OPEN_WITH_FILTER:      'myfb:open-with-filter',
    // Content script → SW → sidepanel: start new session linked to a conversation
    START_LINKED_SEGMENT:  'myfb:start-linked-segment',
    // AI watcher → SW → sidepanel: AI started or stopped generating
    AI_STATUS_UPDATE:      'myfb:ai-status-update',
    // AI watcher → SW → sidepanel: AI response completed
    AI_RESPONSE_DONE:      'myfb:ai-response-done',
    // Page ref overlays (Feature A — v1.3)
    OVERLAYS_RENDER:       'myfb:overlays-render',     // sidepanel → content: re-render with these refs
    OVERLAYS_CLEAR:        'myfb:overlays-clear',      // sidepanel → content: hide all
    OVERLAYS_FOCUS_REF:    'myfb:overlays-focus-ref',  // content → sidepanel: badge clicked, open this demande
  });

  root.MyFb.VSCODE_BRIDGE_PORT = 51473;
  root.MyFb.VSCODE_BRIDGE_PORTS_COUNT = 10;

})(typeof window !== 'undefined' ? window : self);
