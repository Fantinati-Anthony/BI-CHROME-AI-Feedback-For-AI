import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/core/events/catalog.js');
  loadAddonScript('shared/core/events/lamport.js');
  loadAddonScript('shared/core/events/store.js');
  loadAddonScript('shared/core/events/reducer.js');
  loadAddonScript('shared/core/transports/interface.js');
  loadAddonScript('shared/core/transports/solo.js');
  loadAddonScript('shared/core/device-meta.js');
  loadAddonScript('shared/core/profile.js');
  loadAddonScript('shared/core/bootstrap.js');
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

let dbCounter = 0;
function freshDbName() {
  dbCounter += 1;
  return 'mfb-bootstrap-test-' + dbCounter + '-' + Math.random().toString(36).slice(2, 8);
}

beforeEach(() => {
  // Each test gets fresh storage shims for chrome.storage.sync.
  window.MyFb.core.deviceMeta.__setStorageImpl(memStorage());
  window.MyFb.core.profile.__setStorageImpl(memStorage());
});

describe('MyFb.core.bootstrap.init', () => {
  it('returns a ctx with uuid, store, lamport, transport, state, emit', async () => {
    const ctx = await window.MyFb.core.bootstrap.init({ dbName: freshDbName() });
    expect(typeof ctx.uuid).toBe('string');
    expect(ctx.uuid.length).toBeGreaterThan(10);
    expect(ctx.store).toBeDefined();
    expect(ctx.lamport).toBeDefined();
    expect(ctx.transport).toBeDefined();
    expect(ctx.state).toBeDefined();
    expect(typeof ctx.emit).toBe('function');
    expect(ctx.profile).toBeNull(); // fresh install, no wizard yet
  });

  it('emits device.connected on first run, NOT on second run', async () => {
    const dbName = freshDbName();
    const ctx1 = await window.MyFb.core.bootstrap.init({ dbName });
    expect(ctx1.state.devices[ctx1.uuid]).toBeDefined();
    expect(ctx1.state.devices[ctx1.uuid].meta.browser).toBeDefined();
    const eventsAfter1 = await ctx1.store.readSince(-1);
    expect(eventsAfter1.length).toBe(1);
    expect(eventsAfter1[0].type).toBe('device.connected');

    // 2nd boot - same UUID (persisted), device already known, no new event
    const ctx2 = await window.MyFb.core.bootstrap.init({ dbName });
    expect(ctx2.uuid).toBe(ctx1.uuid);
    const eventsAfter2 = await ctx2.store.readSince(-1);
    expect(eventsAfter2.length).toBe(1); // still just the one
  });

  it('hydrates the lamport clock from the previous session', async () => {
    const dbName = freshDbName();
    const ctx1 = await window.MyFb.core.bootstrap.init({ dbName });
    await ctx1.emit('demande.created', { id: 'd1', text: 'one' });
    await ctx1.emit('demande.created', { id: 'd2', text: 'two' });
    const last = ctx1.lamport.now();
    expect(last).toBeGreaterThanOrEqual(3);

    const ctx2 = await window.MyFb.core.bootstrap.init({ dbName });
    expect(ctx2.lamport.now()).toBeGreaterThanOrEqual(last);
  });

  it('emit() persists, applies to state, and increments lamport', async () => {
    const ctx = await window.MyFb.core.bootstrap.init({ dbName: freshDbName() });
    const before = ctx.lamport.now();
    const e = await ctx.emit('demande.created', { id: 'dem-x', text: 'hello' });
    expect(e.type).toBe('demande.created');
    expect(e.actorUuid).toBe(ctx.uuid);
    expect(ctx.lamport.now()).toBe(before + 1);
    expect(ctx.state.demandes['dem-x']).toBeDefined();
    expect(ctx.state.demandes['dem-x'].text).toBe('hello');
    const stored = await ctx.store.readSince(-1);
    expect(stored.find((s) => s.id === e.id)).toBeDefined();
  });

  it('falls back to solo transport for unimplemented tiers', async () => {
    const ctx = await window.MyFb.core.bootstrap.init({ transport: 'cloud', dbName: freshDbName() });
    expect(ctx.transport.status().state).toBe('idle');
    // Solo transport returns [] on pull
    expect(await ctx.transport.pull(-1)).toEqual([]);
  });
});
