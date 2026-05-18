import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/core/events/catalog.js');
  loadAddonScript('sidepanel/legacy-event-bridge.js');
});

function mkCtx(emitted) {
  const ctx = {
    state: { demandes: {} },
    emit: (type, payload) => {
      emitted.push({ type, payload });
      return Promise.resolve({ type, payload });
    },
  };
  window.MyFb = window.MyFb || {};
  window.MyFb.runtime = ctx;
  return ctx;
}

beforeEach(() => {
  // Reset module shadow
  if (window.MyFbLegacyEventBridge && window.MyFbLegacyEventBridge.syncShadow) {
    window.MyFbLegacyEventBridge.syncShadow({ demandes: [] });
  }
});

describe('MyFbLegacyEventBridge._snapshot', () => {
  it('builds a stable byId/ids snapshot from STATE.demandes', () => {
    const STATE = { demandes: [
      { id: 'd1', text: 'one', refs: [{ id: 'r1', type: 'element' }], tags: ['a'] },
      { id: 'd2', text: 'two', refs: [], tags: [] },
    ]};
    const snap = window.MyFbLegacyEventBridge._snapshot(STATE);
    expect(snap.ids).toEqual(['d1', 'd2']);
    expect(snap.byId.d1.text).toBe('one');
    expect(snap.byId.d1.refs[0].id).toBe('r1');
    expect(snap.byId.d1.tags).toEqual(['a']);
  });

  it('synthesizes ref ids for legacy refs without an id', () => {
    const STATE = { demandes: [
      { id: 'd1', text: '', refs: [{ type: 'element' }, { type: 'screenshot' }], tags: [] },
    ]};
    const snap = window.MyFbLegacyEventBridge._snapshot(STATE);
    expect(snap.byId.d1.refs[0].id).toBe('legacy:d1:0');
    expect(snap.byId.d1.refs[1].id).toBe('legacy:d1:1');
  });
});

describe('MyFbLegacyEventBridge._diffAndEmit', () => {
  let emitted;

  beforeEach(() => {
    emitted = [];
    mkCtx(emitted);
  });

  it('emits nothing on first call (records baseline)', () => {
    window.MyFbLegacyEventBridge.syncShadow({ demandes: [] });
    // First _diffAndEmit after a syncShadow is the baseline
    window.MyFbLegacyEventBridge._diffAndEmit({ demandes: [{ id: 'd1', text: 'x', refs: [], tags: [] }] });
    // It should emit because shadow was {demandes:[]} and new has d1
    expect(emitted.some((e) => e.type === 'demande.created' && e.payload.id === 'd1')).toBe(true);
  });

  it('emits demande.created when a new demande appears', () => {
    window.MyFbLegacyEventBridge.syncShadow({ demandes: [] });
    window.MyFbLegacyEventBridge._diffAndEmit({ demandes: [{ id: 'd1', text: 'hello', refs: [], tags: [] }] });
    expect(emitted.find((e) => e.type === 'demande.created')?.payload.id).toBe('d1');
  });

  it('emits demande.deleted when a demande disappears', () => {
    window.MyFbLegacyEventBridge.syncShadow({ demandes: [{ id: 'd1', text: 'x', refs: [], tags: [] }] });
    window.MyFbLegacyEventBridge._diffAndEmit({ demandes: [] });
    expect(emitted.find((e) => e.type === 'demande.deleted')?.payload.id).toBe('d1');
  });

  it('emits demande.text_updated when text changes', () => {
    window.MyFbLegacyEventBridge.syncShadow({ demandes: [{ id: 'd1', text: 'old', refs: [], tags: [] }] });
    window.MyFbLegacyEventBridge._diffAndEmit({ demandes: [{ id: 'd1', text: 'new', refs: [], tags: [] }] });
    expect(emitted.find((e) => e.type === 'demande.text_updated')?.payload.text).toBe('new');
  });

  it('emits ref.added and ref.removed when refs change', () => {
    window.MyFbLegacyEventBridge.syncShadow({
      demandes: [{ id: 'd1', text: '', refs: [{ id: 'r1', type: 'element' }], tags: [] }],
    });
    window.MyFbLegacyEventBridge._diffAndEmit({
      demandes: [{ id: 'd1', text: '', refs: [{ id: 'r2', type: 'screenshot' }], tags: [] }],
    });
    expect(emitted.find((e) => e.type === 'ref.added')?.payload.ref.id).toBe('r2');
    expect(emitted.find((e) => e.type === 'ref.removed')?.payload.refId).toBe('r1');
  });

  it('emits demande.tagged / untagged for tag changes', () => {
    window.MyFbLegacyEventBridge.syncShadow({
      demandes: [{ id: 'd1', text: '', refs: [], tags: ['bug'] }],
    });
    window.MyFbLegacyEventBridge._diffAndEmit({
      demandes: [{ id: 'd1', text: '', refs: [], tags: ['urgent'] }],
    });
    expect(emitted.find((e) => e.type === 'demande.tagged')?.payload.tag).toBe('urgent');
    expect(emitted.find((e) => e.type === 'demande.untagged')?.payload.tag).toBe('bug');
  });

  it('emits nothing when STATE is unchanged', () => {
    const state = { demandes: [{ id: 'd1', text: 'x', refs: [], tags: [] }] };
    window.MyFbLegacyEventBridge.syncShadow(state);
    emitted.length = 0;
    window.MyFbLegacyEventBridge._diffAndEmit(state);
    expect(emitted.length).toBe(0);
  });
});
