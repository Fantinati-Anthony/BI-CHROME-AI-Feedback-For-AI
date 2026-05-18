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
  loadAddonScript('shared/core/sync-engine.js');
});

function memStorage() {
  const mem = {};
  return {
    get: (k) => Promise.resolve(mem[k] !== undefined ? { [k]: mem[k] } : {}),
    set: (o) => { Object.assign(mem, o); return Promise.resolve(); },
    remove: (k) => { delete mem[k]; return Promise.resolve(); },
  };
}

// Mock transport for testing
function mockTransport(opts) {
  opts = opts || {};
  let _events = opts.initialEvents || [];
  let _subscriber = null;
  let _pushed = [];
  return {
    init:   () => Promise.resolve(),
    push:   (es) => {
      _pushed = _pushed.concat(es);
      return Promise.resolve();
    },
    pull:   (since) => {
      const out = _events.filter((e) => e.lamportTs > since);
      return Promise.resolve(out);
    },
    subscribe: (cb) => {
      _subscriber = cb;
      return () => { _subscriber = null; };
    },
    status:    () => ({ state: 'idle' }),
    dispose:   () => Promise.resolve(),
    // test helpers
    _pushReceived: () => _pushed.slice(),
    _injectRemote: (ev) => { _events.push(ev); if (_subscriber) _subscriber(ev); },
    _events:       () => _events.slice(),
  };
}

let dbCounter = 0;
function freshDbName() {
  dbCounter += 1;
  return 'mfb-syncengine-' + dbCounter + '-' + Math.random().toString(36).slice(2, 6);
}

async function freshCtx() {
  window.MyFb.core.deviceMeta.__setStorageImpl(memStorage());
  window.MyFb.core.profile.__setStorageImpl(memStorage());
  return await window.MyFb.core.bootstrap.init({ dbName: freshDbName() });
}

function mkEvent(lamportTs, id, actorUuid) {
  const { makeEvent, TYPES } = window.MyFb.core.events;
  return makeEvent(TYPES.DEMANDE_CREATED, { id: 'dem-' + id, text: 't' }, {
    actorUuid: actorUuid || 'remote-actor',
    lamportTs,
    id: 'evt-' + id,
  });
}

describe('syncEngine.create — basic shape', () => {
  it('returns ingest, syncNow, pushOne, start, stop, status', async () => {
    const ctx = await freshCtx();
    const t = mockTransport();
    const e = window.MyFb.core.syncEngine.create({
      store: ctx.store, transport: t, lamport: ctx.lamport,
      reducer: window.MyFb.core.reducer, eventsApi: window.MyFb.core.events,
      getState: () => ctx.state, setState: (s) => { ctx.state = s; },
    });
    expect(typeof e.ingest).toBe('function');
    expect(typeof e.syncNow).toBe('function');
    expect(typeof e.pushOne).toBe('function');
    expect(typeof e.start).toBe('function');
    expect(typeof e.stop).toBe('function');
    expect(typeof e.status).toBe('function');
    expect(e.status().state).toBe('idle');
  });
});

describe('syncEngine.ingest', () => {
  it('appends valid events and applies them to state', async () => {
    const ctx = await freshCtx();
    const t = mockTransport();
    const e = window.MyFb.core.syncEngine.create({
      store: ctx.store, transport: t, lamport: ctx.lamport,
      reducer: window.MyFb.core.reducer, eventsApi: window.MyFb.core.events,
      getState: () => ctx.state, setState: (s) => { ctx.state = s; },
    });
    await e.ingest(mkEvent(5, 'a'));
    expect(ctx.state.demandes['dem-a']).toBeDefined();
    expect(ctx.lamport.now()).toBeGreaterThanOrEqual(6);
  });

  it('deduplicates by event id (in-memory seen + store ConstraintError)', async () => {
    const ctx = await freshCtx();
    const t = mockTransport();
    const e = window.MyFb.core.syncEngine.create({
      store: ctx.store, transport: t, lamport: ctx.lamport,
      reducer: window.MyFb.core.reducer, eventsApi: window.MyFb.core.events,
      getState: () => ctx.state, setState: (s) => { ctx.state = s; },
    });
    const ev = mkEvent(5, 'dup');
    await e.ingest(ev);
    await e.ingest(ev);  // second time should be a no-op
    const count = await ctx.store.count();
    // 1 boot device.connected + 1 ingested
    expect(count).toBe(2);
  });

  it('ignores invalid events', async () => {
    const ctx = await freshCtx();
    const t = mockTransport();
    const e = window.MyFb.core.syncEngine.create({
      store: ctx.store, transport: t, lamport: ctx.lamport,
      reducer: window.MyFb.core.reducer, eventsApi: window.MyFb.core.events,
      getState: () => ctx.state, setState: (s) => { ctx.state = s; },
    });
    await e.ingest(null);
    await e.ingest({});
    await e.ingest({ id: 'x', type: 'demande.created' /* missing required fields */ });
    expect(Object.keys(ctx.state.demandes).length).toBe(0);
  });
});

