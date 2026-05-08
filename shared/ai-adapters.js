/**
 * BIAIF AI Adapters — data-driven stop-button selectors per AI host.
 * Logic is frozen in the extension; only selectors live here (future: remote JSON).
 */
(function (root) {
  'use strict';
  root.BIAIF = root.BIAIF || {};
  root.BIAIF.AI_ADAPTERS = [
    {
      host: 'claude.ai',
      // Tiptap/ProseMirror editor selectors (most specific first).
      editor: [
        'div[contenteditable="true"][aria-label="Prompt"].ProseMirror',
        'div.tiptap[contenteditable="true"]',
        'div.ProseMirror[contenteditable="true"]',
        'div[contenteditable="true"][aria-label="Prompt"]',
        'div[contenteditable="true"]',
      ],
      stopBtn: [
        'button[aria-label="Stop"]',
        'button[aria-label*="Stop"]',
        'button[aria-label*="stop"]',
        '[data-testid="stop-button"]',
        'button.stop-button',
        'button[data-value="stop"]',
      ],
      // Element visible ONLY while Claude is thinking or generating.
      // After generation Claude sets opacity-0 (transition-opacity) without
      // removing the element from the DOM — require opacity-100 to be present.
      generatingEl: [
        'div.text-assistant-secondary.tabular-nums.opacity-100',
        'div.tabular-nums.text-assistant-secondary.opacity-100',
        // fallback: no opacity class (element simply disappears when done)
        'div.text-assistant-secondary.tabular-nums:not(.opacity-0)',
      ],
      // CSS selectors for the native input area to hide (visibility:hidden, keeping layout).
      // Applied when hideAiTextarea setting is on.
      // The first selector targets the parent container of the prompt blur div
      // (identified by data-surface="prompt" aria-hidden="true").
      inputHide: [
        'div:has(> [aria-hidden="true"][data-surface="prompt"])',
        '[aria-hidden="true"][data-surface="prompt"]',
        'div[contenteditable="true"][aria-label="Prompt"].ProseMirror',
      ],
      // Submit button selectors (for auto-submit after injection)
      submitBtn: [
        'button[aria-label="Send message"]',
        'button[aria-label*="Send"]',
        'button[data-testid="send-button"]',
        'button[type="submit"]',
      ],
    },
    {
      host: 'chatgpt.com',
      stopBtn: [
        'button[data-testid="stop-button"]',
        'button[aria-label="Stop streaming"]',
        'button[aria-label="Stop generating"]',
        'button[aria-label="Stop"]',
      ],
    },
    {
      host: 'gemini.google.com',
      stopBtn: [
        'button[aria-label*="Stop"]',
        '.stop-button',
        'button.mat-mdc-icon-button[aria-label*="stop" i]',
      ],
    },
    {
      host: 'grok.com',
      stopBtn: ['button[aria-label*="Stop" i]', '[data-testid="stop-button"]'],
    },
    {
      host: 'x.com',
      stopBtn: ['button[aria-label*="Stop" i]'],
    },
    {
      host: 'perplexity.ai',
      stopBtn: ['button[aria-label*="Stop" i]', '.stop-button'],
    },
    {
      host: 'chat.mistral.ai',
      stopBtn: ['button[aria-label*="Stop" i]', '.stop-button', 'button[class*="stop" i]'],
    },
    {
      host: 'mistral.ai',
      stopBtn: ['button[aria-label*="Stop" i]', '.stop-button'],
    },
    {
      host: 'chat.deepseek.com',
      stopBtn: ['button[aria-label*="Stop" i]', '[class*="stop" i]'],
    },
  ];
})(typeof window !== 'undefined' ? window : self);
