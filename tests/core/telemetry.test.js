import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/core/telemetry.js');
});

function mkStorage() {
  const mem = {};
  return {
    get: (k) => Promise.resolve(mem[k] !== undefined ? { [k]: mem[k] } : {}),
    set: (o) => { Object.assign(mem, o); return Promise.resolve(); },
    _mem: mem,
  };
}

beforeEach(() => {
  window.MyFb.core.telemetry.__setStorageImpl(mkStorage());
});

describe('telemetry.EVENTS catalog', () => {
  it('exposes a frozen whitelist of known event names', () => {
    const E = window.MyFb.core.telemetry.EVENTS;
    expect(E.AI_SUMMARIZE).toBe('ai.summarize');
    expect(E.DEMANDE_CREATED).toBe('demande.created');
    expect(Object.isFrozen(E)).toBe(true);
  });
});

describe('telemetry — opt-in default OFF', () => {
  it('isEnabled() returns false on fresh install', async () => {
    expect(await window.MyFb.core.telemetry.isEnabled()).toBe(false);
  });

  it('track() is a no-op when disabled (returns null)', async () => {
    const E = window.MyFb.core.telemetry.EVENTS;
    expect(await window.MyFb.core.telemetry.track(E.AI_SUMMARIZE)).toBeNull();
    expect(await window.MyFb.core.telemetry.getCounters()).toEqual({});
  });
});

describe('telemetry — when enabled', () => {
  beforeEach(async () => {
    await window.MyFb.core.telemetry.setEnabled(true);
  });

  it('track() increments the counter', async () => {
    const E = window.MyFb.core.telemetry.EVENTS;
    expect(await window.MyFb.core.telemetry.track(E.AI_SUMMARIZE)).toBe(1);
    expect(await window.MyFb.core.telemetry.track(E.AI_SUMMARIZE)).toBe(2);
    expect(await window.MyFb.core.telemetry.track(E.AI_SUMMARIZE)).toBe(3);
  });

  it('track() persists counters per event name', async () => {
    const E = window.MyFb.core.telemetry.EVENTS;
    await window.MyFb.core.telemetry.track(E.AI_SUMMARIZE);
    await window.MyFb.core.telemetry.track(E.AI_SUMMARIZE);
    await window.MyFb.core.telemetry.track(E.DEMANDE_CREATED);
    const c = await window.MyFb.core.telemetry.getCounters();
    expect(c[E.AI_SUMMARIZE]).toBe(2);
    expect(c[E.DEMANDE_CREATED]).toBe(1);
  });

  it('setEnabled(false) stops further tracking but keeps counters', async () => {
    const E = window.MyFb.core.telemetry.EVENTS;
    await window.MyFb.core.telemetry.track(E.AI_SUMMARIZE);
    await window.MyFb.core.telemetry.setEnabled(false);
    await window.MyFb.core.telemetry.track(E.AI_SUMMARIZE);
    const c = await window.MyFb.core.telemetry.getCounters();
    expect(c[E.AI_SUMMARIZE]).toBe(1); // not incremented after disable
  });

  it('resetCounters() clears all counters but preserves enabled state', async () => {
    const E = window.MyFb.core.telemetry.EVENTS;
    await window.MyFb.core.telemetry.track(E.AI_SUMMARIZE);
    await window.MyFb.core.telemetry.resetCounters();
    expect(await window.MyFb.core.telemetry.getCounters()).toEqual({});
    expect(await window.MyFb.core.telemetry.isEnabled()).toBe(true);
  });
});

describe('telemetry — input validation', () => {
  it('rejects unknown event names', async () => {
    await window.MyFb.core.telemetry.setEnabled(true);
    await expect(window.MyFb.core.telemetry.track('not.a.real.event')).rejects.toThrow(/unknown event/);
  });
});
