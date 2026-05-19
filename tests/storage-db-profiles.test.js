/**
 * Storage hydrate/persist roundtrip for STATE.dbProfiles (v2.4).
 *
 * We don't touch chrome.storage directly — instead we stub it with an
 * in-memory map for the duration of each test, then push a STATE
 * through persist() and read it back via hydrate(). This catches
 * regressions in `_buildPayload` and the hydrate field guard list.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/constants.js');
  loadAddonScript('shared/config.js');
  loadAddonScript('shared/utils.js');
  loadAddonScript('shared/ai-adapters.js');
  window.MyFbToast = { show: () => {} };
  window.MyFbUndo  = { push: () => {}, pop: () => null, clear: () => {}, canUndo: () => false, size: () => 0 };
  loadAddonScript('sidepanel/storage.js');
});

let _store = {};
beforeEach(() => {
  _store = {};
  globalThis.chrome = globalThis.chrome || {};
  globalThis.chrome.storage = {
    local: {
      get: (keys) => {
        const out = {};
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach((k) => { if (k in _store) out[k] = _store[k]; });
        return Promise.resolve(out);
      },
      set: (obj) => { Object.assign(_store, obj); return Promise.resolve(); },
      remove: (k) => { delete _store[k]; return Promise.resolve(); },
      getBytesInUse: () => Promise.resolve(0),
    },
    sync: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
  };
});

function freshState(overrides) {
  return Object.assign({
    demandes:        [],
    currentDemande:  { text: '', refs: [], pageUrl: null },
    templates:       [],
    dbProfiles:      [],
    lang:            'fr-FR',
    sortOrder:       'desc',
    segFontSize:     13,
    visibleButtons:  {},
    theme:           'dark',
    topbarPosition:  'top',
  }, overrides || {});
}

function sampleProfile(label) {
  return {
    id:              'db-' + label,
    label:           label,
    engine:          'mysql',
    mode:            'bridge',
    host:            'db.example.com',
    port:            3306,
    database:        'prod',
    prefix:          'wp_',
    schemaMd:        '# ' + label + '\n\nTABLE foo (...)',
    notes:           'read-only user only',
    autoInject:      true,
    bridgeUrl:       'https://example.com/myfb-bridge.php',
    bridgeSecretEnc: { iv: 'AAA=', ct: 'BBB=' },
    lastRefreshTs:   1716000000000,
    ts:              1716000000000,
    updatedTs:       1716000000000,
  };
}

describe('MyFbStorage persist/hydrate — dbProfiles roundtrip', () => {
  it('round-trips a single profile through persist + hydrate', async () => {
    const s1 = freshState({ dbProfiles: [sampleProfile('WPprod')] });
    window.MyFbStorage.persist(s1);
    await new Promise((r) => setTimeout(r, 5)); // let microtasks flush
    const s2 = freshState({ dbProfiles: [] });
    await window.MyFbStorage.hydrate(s2);
    expect(s2.dbProfiles).toHaveLength(1);
    expect(s2.dbProfiles[0].label).toBe('WPprod');
    expect(s2.dbProfiles[0].bridgeSecretEnc).toEqual({ iv: 'AAA=', ct: 'BBB=' });
    expect(s2.dbProfiles[0].schemaMd).toContain('TABLE foo');
    expect(s2.dbProfiles[0].autoInject).toBe(true);
  });

  it('round-trips multiple profiles preserving order', async () => {
    const s1 = freshState({
      dbProfiles: [sampleProfile('A'), sampleProfile('B'), sampleProfile('C')],
    });
    window.MyFbStorage.persist(s1);
    await new Promise((r) => setTimeout(r, 5));
    const s2 = freshState({ dbProfiles: [] });
    await window.MyFbStorage.hydrate(s2);
    expect(s2.dbProfiles.map((p) => p.label)).toEqual(['A', 'B', 'C']);
  });

  it('hydrate ignores a non-array dbProfiles value (defends against corrupt storage)', async () => {
    _store['myfb:v1:state'] = { _v: 1, dbProfiles: 'not-an-array', demandes: [] };
    const s2 = freshState({ dbProfiles: [{ id: 'preserved' }] });
    await window.MyFbStorage.hydrate(s2);
    // Should not overwrite STATE.dbProfiles with garbage; existing value preserved.
    expect(s2.dbProfiles).toEqual([{ id: 'preserved' }]);
  });

  it('hydrate accepts an empty array', async () => {
    _store['myfb:v1:state'] = { _v: 1, dbProfiles: [], demandes: [] };
    const s2 = freshState({ dbProfiles: [{ id: 'will-be-replaced' }] });
    await window.MyFbStorage.hydrate(s2);
    expect(s2.dbProfiles).toEqual([]);
  });

  it('does not lose encrypted secret across roundtrip (the critical guarantee)', async () => {
    const enc = { iv: 'longer-base64-iv', ct: 'long-base64-ciphertext' };
    const p   = sampleProfile('X');
    p.bridgeSecretEnc = enc;
    delete p.bridgeSecret;            // simulate post-migration state
    const s1 = freshState({ dbProfiles: [p] });
    window.MyFbStorage.persist(s1);
    await new Promise((r) => setTimeout(r, 5));
    const s2 = freshState({ dbProfiles: [] });
    await window.MyFbStorage.hydrate(s2);
    expect(s2.dbProfiles[0].bridgeSecretEnc).toEqual(enc);
    expect(s2.dbProfiles[0].bridgeSecret).toBeUndefined();
  });

  it('keeps legacy plaintext bridgeSecret intact (will be migrated by the UI module later)', async () => {
    const p = sampleProfile('Legacy');
    delete p.bridgeSecretEnc;
    p.bridgeSecret = 'cleartext-from-pre-2.4';
    const s1 = freshState({ dbProfiles: [p] });
    window.MyFbStorage.persist(s1);
    await new Promise((r) => setTimeout(r, 5));
    const s2 = freshState({ dbProfiles: [] });
    await window.MyFbStorage.hydrate(s2);
    expect(s2.dbProfiles[0].bridgeSecret).toBe('cleartext-from-pre-2.4');
  });
});
