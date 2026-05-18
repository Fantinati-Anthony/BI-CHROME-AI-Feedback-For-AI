// @ts-check
/**
 * My-Feedbacks Export Targets
 *
 * Catalog of "send this feedback to…" destinations + the URL builders
 * that produce a deep-link pre-filled with the formatted prompt.
 *
 * The existing legacy export.js already implements injection into
 * Claude.ai and GitHub Copilot via content scripts. This module
 * provides URL-only fallbacks for everything else (Cursor, Aider,
 * generic ChatGPT, mailto:, etc.) so the user always has a path even
 * when the deep injection target isn't running locally.
 *
 * Each target has:
 *   - id            : stable string used in settings
 *   - label         : i18n key
 *   - icon          : short emoji or letter (for buttons)
 *   - kind          : 'inject' | 'url' | 'mailto' | 'cli'
 *   - build(prompt) : (mostly) returns a URL string the UI can window.open
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};

  function _encode(s) {
    return encodeURIComponent((s || '').slice(0, 7800));
  }

  /** @type {ReadonlyArray<{ id: string, label: string, icon: string, kind: string, build: (prompt: string, opts?: object) => string }>} */
  var TARGETS = Object.freeze([
    {
      id:    'claude',
      label: 'Claude.ai',
      icon:  '🟧',
      kind:  'url',
      build: function (prompt) {
        return 'https://claude.ai/new?q=' + _encode(prompt);
      },
    },
    {
      id:    'chatgpt',
      label: 'ChatGPT',
      icon:  '🟢',
      kind:  'url',
      build: function (prompt) {
        return 'https://chatgpt.com/?model=auto&q=' + _encode(prompt);
      },
    },
    {
      id:    'gemini',
      label: 'Gemini',
      icon:  '✨',
      kind:  'url',
      build: function () {
        // Gemini doesn't have a query URL — we'll fall back to clipboard
        // and open the page. UI handles the clipboard write.
        return 'https://gemini.google.com/app';
      },
    },
    {
      id:    'mistral',
      label: 'Mistral Chat',
      icon:  'M',
      kind:  'url',
      build: function () { return 'https://chat.mistral.ai/chat'; },
    },
    {
      id:    'perplexity',
      label: 'Perplexity',
      icon:  'P',
      kind:  'url',
      build: function (prompt) {
        return 'https://www.perplexity.ai/?q=' + _encode(prompt);
      },
    },
    {
      id:    'cursor',
      label: 'Cursor (VS Code fork)',
      icon:  '⌨',
      kind:  'cli',
      build: function (prompt) {
        // Cursor exposes a deep-link protocol cursor:// for the agent.
        return 'cursor://anysphere.cursor-deeplink/prompt?text=' + _encode(prompt);
      },
    },
    {
      id:    'aider',
      label: 'Aider (clipboard)',
      icon:  'A',
      kind:  'cli',
      build: function () {
        // Aider runs in a terminal — only clipboard path makes sense.
        return '';
      },
    },
    {
      id:    'vscode-copilot',
      label: 'VS Code Copilot Chat',
      icon:  '🛠',
      kind:  'inject',
      build: function () {
        // Handled by the legacy export.js via the local bridge.
        return '';
      },
    },
    {
      id:    'mailto',
      label: 'Email',
      icon:  '✉',
      kind:  'mailto',
      build: function (prompt, opts) {
        var to      = (opts && opts.to)      || '';
        var subject = (opts && opts.subject) || 'Feedback My-Feedbacks';
        return 'mailto:' + encodeURIComponent(to) +
               '?subject=' + _encode(subject) +
               '&body=' + _encode(prompt);
      },
    },
  ]);

  function byId(id) {
    for (var i = 0; i < TARGETS.length; i++) if (TARGETS[i].id === id) return TARGETS[i];
    return null;
  }

  /**
   * Build the open URL for a target + prompt. Returns null if the target
   * doesn't support URL navigation (e.g. aider, vscode-copilot — those
   * are handled by clipboard + native injection paths).
   * @param {string} targetId
   * @param {string} prompt
   * @param {object} [opts] kind-specific extras (e.g. { to } for mailto)
   * @returns {string | null}
   */
  function buildUrl(targetId, prompt, opts) {
    var t = byId(targetId);
    if (!t) return null;
    var url = t.build(prompt, opts);
    return url || null;
  }

  root.MyFb.core.exportTargets = {
    TARGETS:  TARGETS,
    byId:     byId,
    buildUrl: buildUrl,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MyFb.core.exportTargets;
  }
})(typeof window !== 'undefined' ? window : globalThis);
