import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/core/events/catalog.js');
  loadAddonScript('shared/core/events/store.js');
});

async function freshStore() {
  // Use a unique DB name per test so fake-indexeddb keeps suites isolated.
  const dbName = 'mfb-test-' + Math.random().toString(36).slice(2, 10);
  const db    = await window.MyFb.core.store.openDb(dbName);
  return window.MyFb.core.store.create(db);
}

function mkEvent(lamportTs, id) {
  const { makeEvent, TYPES } = window.MyFb.core.events;
  return makeEvent(TYPES.DEMANDE_CREATED, { id: 'dem-' + id, text: 't' }, {
    actorUuid: 'actor-x',
    lamportTs,
    id: 'evt-' + id,
  });
}

describe('MyFb.core.store — append / read', () => {
  let store;
  beforeEach(async () => { store = await freshStore(); });

  it('append() inserts new events and returns counts', async () => {
    const out = await store.append([mkEvent(1, 'a'), mkEvent(2, 'b')]);
    expect(out.inserted).toBe(2);
    expect(out.skipped).toBe(0);
    expect(await store.count()).toBe(2);
  });

  it('append() is idempotent on duplicate ids', async () => {
    await store.append([mkEvent(1, 'a')]);
    const out = await store.append([mkEvent(1, 'a'), mkEvent(2, 'b')]);
    expect(out.inserted).toBe(1);
    expect(out.skipped).toBe(1);
    expect(await store.count()).toBe(2);
  });

  it('readSince(-1) returns everything in canonical order', async () => {
    // Insert deliberately out of order
    await store.append([mkEvent(3, 'c'), mkEvent(1, 'a'), mkEvent(2, 'b')]);
    const all = await store.readSince(-1);
    expect(all.map((e) => e.id)).toEqual(['evt-a', 'evt-b', 'evt-c']);
  });

  it('readSince(n) skips events with lamportTs <= n', async () => {
    await store.append([mkEvent(1, 'a'), mkEvent(2, 'b'), mkEvent(3, 'c')]);
    const tail = await store.readSince(1);
    expect(tail.map((e) => e.id)).toEqual(['evt-b', 'evt-c']);
  });

  it('readSince() breaks ties by id (deterministic)', async () => {
    await store.append([mkEvent(5, 'zz'), mkEvent(5, 'aa'), mkEvent(5, 'mm')]);
    const all = await store.readSince(-1);
    expect(all.map((e) => e.id)).toEqual(['evt-aa', 'evt-mm', 'evt-zz']);
  });

  it('clear() empties the store', async () => {
    await store.append([mkEvent(1, 'a'), mkEvent(2, 'b')]);
    await store.clear();
    expect(await store.count()).toBe(0);
  });
});

describe('MyFb.core.store — meta KV', () => {
  let store;
  beforeEach(async () => { store = await freshStore(); });

  it('metaGet() returns undefined for missing keys', async () => {
    expect(await store.metaGet('nope')).toBeUndefined();
  });

  it('metaSet() persists and metaGet() reads it back', async () => {
    await store.metaSet('lamportCounter', 42);
    expect(await store.metaGet('lamportCounter')).toBe(42);
  });

  it('metaSet() overwrites previous value', async () => {
    await store.metaSet('k', 'v1');
    await store.metaSet('k', 'v2');
    expect(await store.metaGet('k')).toBe('v2');
  });

  it('metaSet() supports objects', async () => {
    const obj = { a: 1, b: 'two', nested: { c: true } };
    await store.metaSet('config', obj);
    expect(await store.metaGet('config')).toEqual(obj);
  });
});
