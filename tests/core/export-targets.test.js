import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/core/export-targets.js');
});

describe('exportTargets — catalog', () => {
  it('exposes the 9 known targets', () => {
    const ids = window.MyFb.core.exportTargets.TARGETS.map((t) => t.id);
    expect(ids).toEqual(['claude', 'chatgpt', 'gemini', 'mistral', 'perplexity', 'cursor', 'aider', 'vscode-copilot', 'mailto']);
  });

  it('byId() looks up a known target', () => {
    expect(window.MyFb.core.exportTargets.byId('claude').label).toBe('Claude.ai');
  });

  it('byId() returns null for unknown targets', () => {
    expect(window.MyFb.core.exportTargets.byId('not-a-thing')).toBeNull();
  });
});

describe('exportTargets — URL builders', () => {
  const ET = () => window.MyFb.core.exportTargets;

  it('claude builds claude.ai/new?q=…', () => {
    const url = ET().buildUrl('claude', 'hello world');
    expect(url).toMatch(/^https:\/\/claude\.ai\/new\?q=/);
    expect(url).toContain('hello%20world');
  });

  it('chatgpt builds chatgpt.com/?q=…', () => {
    const url = ET().buildUrl('chatgpt', 'hi');
    expect(url).toMatch(/chatgpt\.com\/\?model=auto&q=/);
    expect(url).toContain('hi');
  });

  it('perplexity builds perplexity.ai/?q=…', () => {
    const url = ET().buildUrl('perplexity', 'why');
    expect(url).toContain('perplexity.ai/?q=why');
  });

  it('cursor builds the cursor:// deep-link', () => {
    const url = ET().buildUrl('cursor', 'fix the bug');
    expect(url).toMatch(/^cursor:\/\/anysphere\.cursor-deeplink\/prompt\?text=/);
    expect(url).toContain('fix%20the%20bug');
  });

  it('mailto encodes to/subject/body correctly', () => {
    const url = ET().buildUrl('mailto', 'feedback here', { to: 'dev@example.com', subject: 'Bug 42' });
    expect(url.startsWith('mailto:dev%40example.com')).toBe(true);
    expect(url).toContain('subject=Bug%2042');
    expect(url).toContain('body=feedback%20here');
  });

  it('aider and vscode-copilot return null URLs (handled via clipboard / bridge)', () => {
    expect(ET().buildUrl('aider', 'x')).toBeNull();
    expect(ET().buildUrl('vscode-copilot', 'x')).toBeNull();
  });

  it('gemini returns base URL only (no query param support)', () => {
    expect(ET().buildUrl('gemini', 'x')).toBe('https://gemini.google.com/app');
  });

  it('buildUrl() truncates oversized prompts to fit URL length limits', () => {
    const big = 'a'.repeat(10000);
    const url = ET().buildUrl('claude', big);
    expect(url.length).toBeLessThan(10000);
  });

  it('buildUrl() returns null for unknown target ids', () => {
    expect(ET().buildUrl('moonshot', 'hi')).toBeNull();
  });
});