describe('syncEngine.syncNow', () => {
  it('pulls all events from transport with lamportTs > peerCursor', async () => {
    const ctx = await freshCtx();
    const t = mockTransport({
      initialEvents: [mkEvent(1, 'a'), mkEvent(2, 'b'), mkEvent(3, 'c')],
    });
    const e = window.MyFb.core.syncEngine.create({
      store: ctx.store, transport: t, lamport: ctx.lamport,
      reducer: window.MyFb.core.reducer, eventsApi: window.MyFb.core.events,
      getState: () => ctx.state, setState: (s) => { ctx.state = s; },
    });
    const n = await e.syncNow();
    expect(n).toBe(3);
    expect(ctx.state.demandes['dem-a']).toBeDefined();
    expect(ctx.state.demandes['dem-b']).toBeDefined();
    expect(ctx.state.demandes['dem-c']).toBeDefined();
  });

  it('updates status to syncing during the pull and back to idle after', async () => {
    const ctx = await freshCtx();
    const t = mockTransport();
    const e = window.MyFb.core.syncEngine.create({
      store: ctx.store, transport: t, lamport: ctx.lamport,
      reducer: window.MyFb.core.reducer, eventsApi: window.MyFb.core.events,
      getState: () => ctx.state, setState: (s) => { ctx.state = s; },
    });
    const p = e.syncNow();
    // status is set synchronously when syncNow starts
    expect(e.status().state).toBe('syncing');
    await p;
    expect(e.status().state).toBe('idle');
  });

  it('records lastPullAt timestamp on success', async () => {
    const ctx = await freshCtx();
    const t = mockTransport();
    const e = window.MyFb.core.syncEngine.create({
      store: ctx.store, transport: t, lamport: ctx.lamport,
      reducer: window.MyFb.core.reducer, eventsApi: window.MyFb.core.events,
      getState: () => ctx.state, setState: (s) => { ctx.state = s; },
    });
    expect(e.status().lastPullAt).toBeNull();
    await e.syncNow();
    expect(typeof e.status().lastPullAt).toBe('number');
  });

  it('surfaces transport errors in status', async () => {
    const ctx = await freshCtx();
    const t = mockTransport();
    t.pull = () => Promise.reject(new Error('boom'));
    const e = window.MyFb.core.syncEngine.create({
      store: ctx.store, transport: t, lamport: ctx.lamport,
      reducer: window.MyFb.core.reducer, eventsApi: window.MyFb.core.events,
      getState: () => ctx.state, setState: (s) => { ctx.state = s; },
    });
    await expect(e.syncNow()).rejects.toThrow(/boom/);
    expect(e.status().state).toBe('error');
    expect(e.status().lastError).toContain('boom');
  });
});

