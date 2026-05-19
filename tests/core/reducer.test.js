import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/core/events/catalog.js');
  loadAddonScript('shared/core/events/reducer.js');
});

function E(type, payload, ctx) {
  return window.MyFb.core.events.makeEvent(type, payload, ctx || { actorUuid: 'actor-x', lamportTs: 1 });
}
const T = () => window.MyFb.core.events.TYPES;

describe('MyFb.core.reducer — emptyState', () => {
  it('returns the canonical empty shape', () => {
    const s = window.MyFb.core.reducer.emptyState();
    expect(s).toEqual({ workspaces: {}, demandes: {}, devices: {}, links: {} });
  });
});

describe('MyFb.core.reducer — demande lifecycle', () => {
  it('DEMANDE_CREATED inserts a demande with defaults', () => {
    const e = E(T().DEMANDE_CREATED, { id: 'd1', text: 'hello', url: 'https://x.com' });
    const s = window.MyFb.core.reducer.replay([e]);
    expect(s.demandes.d1).toBeDefined();
    expect(s.demandes.d1.text).toBe('hello');
    expect(s.demandes.d1.url).toBe('https://x.com');
    expect(s.demandes.d1.status).toBe('new');
    expect(s.demandes.d1.priority).toBe('medium');
    expect(s.demandes.d1.deleted).toBe(false);
    expect(s.demandes.d1.tags).toEqual([]);
  });

  it('DEMANDE_TEXT_UPDATED updates text and updatedAt', () => {
    const events = [
      E(T().DEMANDE_CREATED, { id: 'd1', text: 'old' }, { actorUuid: 'a', lamportTs: 1, ts: 1000 }),
      E(T().DEMANDE_TEXT_UPDATED, { id: 'd1', text: 'new' }, { actorUuid: 'a', lamportTs: 2, ts: 2000 }),
    ];
    const s = window.MyFb.core.reducer.replay(events);
    expect(s.demandes.d1.text).toBe('new');
    expect(s.demandes.d1.updatedAt).toBe(2000);
  });

  it('DEMANDE_DELETED marks soft-deleted, preserves data', () => {
    const events = [
      E(T().DEMANDE_CREATED, { id: 'd1', text: 'x' }),
      E(T().DEMANDE_DELETED, { id: 'd1' }, { actorUuid: 'a', lamportTs: 2 }),
    ];
    const s = window.MyFb.core.reducer.replay(events);
    expect(s.demandes.d1.deleted).toBe(true);
    expect(s.demandes.d1.text).toBe('x'); // preserved for undo
  });

  it('DEMANDE_STATUS_CHANGED transitions through workflow', () => {
    const events = [
      E(T().DEMANDE_CREATED, { id: 'd1', text: '' }),
      E(T().DEMANDE_STATUS_CHANGED, { id: 'd1', status: 'accepted' }, { actorUuid: 'a', lamportTs: 2 }),
      E(T().DEMANDE_STATUS_CHANGED, { id: 'd1', status: 'shipped'  }, { actorUuid: 'a', lamportTs: 3 }),
    ];
    const s = window.MyFb.core.reducer.replay(events);
    expect(s.demandes.d1.status).toBe('shipped');
  });
});

describe('MyFb.core.reducer — tags and comments', () => {
  it('DEMANDE_TAGGED / UNTAGGED add and remove unique tags', () => {
    const events = [
      E(T().DEMANDE_CREATED, { id: 'd1', text: '' }),
      E(T().DEMANDE_TAGGED, { id: 'd1', tag: 'bug' }, { actorUuid: 'a', lamportTs: 2 }),
      E(T().DEMANDE_TAGGED, { id: 'd1', tag: 'urgent' }, { actorUuid: 'a', lamportTs: 3 }),
      E(T().DEMANDE_TAGGED, { id: 'd1', tag: 'bug' }, { actorUuid: 'a', lamportTs: 4 }), // dup
      E(T().DEMANDE_UNTAGGED, { id: 'd1', tag: 'urgent' }, { actorUuid: 'a', lamportTs: 5 }),
    ];
    const s = window.MyFb.core.reducer.replay(events);
    expect(s.demandes.d1.tags).toEqual(['bug']);
  });

  it('DEMANDE_COMMENTED adds a comment under commentId, by actor', () => {
    const events = [
      E(T().DEMANDE_CREATED, { id: 'd1', text: '' }),
      E(T().DEMANDE_COMMENTED, { demandeId: 'd1', commentId: 'c1', text: 'first' },
        { actorUuid: 'admin', lamportTs: 2, ts: 100 }),
      E(T().DEMANDE_COMMENTED, { demandeId: 'd1', commentId: 'c2', text: 'second' },
        { actorUuid: 'client', lamportTs: 3, ts: 200 }),
    ];
    const s = window.MyFb.core.reducer.replay(events);
    expect(Object.keys(s.demandes.d1.comments)).toEqual(['c1', 'c2']);
    expect(s.demandes.d1.comments.c1.authorUuid).toBe('admin');
    expect(s.demandes.d1.comments.c2.text).toBe('second');
  });

  it('DEMANDE_COMMENT_EDITED flips `edited` and updates text', () => {
    const events = [
      E(T().DEMANDE_CREATED, { id: 'd1', text: '' }),
      E(T().DEMANDE_COMMENTED, { demandeId: 'd1', commentId: 'c1', text: 'orig' },
        { actorUuid: 'a', lamportTs: 2 }),
      E(T().DEMANDE_COMMENT_EDITED, { demandeId: 'd1', commentId: 'c1', text: 'fixed' },
        { actorUuid: 'a', lamportTs: 3 }),
    ];
    const s = window.MyFb.core.reducer.replay(events);
    expect(s.demandes.d1.comments.c1.text).toBe('fixed');
    expect(s.demandes.d1.comments.c1.edited).toBe(true);
  });
});

