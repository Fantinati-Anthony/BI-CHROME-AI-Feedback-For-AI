import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/core/device-meta.js');
});

function memStorage() {
  const mem = {};
  return {
    get:    (k) => Promise.resolve(mem[k] !== undefined ? { [k]: mem[k] } : {}),
    set:    (o) => { Object.assign(mem, o); return Promise.resolve(); },
    remove: (k) => { delete mem[k]; return Promise.resolve(); },
    _mem:   mem,
  };
}

describe('MyFb.core.deviceMeta — UUID persistence', () => {
  let storage;
  beforeEach(() => {
    storage = memStorage();
    window.MyFb.core.deviceMeta.__setStorageImpl(storage);
  });

  it('getOrCreateUuid() generates and persists a fresh UUID on first call', async () => {
    const uuid = await window.MyFb.core.deviceMeta.getOrCreateUuid();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(storage._mem['myfb:device:uuid']).toBe(uuid);
  });

  it('getOrCreateUuid() returns the same UUID on subsequent calls', async () => {
    const a = await window.MyFb.core.deviceMeta.getOrCreateUuid();
    const b = await window.MyFb.core.deviceMeta.getOrCreateUuid();
    expect(b).toBe(a);
  });

  it('getOrCreateUuid() recovers the persisted UUID after cache reset', async () => {
    const a = await window.MyFb.core.deviceMeta.getOrCreateUuid();
    window.MyFb.core.deviceMeta.__resetCache();
    const b = await window.MyFb.core.deviceMeta.getOrCreateUuid();
    expect(b).toBe(a);
  });

  it('regenerateUuid() replaces the stored UUID', async () => {
    const a = await window.MyFb.core.deviceMeta.getOrCreateUuid();
    const b = await window.MyFb.core.deviceMeta.regenerateUuid();
    expect(b).not.toBe(a);
    expect(storage._mem['myfb:device:uuid']).toBe(b);
    const c = await window.MyFb.core.deviceMeta.getOrCreateUuid();
    expect(c).toBe(b);
  });
});

describe('MyFb.core.deviceMeta — collectDeviceMeta', () => {
  it('returns a snapshot with the expected top-level fields', () => {
    const m = window.MyFb.core.deviceMeta.collectDeviceMeta({ now: () => 1700000000000 });
    expect(m.capturedAt).toBe(1700000000000);
    expect(m.browser).toHaveProperty('name');
    expect(m.browser).toHaveProperty('version');
    expect(m.os).toHaveProperty('name');
    expect(m.viewport).toHaveProperty('w');
    expect(m.viewport).toHaveProperty('h');
    expect(typeof m.dpr).toBe('number');
    expect(['desktop', 'tablet', 'mobile']).toContain(m.deviceClass);
    expect(m.preferences).toHaveProperty('colorScheme');
    expect(m.preferences).toHaveProperty('reducedMotion');
    expect(m.network).toHaveProperty('online');
    expect(m.locale).toHaveProperty('language');
    expect(typeof m.ua).toBe('string');
  });

  it('strips undefined optional fields to keep payload compact', () => {
    const m = window.MyFb.core.deviceMeta.collectDeviceMeta();
    // In jsdom, performance.memory and screen.orientation are usually undefined
    if (m.performance === undefined) expect('performance' in m).toBe(false);
  });

  it('survives missing/throwing browser APIs without crashing', () => {
    const orig = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { value: '', configurable: true });
    const m = window.MyFb.core.deviceMeta.collectDeviceMeta();
    expect(m.browser.name).toBe('Unknown');
    expect(m.os.name).toBe('Unknown');
    Object.defineProperty(navigator, 'userAgent', { value: orig, configurable: true });
  });
});

describe('MyFb.core.deviceMeta — anonymize', () => {
  it('strips identifying fields (timezone, languages, hardware.memory, ua, screen)', () => {
    const m = {
      capturedAt: 1, browser: { name: 'C', version: '1' }, os: { name: 'L', version: '' },
      viewport: { w: 1, h: 1 }, dpr: 1, deviceClass: 'desktop',
      screen: { w: 100, h: 100, colorDepth: 24 },
      hardware: { memory: 16, cores: 8, maxTouchPoints: 0 },
      preferences: { colorScheme: 'dark', reducedMotion: false, zoom: 1 },
      network: { online: true, type: '4g', downlink: 10, saveData: false },
      locale: { language: 'fr', languages: ['fr', 'en'], timezone: 'Europe/Paris', timezoneOffset: -60 },
      performance: { usedJSHeap: 1000 },
      ua: 'Mozilla/5.0…',
    };
    const a = window.MyFb.core.deviceMeta.anonymize(m);
    expect(a.locale.timezone).toBeUndefined();
    expect(a.locale.languages).toBeUndefined();
    expect(a.network.type).toBeUndefined();
    expect(a.hardware.memory).toBeUndefined();
    expect(a.ua).toBeUndefined();
    expect(a.screen).toBeUndefined();
    expect(a.performance).toBeUndefined();
    // Browser/OS/viewport are kept — they're necessary for any debugging value
    expect(a.browser.name).toBe('C');
    expect(a.viewport.w).toBe(1);
  });

  it('does not mutate the original meta object', () => {
    const m = { locale: { timezone: 'Europe/Paris', language: 'fr' }, ua: 'X' };
    window.MyFb.core.deviceMeta.anonymize(m);
    expect(m.locale.timezone).toBe('Europe/Paris');
    expect(m.ua).toBe('X');
  });

  it('handles null/empty gracefully', () => {
    expect(window.MyFb.core.deviceMeta.anonymize(null)).toBeNull();
    expect(window.MyFb.core.deviceMeta.anonymize(undefined)).toBeUndefined();
  });
});
