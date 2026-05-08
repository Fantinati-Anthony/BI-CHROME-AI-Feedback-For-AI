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
      stopBtn: [
        'button[aria-label*="Stop"]',
        'button[aria-label*="stop"]',
        '[data-testid="stop-button"]',
        'button.stop-button',
        'button[data-value="stop"]',
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
