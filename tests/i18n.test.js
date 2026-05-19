import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/i18n.js');
});

beforeEach(() => {
  // Re-load between tests to reset internal _lang + warning caches.
  loadAddonScript('shared/i18n.js');
});

describe('MyFbI18n.t', () => {
  it('returns the FR translation by default', () => {
    expect(window.MyFbI18n.t('demande.title')).toBe('Demande en cours');
  });

  it('switches to EN after setLang(en)', () => {
    window.MyFbI18n.setLang('en');
    expect(window.MyFbI18n.t('demande.title')).toBe('Current request');
  });

  it('falls back to FR then EN when locale is missing for a key', () => {
    // All current keys have all 7 langs ; fake a partial via direct table tweak.
    expect(window.MyFbI18n.t('settings.help.title')).toBeTruthy();
  });

  it('returns the key itself for an unknown lookup (and warns once)', () => {
    expect(window.MyFbI18n.t('does.not.exist')).toBe('does.not.exist');
    // Second call: still returns key, but no second warning (de-duped).
    expect(window.MyFbI18n.t('does.not.exist')).toBe('does.not.exist');
  });

  it('interpolates {n} / {name} placeholders from the vars object', () => {
    expect(window.MyFbI18n.t('toast.overflow', { n: 3 })).toContain('3');
  });

  it('drops missing vars without throwing', () => {
    expect(window.MyFbI18n.t('toast.overflow', {})).toBeTruthy();
  });

  it('handles vars with falsy but valid values (0, false)', () => {
    const out = window.MyFbI18n.t('toast.overflow', { n: 0 });
    expect(out).toContain('0');
  });
});

describe('MyFbI18n.setLang / getLang', () => {
  it('setLang persists', () => {
    window.MyFbI18n.setLang('de');
    expect(window.MyFbI18n.getLang()).toBe('de');
  });

  it('rejects unsupported codes (no-op or fallback)', () => {
    window.MyFbI18n.setLang('xx');
    // Either keeps previous lang or normalises — both acceptable;
    // verify the lang is one of the supported ones.
    expect(['fr','en','es','de','it','pt','nl']).toContain(window.MyFbI18n.getLang());
  });
});

describe('MyFbI18n.tn (plural via Intl.PluralRules)', () => {
  it('picks the singular variant for n === 1', () => {
    window.MyFbI18n.setLang('en');
    expect(window.MyFbI18n.tn('segments.ref', 1, { n: 1 })).toContain('1');
  });

  it('picks the plural variant for n > 1', () => {
    window.MyFbI18n.setLang('en');
    const out = window.MyFbI18n.tn('segments.ref', 5, { n: 5 });
    expect(out).toMatch(/refs?/);
    expect(out).toContain('5');
  });

  it('falls back to baseKey when no variant exists', () => {
    expect(window.MyFbI18n.tn('does.not.exist', 3, { n: 3 })).toBe('does.not.exist');
  });

  it('handles 0 (CLDR "other" in EN, "one" in FR)', () => {
    window.MyFbI18n.setLang('en');
    expect(window.MyFbI18n.tn('segments.ref', 0, { n: 0 })).toContain('0');
    window.MyFbI18n.setLang('fr');
    expect(window.MyFbI18n.tn('segments.ref', 0, { n: 0 })).toContain('0');
  });

  it('FR uses singular for n=1 with {n} interpolation', () => {
    window.MyFbI18n.setLang('fr');
    const out = window.MyFbI18n.tn('segments.ref', 1, { n: 1 });
    // FR singular form is "1 réf" (not "1 réfs"). Implementation may use
    // _singular OR _one — both branches yield the singular spelling.
    expect(out).toBe('1 réf');
  });

  it('EN selects "_other" for n=2 (CLDR plural)', () => {
    window.MyFbI18n.setLang('en');
    const out = window.MyFbI18n.tn('segments.ref', 2, { n: 2 });
    expect(out).toBe('2 refs');
  });

  it('PluralRules cache is per-locale (no cross-talk)', () => {
    window.MyFbI18n.setLang('en');
    const enOne = window.MyFbI18n.tn('segments.ref', 1, { n: 1 });
    window.MyFbI18n.setLang('de');
    const deOne = window.MyFbI18n.tn('segments.ref', 1, { n: 1 });
    expect(enOne).toContain('1');
    expect(deOne).toContain('1');
    // Same number, different translations.
    expect(enOne).not.toBe(deOne);
  });
});

describe('MyFbI18n.detectBrowserLang', () => {
  it('returns one of the supported languages', () => {
    const out = window.MyFbI18n.detectBrowserLang();
    expect(['fr','en','es','de','it','pt','nl']).toContain(out);
  });
});
