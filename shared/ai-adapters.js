/**
 * BIAIF AI Adapters — data-driven stop-button selectors per AI host.
 * Logic is frozen in the extension; only selectors live here (future: remote JSON).
 */
(function (root) {
  'use strict';
  root.BIAIF = root.BIAIF || {};
  // Online "open in" targets — single source of truth for the segment-card
  // online buttons + visibility toggles + i18n labels.
  // Each entry: { key, slug, label, i18nKey, webUrl, defaultVisible, exportFn }
  // Listed in the order they should appear on the segment card.
  root.BIAIF.AI_TARGETS = [
    { key: 'claude_online', slug: 'claude-online', label: 'Claude.ai',  i18nKey: 'btn.claude_online', webUrl: 'https://claude.ai/new',          defaultVisible: false, exportFn: 'openInClaudeOnline' },
    { key: 'chatgpt',       slug: 'chatgpt',       label: 'ChatGPT',    i18nKey: 'btn.chatgpt',       webUrl: 'https://chatgpt.com/',           defaultVisible: false, exportFn: 'openInChatgpt'      },
    { key: 'gemini',        slug: 'gemini',        label: 'Gemini',     i18nKey: 'btn.gemini',        webUrl: 'https://gemini.google.com/app',  defaultVisible: false, exportFn: 'openInGemini'       },
    { key: 'perplexity',    slug: 'perplexity',    label: 'Perplexity', i18nKey: 'btn.perplexity',    webUrl: 'https://www.perplexity.ai/',     defaultVisible: false, exportFn: 'openInPerplexity'   },
    { key: 'grok',          slug: 'grok',          label: 'Grok',       i18nKey: 'btn.grok',          webUrl: 'https://grok.com/',              defaultVisible: false, exportFn: 'openInGrok'         },
    { key: 'lechat',        slug: 'lechat',        label: 'Le Chat',    i18nKey: 'btn.lechat',        webUrl: 'https://chat.mistral.ai/chat',   defaultVisible: false, exportFn: 'openInLechat'       },
    { key: 'deepseek',      slug: 'deepseek',      label: 'DeepSeek',   i18nKey: 'btn.deepseek',      webUrl: 'https://chat.deepseek.com/',     defaultVisible: false, exportFn: 'openInDeepseek'     },
  ];

  // Local-action buttons (inject / vscode / copilot / copy / download)
  // Same shape as AI_TARGETS but without webUrl/exportFn (they have ad-hoc handlers).
  root.BIAIF.LOCAL_ACTIONS = [
    { key: 'inject',   slug: 'inject',   label: 'Injecter',                i18nKey: 'btn.inject',   defaultVisible: true,  exportFn: 'injectDemande'        },
    { key: 'vscode',   slug: 'vscode',   label: 'VS-Code Terminal',        i18nKey: 'btn.vscode',   defaultVisible: true,  exportFn: 'injectToVscode'       },
    { key: 'copilot',  slug: 'copilot',  label: 'VS-Code GH for Copilot',  i18nKey: 'btn.copilot',  defaultVisible: true,  exportFn: 'injectToCopilot'      },
    { key: 'copy',     slug: 'copy',     label: 'Copier',                  i18nKey: 'btn.copy',     defaultVisible: true,  exportFn: 'copyPromptForDemande' },
    { key: 'download', slug: 'download', label: '.MD',                     i18nKey: 'btn.download', defaultVisible: true,  exportFn: 'downloadDemande'      },
  ];

  // Convenience: full ordered list (local actions first, then online targets).
  root.BIAIF.ALL_BUTTONS = root.BIAIF.LOCAL_ACTIONS.concat(root.BIAIF.AI_TARGETS);

  root.BIAIF.AI_ADAPTERS = [
    {
      host: 'claude.ai',
      label: 'Claude.ai',
      webUrl: 'https://claude.ai/new',
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
      label: 'ChatGPT',
      webUrl: 'https://chatgpt.com/',
      stopBtn: [
        'button[data-testid="stop-button"]',
        'button[aria-label="Stop streaming"]',
        'button[aria-label="Stop generating"]',
        'button[aria-label="Stop"]',
      ],
    },
    {
      host: 'gemini.google.com',
      label: 'Gemini',
      webUrl: 'https://gemini.google.com/app',
      stopBtn: [
        'button[aria-label*="Stop"]',
        '.stop-button',
        'button.mat-mdc-icon-button[aria-label*="stop" i]',
      ],
    },
    {
      host: 'grok.com',
      label: 'Grok',
      webUrl: 'https://grok.com/',
      stopBtn: ['button[aria-label*="Stop" i]', '[data-testid="stop-button"]'],
    },
    {
      host: 'x.com',
      label: 'X',
      stopBtn: ['button[aria-label*="Stop" i]'],
    },
    {
      host: 'perplexity.ai',
      label: 'Perplexity',
      webUrl: 'https://www.perplexity.ai/',
      stopBtn: ['button[aria-label*="Stop" i]', '.stop-button'],
    },
    {
      host: 'chat.mistral.ai',
      label: 'Le Chat',
      webUrl: 'https://chat.mistral.ai/chat',
      stopBtn: ['button[aria-label*="Stop" i]', '.stop-button', 'button[class*="stop" i]'],
    },
    {
      host: 'mistral.ai',
      label: 'Mistral',
      stopBtn: ['button[aria-label*="Stop" i]', '.stop-button'],
    },
    {
      host: 'chat.deepseek.com',
      label: 'DeepSeek',
      webUrl: 'https://chat.deepseek.com/',
      stopBtn: ['button[aria-label*="Stop" i]', '[class*="stop" i]'],
    },
  ];
})(typeof window !== 'undefined' ? window : self);
