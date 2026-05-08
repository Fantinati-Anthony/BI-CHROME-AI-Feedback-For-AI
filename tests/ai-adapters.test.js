import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/ai-adapters.js');
});

describe('shared/ai-adapters registries', () => {
  it('exposes LOCAL_ACTIONS, AI_TARGETS and ALL_BUTTONS', () => {
    expect(Array.isArray(window.BIAIF.LOCAL_ACTIONS)).toBe(true);
    expect(Array.isArray(window.BIAIF.AI_TARGETS)).toBe(true);
    expect(Array.isArray(window.BIAIF.ALL_BUTTONS)).toBe(true);
  });

  it('ALL_BUTTONS = LOCAL_ACTIONS + AI_TARGETS in that order', () => {
    const all = window.BIAIF.ALL_BUTTONS;
    const expected = window.BIAIF.LOCAL_ACTIONS.concat(window.BIAIF.AI_TARGETS);
    expect(all).toHaveLength(expected.length);
    all.forEach((def, i) => expect(def.key).toBe(expected[i].key));
  });

  it('every entry has key/slug/label/i18nKey/exportFn/defaultVisible', () => {
    window.BIAIF.ALL_BUTTONS.forEach((def) => {
      expect(typeof def.key).toBe('string');
      expect(typeof def.slug).toBe('string');
      expect(typeof def.label).toBe('string');
      expect(typeof def.i18nKey).toBe('string');
      expect(typeof def.exportFn).toBe('string');
      expect(typeof def.defaultVisible).toBe('boolean');
    });
  });

  it('local actions are visible by default; AI targets are not', () => {
    window.BIAIF.LOCAL_ACTIONS.forEach((d) => expect(d.defaultVisible).toBe(true));
    window.BIAIF.AI_TARGETS.forEach((d)   => expect(d.defaultVisible).toBe(false));
  });

  it('keys are unique across the registry', () => {
    const keys = window.BIAIF.ALL_BUTTONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('AI_ADAPTERS preserves selectors per host', () => {
    const claude = window.BIAIF.AI_ADAPTERS.find((a) => a.host === 'claude.ai');
    expect(claude).toBeDefined();
    expect(Array.isArray(claude.editor)).toBe(true);
    expect(Array.isArray(claude.stopBtn)).toBe(true);
  });
});