describe('MyFb.core.reducer — refs', () => {
  it('REF_ADDED stores a ref keyed by ref.id', () => {
    const ref = { id: 'r1', type: 'element', selector: '.btn' };
    const events = [
      E(T().DEMANDE_CREATED, { id: 'd1', text: '' }),
      E(T().REF_ADDED, { demandeId: 'd1', ref }, { actorUuid: 'a', lamportTs: 2 }),
    ];
    const s = window.MyFb.core.reducer.replay(events);
    expect(s.demandes.d1.refs.r1).toEqual(ref);
  });

  it('REF_REMOVED deletes the ref', () => {
    const events = [
      E(T().DEMANDE_CREATED, { id: 'd1', text: '' }),
      E(T().REF_ADDED, { demandeId: 'd1', ref: { id: 'r1', type: 'screenshot' } },
        { actorUuid: 'a', lamportTs: 2 }),
      E(T().REF_REMOVED, { demandeId: 'd1', refId: 'r1' }, { actorUuid: 'a', lamportTs: 3 }),
    ];
    const s = window.MyFb.core.reducer.replay(events);
    expect(s.demandes.d1.refs.r1).toBeUndefined();
  });
});

describe('MyFb.core.reducer — devices and links', () => {
  it('DEVICE_CONNECTED stores once (idempotent on second connect)', () => {
    const events = [
      E(T().DEVICE_CONNECTED, { uuid: 'dev-1', meta: { browser: 'Chrome' } },
        { actorUuid: 'dev-1', lamportTs: 1, ts: 100 }),
      E(T().DEVICE_CONNECTED, { uuid: 'dev-1', meta: { browser: 'Firefox' } },
        { actorUuid: 'dev-1', lamportTs: 2, ts: 200 }),
    ];
    const s = window.MyFb.core.reducer.replay(events);
    expect(s.devices['dev-1'].meta.browser).toBe('Chrome'); // first wins
    expect(s.devices['dev-1'].firstSeenAt).toBe(100);
  });

  it('DEVICE_META_UPDATED overwrites meta', () => {
    const events = [
      E(T().DEVICE_CONNECTED, { uuid: 'dev-1', meta: { browser: 'Chrome' } },
        { actorUuid: 'dev-1', lamportTs: 1 }),
      E(T().DEVICE_META_UPDATED, { uuid: 'dev-1', meta: { browser: 'Chrome', viewport: { w: 1440 } } },
        { actorUuid: 'dev-1', lamportTs: 2 }),
    ];
    const s = window.MyFb.core.reducer.replay(events);
    expect(s.devices['dev-1'].meta.viewport.w).toBe(1440);
  });

  it('LINK_REQUESTED → LINK_ACCEPTED transitions status', () => {
    const events = [
      E(T().LINK_REQUESTED, { peerUuid: 'peer-1', peerRole: 'admin', peerLabel: 'John' },
        { actorUuid: 'a', lamportTs: 1 }),
      E(T().LINK_ACCEPTED, { peerUuid: 'peer-1' }, { actorUuid: 'a', lamportTs: 2 }),
    ];
    const s = window.MyFb.core.reducer.replay(events);
    expect(s.links['peer-1'].status).toBe('accepted');
  });
});

describe('MyFb.core.reducer — forward compatibility', () => {
  it('skips events with a future schemaVersion', () => {
    const futureEvent = {
      id:            'evt-future',
      type:          'demande.created',
      payload:       { id: 'd1', text: 'from the future' },
      ts:            1000,
      lamportTs:     1,
      actorUuid:     'a',
      schemaVersion: 99,
    };
    const s = window.MyFb.core.reducer.replay([futureEvent]);
    expect(s.demandes.d1).toBeUndefined();
  });

  it('ignores unknown event types without throwing', () => {
    const events = [
      E(T().DEMANDE_CREATED, { id: 'd1', text: 'hi' }),
      // Bypass makeEvent's whitelist by constructing manually
      {
        id: 'evt-x', type: 'something.brand_new', payload: {},
        ts: 1, lamportTs: 2, actorUuid: 'a', schemaVersion: 1,
      },
    ];
    const s = window.MyFb.core.reducer.replay(events);
    expect(s.demandes.d1).toBeDefined();
  });
});
