import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
  loadAddonScript('sidepanel/data-controls.js');
});

function mkStorage() {
  const mem = {};
  return {
    get: (k, cb) => {
      if (k === null || k === undefined) return cb({ ...mem });
      const out = {};
      if (typeof k === 'string') { if (k in mem) out[k] = mem[k]; }
      else if (Array.isArray(k)) { k.forEach((key) => { if (key in mem) out[key] = mem[key]; }); }
      cb(out);
    },
    set:    (o, cb) => { Object.assign(mem, o); if (cb) cb(); },
    clear:  (cb) => { Object.keys(mem).forEach((k) => delete mem[k]); if (cb) cb(); },
    _mem:   mem,
  };
}

beforeEach(() => {
  globalThis.chrome.storage.local = mkStorage();
  globalThis.chrome.storage.sync  = mkStorage();
});

describe('MyFbDataControls — _collectBundle', () => {
  it('returns an object with the expected envelope', async () => {
    chrome.storage.local._mem['some-local'] = 'a';
    chrome.storage.sync._mem['some-sync']   = 'b';
    const b = await window.MyFbDataControls._collectBundle();
    expect(b._myfb).toBe('bundle');
    expect(b._schemaVersion).toBe(1);
    expect(typeof b._exportedAt).toBe('string');
    expect(typeof b._appVersion).toBe('string');
    expect(b.chromeStorageLocal['some-local']).toBe('a');
    expect(b.chromeStorageSync['some-sync']).toBe('b');
    expect(Array.isArray(b.events)).toBe(true);
  });

  it('returns empty events array when runtime is missing', async () => {
    const b = await window.MyFbDataControls._collectBundle();
    expect(b.events).toEqual([]);
  });
});

describe('MyFbDataControls — _wipeEverything', () => {
  it('clears both storage areas', async () => {
    chrome.storage.local._mem['x'] = 1;
    chrome.storage.sync._mem['y']  = 2;
    await window.MyFbDataControls._wipeEverything();
    expect(Object.keys(chrome.storage.local._mem).length).toBe(0);
    expect(Object.keys(chrome.storage.sync._mem).length).toBe(0);
  });

  it('does not throw when storage APIs are missing', async () => {
    const orig = chrome.storage;
    chrome.storage = undefined;
    await expect(window.MyFbDataControls._wipeEverything()).resolves.toBeDefined();
    chrome.storage = orig;
  });
});

describe('MyFbDataControls — exportBundle', () => {
  it('builds a bundle whose chromeStorageLocal includes the live state', async () => {
    chrome.storage.local._mem['foo'] = 'bar';
    const bundle = await window.MyFbDataControls._collectBundle();
    expect(bundle.chromeStorageLocal['foo']).toBe('bar');
  });
});
