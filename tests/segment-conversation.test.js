/**
 * Tests for the v2.5 segment conversation features :
 *   - addComment(id, text, { mentions, target, proposeText })
 *   - acceptProposal(id, commentId) → DEMANDE_TEXT_UPDATED + audit
 *   - refuseProposal(id, commentId) → status flag only
 *   - Reducer stores extras + applies proposal status patches
 */
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
  loadAddonScript('sidepanel/triage-api.js');
});

function memStorage() {
  const mem = {};
  return {
    get:    (k) => Promise.resolve(mem[k] !== undefined ? { [k]: mem[k] } : {}),
    set:    (o) => { Object.assign(mem, o); return Promise.resolve(); },
    remove: (k) => { delete mem[k]; return Promise.resolve(); },
  };
}

let dbCounter = 0;
async function freshRuntime() {
  dbCounter++;
  window.MyFb.core.deviceMeta.__setStorageImpl(memStorage());
  window.MyFb.core.profile.__setStorageImpl(memStorage());
  const ctx = await window.MyFb.core.bootstrap.init({ dbName: 'mfb-conv-test-' + dbCounter });
  window.MyFb.runtime = ctx;
  await ctx.emit('demande.created', { id: 'd1', text: 'initial text', url: null });
  return ctx;
}

beforeEach(() => { window.MyFb.runtime = null; });

describe('addComment — rich opts', () => {
  it('stores mentions in the reducer state', async () => {
    const ctx = await freshRuntime();
    await window.MyFbTriage.addComment('d1', 'Look at this @alice', { mentions: ['alice-uuid'] });
    const cmts = window.MyFbTriage.listComments('d1');
    expect(cmts).toHaveLength(1);
    expect(cmts[0].mentions).toEqual(['alice-uuid']);
  });

  it('stores target (single peer uuid)', async () => {
    const ctx = await freshRuntime();
    await window.MyFbTriage.addComment('d1', 'PTAL', { target: 'bob-uuid' });
    const cmts = window.MyFbTriage.listComments('d1');
    expect(cmts[0].target).toBe('bob-uuid');
  });

  it('stores proposeText', async () => {
    const ctx = await freshRuntime();
    await window.MyFbTriage.addComment('d1', 'Reformulé :', { proposeText: 'Revised segment body' });
    const cmts = window.MyFbTriage.listComments('d1');
    expect(cmts[0].proposeText).toBe('Revised segment body');
  });

  it('caps mentions at 16 and proposeText at 50000', async () => {
    const ctx = await freshRuntime();
    const many = Array.from({ length: 30 }, (_, i) => 'uuid-' + i);
    const huge = 'x'.repeat(60000);
    await window.MyFbTriage.addComment('d1', 't', { mentions: many, proposeText: huge });
    const c = window.MyFbTriage.listComments('d1')[0];
    expect(c.mentions).toHaveLength(16);
    expect(c.proposeText.length).toBe(50000);
  });

  it('keeps backwards compat — no opts means no extras', async () => {
    const ctx = await freshRuntime();
    await window.MyFbTriage.addComment('d1', 'plain');
    const c = window.MyFbTriage.listComments('d1')[0];
    expect(c.mentions).toBeUndefined();
    expect(c.target).toBeUndefined();
    expect(c.proposeText).toBeUndefined();
  });
});

describe('acceptProposal', () => {
  it('updates the demande text + flags the comment as accepted', async () => {
    const ctx = await freshRuntime();
    await window.MyFbTriage.addComment('d1', 'Reformulé', { proposeText: 'Approved version' });
    const cid = window.MyFbTriage.listComments('d1')[0].id;
    await window.MyFbTriage.acceptProposal('d1', cid);
    expect(ctx.state.demandes['d1'].text).toBe('Approved version');
    const c = window.MyFbTriage.listComments('d1')[0];
    expect(c.proposalStatus).toBe('accepted');
    expect(c.acceptedBy).toBeTruthy();
  });

  it('rejects acceptance when comment has no proposeText', async () => {
    const ctx = await freshRuntime();
    await window.MyFbTriage.addComment('d1', 'just a remark');
    const cid = window.MyFbTriage.listComments('d1')[0].id;
    await expect(window.MyFbTriage.acceptProposal('d1', cid))
      .rejects.toThrow(/no proposeText/);
  });

  it('rejects double-acceptance', async () => {
    const ctx = await freshRuntime();
    await window.MyFbTriage.addComment('d1', 'x', { proposeText: 'v1' });
    const cid = window.MyFbTriage.listComments('d1')[0].id;
    await window.MyFbTriage.acceptProposal('d1', cid);
    await expect(window.MyFbTriage.acceptProposal('d1', cid))
      .rejects.toThrow(/already resolved/);
  });
});

describe('refuseProposal', () => {
  it('marks the proposal refused without touching the segment text', async () => {
    const ctx = await freshRuntime();
    const before = ctx.state.demandes['d1'].text;
    await window.MyFbTriage.addComment('d1', 'no thanks', { proposeText: 'rejected version' });
    const cid = window.MyFbTriage.listComments('d1')[0].id;
    await window.MyFbTriage.refuseProposal('d1', cid);
    expect(ctx.state.demandes['d1'].text).toBe(before);
    const c = window.MyFbTriage.listComments('d1')[0];
    expect(c.proposalStatus).toBe('refused');
    expect(c.refusedBy).toBeTruthy();
  });

  it('rejects double-refusal', async () => {
    const ctx = await freshRuntime();
    await window.MyFbTriage.addComment('d1', 'x', { proposeText: 'v1' });
    const cid = window.MyFbTriage.listComments('d1')[0].id;
    await window.MyFbTriage.refuseProposal('d1', cid);
    await expect(window.MyFbTriage.refuseProposal('d1', cid))
      .rejects.toThrow(/already resolved/);
  });

  it('cannot be accepted after refusal', async () => {
    const ctx = await freshRuntime();
    await window.MyFbTriage.addComment('d1', 'x', { proposeText: 'v1' });
    const cid = window.MyFbTriage.listComments('d1')[0].id;
    await window.MyFbTriage.refuseProposal('d1', cid);
    await expect(window.MyFbTriage.acceptProposal('d1', cid))
      .rejects.toThrow(/already resolved/);
  });
});

describe('Reducer — DEMANDE_COMMENT_EDITED accepts proposal patches', () => {
  it('text-only edit preserves proposal fields', async () => {
    const ctx = await freshRuntime();
    await window.MyFbTriage.addComment('d1', 'orig', { proposeText: 'v1' });
    const cid = window.MyFbTriage.listComments('d1')[0].id;
    await window.MyFbTriage.editComment('d1', cid, 'edited');
    const c = window.MyFbTriage.listComments('d1')[0];
    expect(c.text).toBe('edited');
    expect(c.proposeText).toBe('v1');     // preserved
    expect(c.edited).toBe(true);
  });
});
