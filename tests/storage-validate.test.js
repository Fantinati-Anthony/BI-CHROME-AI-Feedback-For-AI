/**
 * Tests for MyFbStorage.importBundle's schema validation guards.
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
    expect(window.MyFbStorage.importBundle(makeState(), null).ok).toBe(false);
    expect(window.MyFbStorage.importBundle(makeState(), undefined).ok).toBe(false);
    expect(window.MyFbStorage.importBundle(makeState(), 'string').ok).toBe(false);
    expect(window.MyFbStorage.importBundle(makeState(), 42).ok).toBe(false);
  });

  it('rejects bundles without the magic header', () => {
    const r = window.MyFbStorage.importBundle(makeState(), { _version: 1, data: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('wrong-magic');
  });

  it('rejects bundles with a wrong magic value', () => {
    const r = window.MyFbStorage.importBundle(makeState(), { _myfb: 'not-an-export', _version: 1, data: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('wrong-magic');
  });

  it('rejects bundles with a non-numeric _version', () => {
    const r = window.MyFbStorage.importBundle(makeState(), { _myfb: 'export', _version: 'v1', data: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('bad-version');
  });

  it('rejects bundles with a missing data object', () => {
    const r = window.MyFbStorage.importBundle(makeState(), { _myfb: 'export', _version: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no-data');
  });
});

describe('importBundle — demande validation', () => {
  const ok = (data) => ({ _myfb: 'export', _version: 1, data });

  it('rejects demandes that aren\'t arrays', () => {
    const r = window.MyFbStorage.importBundle(makeState(), ok({ demandes: 'oops' }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('demandes-shape');
  });

  it('rejects demandes with a text > MAX_TEXT', () => {
    const oversized = { text: 'x'.repeat(50001), refs: [] };
    const r = window.MyFbStorage.importBundle(makeState(), ok({ demandes: [oversized] }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('demandes-invalid');
  });

  it('rejects refs with an unsafe URL', () => {
    const bad = { text: 'x', refs: [{ type: 'el', tabUrl: 'javascript:alert(1)' }] };
    const r = window.MyFbStorage.importBundle(makeState(), ok({ demandes: [bad] }));
    expect(r.ok).toBe(false);
  });

  it('rejects refs with a malformed dataUrl', () => {
    const bad = { text: 'x', refs: [{ type: 'screenshot', dataUrl: 'data:text/html,<script>' }] };
    const r = window.MyFbStorage.importBundle(makeState(), ok({ demandes: [bad] }));
    expect(r.ok).toBe(false);
  });

  it('accepts a clean bundle with demandes + templates', () => {
    const STATE = makeState();
    const bundle = ok({
      demandes: [{ text: 'hello', refs: [{ type: 'el', selector: '.btn' }], url: 'https://x.com/' }],
      templates: [{ name: 'T', body: 'B', id: 't1', ts: 0 }],
      sortOrder: 'asc',
    });
    const r = window.MyFbStorage.importBundle(STATE, bundle);
    expect(r.ok).toBe(true);
    expect(r.imported).toBe(1);
    expect(STATE.demandes).toHaveLength(1);
    expect(STATE.templates).toHaveLength(1);
    expect(STATE.sortOrder).toBe('asc');
  });

  it('accepts demandes with tags array', () => {
    const STATE = makeState();
    const bundle = ok({
      demandes: [{ text: 'x', refs: [], url: null, tags: ['feat', 'bug', 'urgent'] }],
    });
    const r = window.MyFbStorage.importBundle(STATE, bundle);
    expect(r.ok).toBe(true);
    expect(STATE.demandes[0].tags).toEqual(['feat', 'bug', 'urgent']);
  });

  it('rejects oversized tags array (> 10) or oversize tag string', () => {
    const STATE = makeState();
    const tooMany = ok({ demandes: [{ text: 'x', refs: [], url: null,
      tags: ['a','b','c','d','e','f','g','h','i','j','k'] }] });
    expect(window.MyFbStorage.importBundle(STATE, tooMany).ok).toBe(false);
    const tooLong = ok({ demandes: [{ text: 'x', refs: [], url: null,
      tags: ['x'.repeat(33)] }] });
    expect(window.MyFbStorage.importBundle(STATE, tooLong).ok).toBe(false);
  });

  it('drops unknown settings keys (whitelist)', () => {
    const STATE = makeState();
    const bundle = ok({ demandes: [], unknownEvil: 'pwned' });
    window.MyFbStorage.importBundle(STATE, bundle);
    expect(STATE.unknownEvil).toBeUndefined();
  });
});

describe('importBundle — templates validation', () => {
  const ok = (data) => ({ _myfb: 'export', _version: 1, data });

  it('rejects templates with body > 4000 chars', () => {
    const huge = { name: 'X', body: 'x'.repeat(4001) };
    const r = window.MyFbStorage.importBundle(makeState(), ok({ templates: [huge] }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('templates-invalid');
  });

  it('rejects too many templates (cap)', () => {
    const arr = Array.from({ length: 1001 }, (_, i) => ({ name: 't' + i, body: 'b' }));
    const r = window.MyFbStorage.importBundle(makeState(), ok({ templates: arr }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('templates-shape');
  });
});

describe('importBundle — merge mode', () => {
  it('appends instead of replacing in merge mode', () => {
    const STATE = makeState();
    STATE.demandes = [{ text: 'existing', refs: [], url: null }];
    const bundle = { _myfb: 'export', _version: 1, data: {
      demandes: [{ text: 'imported', refs: [], url: null }],
    }};
    window.MyFbStorage.importBundle(STATE, bundle, { mode: 'merge' });
    expect(STATE.demandes).toHaveLength(2);
    expect(STATE.demandes[0].text).toBe('existing');
    expect(STATE.demandes[1].text).toBe('imported');
  });
});

describe('importBundle — dbProfiles (v2.4)', () => {
  const valid = { id: 'db-1', label: 'WP prod', mode: 'paste', schemaMd: '#schema', ts: 1 };

  it('imports valid dbProfiles into STATE', () => {
    const STATE = makeState();
    const bundle = { _myfb: 'export', _version: 1, data: { dbProfiles: [valid] } };
    const r = window.MyFbStorage.importBundle(STATE, bundle);
    expect(r.ok).toBe(true);
    expect(STATE.dbProfiles).toEqual([valid]);
  });

  it('replaces an existing dbProfiles array (default mode)', () => {
    const STATE = makeState();
    STATE.dbProfiles = [{ id: 'db-old', label: 'Old', ts: 0 }];
    const bundle = { _myfb: 'export', _version: 1, data: { dbProfiles: [valid] } };
    window.MyFbStorage.importBundle(STATE, bundle);
    expect(STATE.dbProfiles).toEqual([valid]);
  });

  it('rejects when dbProfiles is not an array', () => {
    const r = window.MyFbStorage.importBundle(makeState(),
      { _myfb: 'export', _version: 1, data: { dbProfiles: 'not-an-array' } });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('db-profiles-shape');
  });

  it('rejects when a profile lacks id or label', () => {
    const r = window.MyFbStorage.importBundle(makeState(),
      { _myfb: 'export', _version: 1, data: { dbProfiles: [{ label: 'no-id' }] } });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('db-profiles-invalid');
  });

  it('rejects when the array exceeds MAX_DB_PROFILES (50)', () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ id: 'db-' + i, label: 'L' + i, ts: 1 }));
    const r = window.MyFbStorage.importBundle(makeState(),
      { _myfb: 'export', _version: 1, data: { dbProfiles: many } });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('db-profiles-shape');
  });

  it('accepts the bundle when dbProfiles is missing (backwards-compat with pre-2.4 exports)', () => {
    const STATE = makeState();
    STATE.dbProfiles = [{ id: 'kept', label: 'kept', ts: 1 }];
    const bundle = { _myfb: 'export', _version: 1, data: { demandes: [] } };
    const r = window.MyFbStorage.importBundle(STATE, bundle);
    expect(r.ok).toBe(true);
    // No dbProfiles in the bundle → existing STATE.dbProfiles preserved
    expect(STATE.dbProfiles).toEqual([{ id: 'kept', label: 'kept', ts: 1 }]);
  });

  it('preserves encrypted secret envelope through import', () => {
    const enc = { iv: 'AAA', ct: 'BBB' };
    const p   = Object.assign({}, valid, { bridgeSecretEnc: enc });
    const STATE = makeState();
    window.MyFbStorage.importBundle(STATE,
      { _myfb: 'export', _version: 1, data: { dbProfiles: [p] } });
    expect(STATE.dbProfiles[0].bridgeSecretEnc).toEqual(enc);
  });
});
