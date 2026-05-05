/**
 * BIAIF Shared Constants
 * Single source of truth for all message types, storage keys, and version.
 * Loaded in service worker via importScripts(), in content scripts and side panel via <script>.
 */
(function (root) {
  'use strict';

  root.BIAIF = root.BIAIF || {};

  root.BIAIF.VERSION = '0.4.0';

  root.BIAIF.STORAGE_KEY = 'biaif:v04:state';
  root.BIAIF.STORAGE_LEGACY_KEYS = ['biaif:v03:state', 'biaif:v02:state', 'biaif:v01:state'];

  root.BIAIF.MSG = Object.freeze({
    // Commands routed by SW to active tab content script
    COMMAND:           'biaif:command',
    // Picker
    PICKER_TOGGLE:     'biaif:picker-toggle',
    PICKER_ENABLE:     'biaif:picker-enable',
    PICKER_DISABLE:    'biaif:picker-disable',
    PICKER_STATE:      'biaif:picker-state',
    ELEMENT_PICKED:    'biaif:element-picked',
    // Capture
    CAPTURE_MODE:      'biaif:capture-mode',
    CAPTURE_TAB:       'biaif:capture-tab',
    CAPTURE_PROGRESS:  'biaif:capture-progress',
    // Annotation
    ANNOTATE:          'biaif:annotate',
    // Errors
    GET_ERRORS:        'biaif:get-errors',
    CONSOLE_ERROR:     'biaif:console-error',
    // Navigation & UI
    HOTKEY:            'biaif:hotkey',
    RELOAD_ACTIVE_TAB: 'biaif:reload-active-tab',
    // Context menu forwarding
    CONTEXT_STATUS:    'biaif:context-status',
    CONTEXT_SHOT:      'biaif:context-shot',
    CONTEXT_ADD_TEXT:  'biaif:context-add-text',
    CONTEXT_ADD_IMAGE: 'biaif:context-add-image',
    // CustomEvent name (MAIN world → isolated world bridge)
    PAGE_ERROR_EVENT:  '__biaif_page_error__',
  });

})(typeof window !== 'undefined' ? window : self);
