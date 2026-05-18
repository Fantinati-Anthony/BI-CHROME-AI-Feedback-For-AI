import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub the storage call so persist() doesn't blow up
window.MyFbStorage = { persist: () => {} };
loadAddonScript('sidepanel/templates.js');

describe('MyFbTemplates', () => {
  let STATE;

  beforeEach(() => {
    STATE = { templates: [] };
    window.MyFbTemplates.init(STATE);
  });

  it('init() ensures STATE.templates is an array', () => {
    const s = {};
    window.MyFbTemplates.init(s);
    expect(Array.isArray(s.templates)).toBe(true);
  });

  it('add() stores a template with id, name and trimmed body', () => {
    const t = window.MyFbTemplates.add({ name: 'Greet', body: 'Hello world' });
    expect(t.id).toMatch(/^tpl-/);
    expect(t.name).toBe('Greet');
    expect(t.body).toBe('Hello world');
    expect(STATE.templates).toHaveLength(1);
  });

  it('add() falls back to first line when no name given', () => {
    const t = window.MyFbTemplates.add({ body: 'first line\nsecond line' });
    expect(t.name).toBe('first line');
  });

  it('add() returns null on empty body', () => {
    expect(window.MyFbTemplates.add({ body: '' })).toBe(null);
    expect(window.MyFbTemplates.add(null)).toBe(null);
  });

  it('list() returns templates newest-first', async () => {
    const a = window.MyFbTemplates.add({ body: 'a' });
    await new Promise((r) => setTimeout(r, 5));
    const b = window.MyFbTemplates.add({ body: 'b' });
    const list = window.MyFbTemplates.list();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it('remove() returns false for unknown id', () => {
    expect(window.MyFbTemplates.remove('nope')).toBe(false);
  });

  it('remove() drops the matching template', () => {
    const t = window.MyFbTemplates.add({ body: 'x' });
    expect(window.MyFbTemplates.remove(t.id)).toBe(true);
    expect(STATE.templates).toHaveLength(0);
  });

  it('rename() updates the name', () => {
    const t = window.MyFbTemplates.add({ body: 'x' });
    expect(window.MyFbTemplates.rename(t.id, 'New name')).toBe(true);
    expect(STATE.templates[0].name).toBe('New name');
  });
});

describe('MyFbTemplates.interpolate', () => {
  let STATE;
  beforeEach(() => {
    STATE = {
      templates: [],
      currentDemande: { text: '', refs: [{ text: 'foo()', selector: '.btn' }], pageUrl: 'https://example.com/page' },
      pendingRepoId: 'acme/app',
      uiLang: 'fr',
      lang:   'fr-FR',
      demandes: [{}, {}, {}],
    };
    window.MyFbTemplates.init(STATE);
  });

  it('passes through strings without {{...}}', () => {
    expect(window.MyFbTemplates.interpolate('plain text')).toBe('plain text');
  });

  it('replaces {{url}} with currentDemande.pageUrl', () => {
    expect(window.MyFbTemplates.interpolate('see {{url}}')).toBe('see https://example.com/page');
  });

  it('replaces {{repo}} with pendingRepoId', () => {
    expect(window.MyFbTemplates.interpolate('repo: {{repo}}')).toBe('repo: acme/app');
  });

  it('replaces {{selection}} from the last ref', () => {
    expect(window.MyFbTemplates.interpolate('refacto {{selection}}')).toBe('refacto foo()');
  });

  it('replaces {{date}} with YYYY-MM-DD', () => {
    const out = window.MyFbTemplates.interpolate('today {{date}}');
    expect(out).toMatch(/^today \d{4}-\d{2}-\d{2}$/);
  });

  it('replaces {{n}} with the demandes count', () => {
    expect(window.MyFbTemplates.interpolate('{{n}} requests')).toBe('3 requests');
  });

  it('returns empty string for unknown built-ins', () => {
    expect(window.MyFbTemplates.interpolate('hi {{nope}}')).toBe('hi ');
  });

  it('asks for {{var:name}} via prompt() and caches the answer for the same insertion', () => {
    window.prompt = vi.fn().mockReturnValue('blue');
    const out = window.MyFbTemplates.interpolate('color: {{var:color}} and {{var:color}}');
    expect(out).toBe('color: blue and blue');
    expect(window.prompt).toHaveBeenCalledTimes(1);
  });
});
