import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/core/events/catalog.js');
});

describe('MyFb.core.events — catalog', () => {
  it('exposes a frozen TYPES enum with the expected event names', () => {
    const { TYPES } = window.MyFb.core.events;
    expect(TYPES.DEMANDE_CREATED).toBe('demande.created');
    expect(TYPES.REF_ADDED).toBe('ref.added');
    expect(TYPES.LINK_REQUESTED).toBe('link.requested');
    expect(Object.isFrozen(TYPES)).toBe(true);
  });

  it('uuid() returns RFC4122-ish v4 strings', () => {
    const { uuid } = window.MyFb.core.events;
    const id = uuid();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    // Two calls must produce different ids
    expect(uuid()).not.toBe(id);
  });

  it('makeEvent() builds a well-formed event wrapper', () => {
    const { makeEvent, TYPES } = window.MyFb.core.events;
    const e = makeEvent(TYPES.DEMANDE_CREATED, { id: 'dem-1', text: 'hi' }, {
      actorUuid: 'actor-a',
      lamportTs: 42,
    });
    expect(e.type).toBe('demande.created');
    expect(e.payload).toEqual({ id: 'dem-1', text: 'hi' });
    expect(e.actorUuid).toBe('actor-a');
    expect(e.lamportTs).toBe(42);
    expect(e.schemaVersion).toBe(1);
    expect(typeof e.id).toBe('string');
    expect(typeof e.ts).toBe('number');
  });

  it('makeEvent() rejects unknown event types', () => {
    const { makeEvent } = window.MyFb.core.events;
    expect(() => makeEvent('not.a.real.type', {}, { actorUuid: 'a', lamportTs: 1 }))
      .toThrow(/unknown event type/);
  });

  it('makeEvent() rejects missing actor or lamport', () => {
    const { makeEvent, TYPES } = window.MyFb.core.events;
    expect(() => makeEvent(TYPES.DEMANDE_CREATED, {}, { lamportTs: 1 })).toThrow(/actorUuid/);
    expect(() => makeEvent(TYPES.DEMANDE_CREATED, {}, { actorUuid: 'a' })).toThrow(/lamportTs/);
  });

  it('compare() orders by (lamportTs, id) ascending', () => {
    const { compare } = window.MyFb.core.events;
    const a = { lamportTs: 1, id: 'b' };
    const b = { lamportTs: 1, id: 'a' };
    const c = { lamportTs: 2, id: 'a' };
    expect(compare(a, b)).toBeGreaterThan(0); // a after b (id 'b' > 'a')
    expect(compare(a, c)).toBeLessThan(0);    // a before c (lamportTs 1 < 2)
    expect(compare(a, a)).toBe(0);
  });

  it('isValidEvent() catches missing/wrong fields', () => {
    const { isValidEvent, makeEvent, TYPES } = window.MyFb.core.events;
    const good = makeEvent(TYPES.DEMANDE_CREATED, {}, { actorUuid: 'a', lamportTs: 1 });
    expect(isValidEvent(good)).toBe(true);
    expect(isValidEvent(null)).toBe(false);
    expect(isValidEvent({})).toBe(false);
    expect(isValidEvent({ ...good, id: '' })).toBe(false);
    expect(isValidEvent({ ...good, lamportTs: 'nope' })).toBe(false);
    expect(isValidEvent({ ...good, payload: null })).toBe(false);
  });
});
