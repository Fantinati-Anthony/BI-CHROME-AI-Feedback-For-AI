/**
 * Tests for BIAIFStorage.importBundle's schema validation guards.
 * These prevent a malicious or malformed export from poisoning STATE.
 */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/constants.js');
  loadAddonScript('shared/utils.js');
  loadAddonScript('shared/scrub.js');
  loadAddonScript('sidepanel/undo.js');
  loadAddonScript('sidepanel/storage.js');
});

function makeState() {
  return {
    demandes: [], currentDemande: { text: '', refs: [], pageUrl: null },
    templates: [], visibleButtons: {},
  };
}

describe('importBundle — envelope validation', () => {
  it('rejects null / undefined / non-object', () => {
    expect(window.BIAIFStorage.importBundle(makeState(), null).ok).toBe(false);
    expect(window.BIAIFStorage.importBundle(makeState(), undefined).ok).toBe(false);
    expect(window.BIAIFStorage.importBundle(makeState(), 'string').ok).toBe(false);
    expect(window.BIAIFStorage.importBundle(makeState(), 42).ok).toBe(false);
  });

  it('rejects bundles without the magic header', () => {
    const r = window.BIAIFStorage.importBundle(makeState(), { _version: 1, data: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('wrong-magic');
  });

  it('rejects bundles with a wrong magic value', () => {
    const r = window.BIAIFStorage.importBundle(makeState(), { _biaif: 'not-an-export', _version: 1, data: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('wrong-magic');
  });

  it('rejects bundles with a non-numeric _version', () => {
    const r = window.BIAIFStorage.importBundle(makeState(), { _biaif: 'export', _version: 'v1', data: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('bad-version');
  });

  it('rejects bundles with a missing data object', () => {
    const r = window.BIAIFStorage.importBundle(makeState(), { _biaif: 'export', _version: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no-data');
  });
});

describe('importBundle — demande validation', () => {
  const ok = (data) => ({ _biaif: 'export', _version: 1, data });

  it('rejects demandes that aren\'t arrays', () => {
    const r = window.BIAIFStorage.importBundle(makeState(), ok({ demandes: 'oops' }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('demandes-shape');
  });

  it('rejects demandes with a text > MAX_TEXT', () => {
    const oversized = { text: 'x'.repeat(50001), refs: [] };
    const r = window.BIAIFStorage.importBundle(makeState(), ok({ demandes: [oversized] }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('demandes-invalid');
  });

  it('rejects refs with an unsafe URL', () => {
    const bad = { text: 'x', refs: [{ type: 'el', tabUrl: 'javascript:alert(1)' }] };
    const r = window.BIAIFStorage.importBundle(makeState(), ok({ demandes: [bad] }));
    expect(r.ok).toBe(false);
  });

  it('rejects refs with a malformed dataUrl', () => {
    const bad = { text: 'x', refs: [{ type: 'screenshot', dataUrl: 'data:text/html,<script>' }] };
    const r = window.BIAIFStorage.importBundle(makeState(), ok({ demandes: [bad] }));
    expect(r.ok).toBe(false);
  });

  it('accepts a clean bundle with demandes + templates', () => {
    const STATE = makeState();
    const bundle = ok({
      demandes: [{ text: 'hello', refs: [{ type: 'el', selector: '.btn' }], url: 'https://x.com/' }],
      templates: [{ name: 'T', body: 'B', id: 't1', ts: 0 }],
      sortOrder: 'asc',
    });
    const r = window.BIAIFStorage.importBundle(STATE, bundle);
    expect(r.ok).toBe(true);
    expect(r.imported).toBe(1);
    expect(STATE.demandes).toHaveLength(1);
    expect(STATE.templates).toHaveLength(1);
    expect(STATE.sortOrder).toBe('asc');
  });

  it('drops unknown settings keys (whitelist)', () => {
    const STATE = makeState();
    const bundle = ok({ demandes: [], unknownEvil: 'pwned' });
    window.BIAIFStorage.importBundle(STATE, bundle);
    expect(STATE.unknownEvil).toBeUndefined();
  });
});

describe('importBundle — templates validation', () => {
  const ok = (data) => ({ _biaif: 'export', _version: 1, data });

  it('rejects templates with body > 4000 chars', () => {
    const huge = { name: 'X', body: 'x'.repeat(4001) };
    const r = window.BIAIFStorage.importBundle(makeState(), ok({ templates: [huge] }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('templates-invalid');
  });

  it('rejects too many templates (cap)', () => {
    const arr = Array.from({ length: 1001 }, (_, i) => ({ name: 't' + i, body: 'b' }));
    const r = window.BIAIFStorage.importBundle(makeState(), ok({ templates: arr }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('templates-shape');
  });
});

describe('importBundle — merge mode', () => {
  it('appends instead of replacing in merge mode', () => {
    const STATE = makeState();
    STATE.demandes = [{ text: 'existing', refs: [], url: null }];
    const bundle = { _biaif: 'export', _version: 1, data: {
      demandes: [{ text: 'imported', refs: [], url: null }],
    }};
    window.BIAIFStorage.importBundle(STATE, bundle, { mode: 'merge' });
    expect(STATE.demandes).toHaveLength(2);
    expect(STATE.demandes[0].text).toBe('existing');
    expect(STATE.demandes[1].text).toBe('imported');
  });
});
