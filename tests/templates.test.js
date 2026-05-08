import { describe, it, expect, beforeEach } from 'vitest';

// Stub the storage call so persist() doesn't blow up
window.BIAIFStorage = { persist: () => {} };
loadAddonScript('sidepanel/templates.js');

describe('BIAIFTemplates', () => {
  let STATE;

  beforeEach(() => {
    STATE = { templates: [] };
    window.BIAIFTemplates.init(STATE);
  });

  it('init() ensures STATE.templates is an array', () => {
    const s = {};
    window.BIAIFTemplates.init(s);
    expect(Array.isArray(s.templates)).toBe(true);
  });

  it('add() stores a template with id, name and trimmed body', () => {
    const t = window.BIAIFTemplates.add({ name: 'Greet', body: 'Hello world' });
    expect(t.id).toMatch(/^tpl-/);
    expect(t.name).toBe('Greet');
    expect(t.body).toBe('Hello world');
    expect(STATE.templates).toHaveLength(1);
  });

  it('add() falls back to first line when no name given', () => {
    const t = window.BIAIFTemplates.add({ body: 'first line\nsecond line' });
    expect(t.name).toBe('first line');
  });

  it('add() returns null on empty body', () => {
    expect(window.BIAIFTemplates.add({ body: '' })).toBe(null);
    expect(window.BIAIFTemplates.add(null)).toBe(null);
  });

  it('list() returns templates newest-first', async () => {
    const a = window.BIAIFTemplates.add({ body: 'a' });
    await new Promise((r) => setTimeout(r, 5));
    const b = window.BIAIFTemplates.add({ body: 'b' });
    const list = window.BIAIFTemplates.list();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it('remove() returns false for unknown id', () => {
    expect(window.BIAIFTemplates.remove('nope')).toBe(false);
  });

  it('remove() drops the matching template', () => {
    const t = window.BIAIFTemplates.add({ body: 'x' });
    expect(window.BIAIFTemplates.remove(t.id)).toBe(true);
    expect(STATE.templates).toHaveLength(0);
  });

  it('rename() updates the name', () => {
    const t = window.BIAIFTemplates.add({ body: 'x' });
    expect(window.BIAIFTemplates.rename(t.id, 'New name')).toBe(true);
    expect(STATE.templates[0].name).toBe('New name');
  });
});