describe('syncEngine.pushOne', () => {
  it('forwards the event to the transport push()', async () => {
    const ctx = await freshCtx();
    const t = mockTransport();
    const e = window.MyFb.core.syncEngine.create({
      store: ctx.store, transport: t, lamport: ctx.lamport,
      reducer: window.MyFb.core.reducer, eventsApi: window.MyFb.core.events,
      getState: () => ctx.state, setState: (s) => { ctx.state = s; },
    });
    const ev = mkEvent(5, 'pushed');
    await e.pushOne(ev);
    expect(t._pushReceived().map((x) => x.id)).toEqual(['evt-pushed']);
  });

  it('tracks pendingPush counter', async () => {
    const ctx = await freshCtx();
    let resolvePush;
    const t = mockTransport();
    t.push = () => new Promise((r) => { resolvePush = r; });
    const e = window.MyFb.core.syncEngine.create({
      store: ctx.store, transport: t, lamport: ctx.lamport,
      reducer: window.MyFb.core.reducer, eventsApi: window.MyFb.core.events,
      getState: () => ctx.state, setState: (s) => { ctx.state = s; },
    });
    const p = e.pushOne(mkEvent(1, 'a'));
    expect(e.status().pendingPush).toBe(1);
    resolvePush();
    await p;
    expect(e.status().pendingPush).toBe(0);
  });

  it('swallows push errors and reports in status', async () => {
    const ctx = await freshCtx();
    const t = mockTransport();
    t.push = () => Promise.reject(new Error('net down'));
    const e = window.MyFb.core.syncEngine.create({
      store: ctx.store, transport: t, lamport: ctx.lamport,
      reducer: window.MyFb.core.reducer, eventsApi: window.MyFb.core.events,
      getState: () => ctx.state, setState: (s) => { ctx.state = s; },
    });
    await e.pushOne(mkEvent(1, 'a')); // does not throw
    expect(e.status().state).toBe('error');
    expect(e.status().lastError).toContain('net down');
  });
});

describe('syncEngine.start / stop', () => {
  it('start subscribes to transport and runs a warm-up pull', async () => {
    const ctx = await freshCtx();
    const t = mockTransport({ initialEvents: [mkEvent(1, 'warm')] });
    const e = window.MyFb.core.syncEngine.create({
      store: ctx.store, transport: t, lamport: ctx.lamport,
      reducer: window.MyFb.core.reducer, eventsApi: window.MyFb.core.events,
      getState: () => ctx.state, setState: (s) => { ctx.state = s; },
    }, { autoPullMs: 0 });  // disable auto-pull
    await e.start();
    expect(ctx.state.demandes['dem-warm']).toBeDefined();
    await e.stop();
  });

  it('start is idempotent (second call is a no-op)', async () => {
    const ctx = await freshCtx();
    const t = mockTransport();
    const e = window.MyFb.core.syncEngine.create({
      store: ctx.store, transport: t, lamport: ctx.lamport,
      reducer: window.MyFb.core.reducer, eventsApi: window.MyFb.core.events,
      getState: () => ctx.state, setState: (s) => { ctx.state = s; },
    }, { autoPullMs: 0 });
    await e.start();
    await e.start(); // shouldn't error
    await e.stop();
  });

  it('subscribed events are ingested live', async () => {
    const ctx = await freshCtx();
    const t = mockTransport();
    const e = window.MyFb.core.syncEngine.create({
      store: ctx.store, transport: t, lamport: ctx.lamport,
      reducer: window.MyFb.core.reducer, eventsApi: window.MyFb.core.events,
      getState: () => ctx.state, setState: (s) => { ctx.state = s; },
    }, { autoPullMs: 0 });
    await e.start();
    const ev = mkEvent(7, 'live');
    t._injectRemote(ev);
    await new Promise((r) => setTimeout(r, 10)); // give the ingest a tick
    expect(ctx.state.demandes['dem-live']).toBeDefined();
    await e.stop();
  });
});

describe('syncEngine.attach', () => {
  it('wraps ctx.emit so emitted events get pushed', async () => {
    const ctx = await freshCtx();
    const t = mockTransport();
    ctx.transport = t;
    const e = window.MyFb.core.syncEngine.attach(ctx, { autoPullMs: 0 });
    await ctx.emit('demande.created', { id: 'auto-pushed', text: 'x' });
    // The push might be async — wait a tick
    await new Promise((r) => setTimeout(r, 10));
    const pushed = t._pushReceived();
    expect(pushed.length).toBeGreaterThanOrEqual(1);
    expect(pushed[pushed.length - 1].payload.id).toBe('auto-pushed');
    expect(ctx.engine).toBe(e);
  });

  it('throws if ctx is missing required fields', () => {
    expect(() => window.MyFb.core.syncEngine.attach(null)).toThrow(/requires/);
    expect(() => window.MyFb.core.syncEngine.attach({})).toThrow(/requires/);
  });
});
