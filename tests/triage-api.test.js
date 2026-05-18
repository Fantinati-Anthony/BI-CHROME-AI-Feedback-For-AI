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
  const ctx = await window.MyFb.core.bootstrap.init({ dbName: 'mfb-triage-test-' + dbCounter });
  window.MyFb.runtime = ctx;
  // Pre-create a demande to triage
  await ctx.emit('demande.created', { id: 'd1', text: 'sample', url: null });
  await ctx.emit('demande.created', { id: 'd2', text: 'second', url: null });
  return ctx;
}

beforeEach(() => {
  window.MyFb.runtime = null;
});

describe('MyFbTriage — constants', () => {
  it('exposes 4 statuses and 4 priorities', () => {
    expect(window.MyFbTriage.STATUSES).toEqual(['new', 'accepted', 'rejected', 'shipped']);
    expect(window.MyFbTriage.PRIORITIES).toEqual(['low', 'medium', 'high', 'critical']);
  });
});

describe('MyFbTriage — runtime-not-booted safety', () => {
  it('all reads return safe defaults', () => {
    expect(window.MyFbTriage.getStatus('d1')).toBeNull();
    expect(window.MyFbTriage.getPriority('d1')).toBeNull();
    expect(window.MyFbTriage.getAssignee('d1')).toBeNull();
    expect(window.MyFbTriage.getTags('d1')).toEqual([]);
    expect(window.MyFbTriage.listComments('d1')).toEqual([]);
    expect(window.MyFbTriage.listByStatus('new')).toEqual([]);
    expect(window.MyFbTriage.statusCounts()).toEqual({ new: 0, accepted: 0, rejected: 0, shipped: 0 });
  });

  it('all writers resolve to null (no-op) when runtime is missing', async () => {
    await expect(window.MyFbTriage.setStatus('d1', 'accepted')).resolves.toBeNull();
    await expect(window.MyFbTriage.setPriority('d1', 'high')).resolves.toBeNull();
    await expect(window.MyFbTriage.setAssignee('d1', 'u1')).resolves.toBeNull();
    await expect(window.MyFbTriage.addTag('d1', 'bug')).resolves.toBeNull();
    await expect(window.MyFbTriage.addComment('d1', 'hi')).resolves.toBeNull();
  });
});

describe('MyFbTriage — status', () => {
  beforeEach(async () => { await freshRuntime(); });

  it('default status is "new"', () => {
    expect(window.MyFbTriage.getStatus('d1')).toBe('new');
  });

  it('setStatus persists and reads back', async () => {
    await window.MyFbTriage.setStatus('d1', 'accepted');
    expect(window.MyFbTriage.getStatus('d1')).toBe('accepted');
  });

  it('rejects invalid status values', async () => {
    await expect(window.MyFbTriage.setStatus('d1', 'banana')).rejects.toThrow(/invalid status/);
  });

  it('rejects unknown demande ids', async () => {
    await expect(window.MyFbTriage.setStatus('nope', 'accepted')).rejects.toThrow(/unknown demande/);
  });
});

describe('MyFbTriage — priority', () => {
  beforeEach(async () => { await freshRuntime(); });

  it('default priority is "medium"', () => {
    expect(window.MyFbTriage.getPriority('d1')).toBe('medium');
  });

  it('setPriority works through the full enum', async () => {
    for (const p of ['low', 'medium', 'high', 'critical']) {
      await window.MyFbTriage.setPriority('d1', p);
      expect(window.MyFbTriage.getPriority('d1')).toBe(p);
    }
  });

  it('rejects invalid priority values', async () => {
    await expect(window.MyFbTriage.setPriority('d1', 'meh')).rejects.toThrow(/invalid priority/);
  });
});

describe('MyFbTriage — assignment', () => {
  beforeEach(async () => { await freshRuntime(); });

  it('default assignee is null', () => {
    expect(window.MyFbTriage.getAssignee('d1')).toBeNull();
  });

  it('setAssignee persists', async () => {
    await window.MyFbTriage.setAssignee('d1', 'user-uuid-1');
    expect(window.MyFbTriage.getAssignee('d1')).toBe('user-uuid-1');
  });

  it('setAssignee(null) clears the assignment', async () => {
    await window.MyFbTriage.setAssignee('d1', 'user-uuid-1');
    await window.MyFbTriage.setAssignee('d1', null);
    expect(window.MyFbTriage.getAssignee('d1')).toBeNull();
  });
});

describe('MyFbTriage — tags', () => {
  beforeEach(async () => { await freshRuntime(); });

  it('default tags are []', () => {
    expect(window.MyFbTriage.getTags('d1')).toEqual([]);
  });

  it('addTag persists and normalizes', async () => {
    await window.MyFbTriage.addTag('d1', '  Bug  ');
    await window.MyFbTriage.addTag('d1', 'urgent stuff');
    expect(window.MyFbTriage.getTags('d1')).toEqual(['bug', 'urgent-stuff']);
  });

  it('addTag is idempotent — same tag once', async () => {
    await window.MyFbTriage.addTag('d1', 'bug');
    await window.MyFbTriage.addTag('d1', 'bug');
    expect(window.MyFbTriage.getTags('d1')).toEqual(['bug']);
  });

  it('removeTag works', async () => {
    await window.MyFbTriage.addTag('d1', 'bug');
    await window.MyFbTriage.addTag('d1', 'urgent');
    await window.MyFbTriage.removeTag('d1', 'bug');
    expect(window.MyFbTriage.getTags('d1')).toEqual(['urgent']);
  });

  it('rejects empty tags', async () => {
    await expect(window.MyFbTriage.addTag('d1', '   ')).rejects.toThrow(/empty/);
    await expect(window.MyFbTriage.addTag('d1', null)).rejects.toThrow(/empty/);
  });
});

describe('MyFbTriage — comments', () => {
  beforeEach(async () => { await freshRuntime(); });

  it('addComment creates a comment with the actor uuid', async () => {
    await window.MyFbTriage.addComment('d1', 'looks good');
    const comments = window.MyFbTriage.listComments('d1');
    expect(comments.length).toBe(1);
    expect(comments[0].text).toBe('looks good');
    expect(typeof comments[0].authorUuid).toBe('string');
    expect(typeof comments[0].id).toBe('string');
    expect(comments[0].id).toMatch(/^cmt-/);
  });

  it('comments are sorted by timestamp ascending', async () => {
    await window.MyFbTriage.addComment('d1', 'first');
    await new Promise((r) => setTimeout(r, 5));
    await window.MyFbTriage.addComment('d1', 'second');
    const list = window.MyFbTriage.listComments('d1');
    expect(list.map((c) => c.text)).toEqual(['first', 'second']);
  });

  it('editComment updates text + flips edited flag', async () => {
    const e = await window.MyFbTriage.addComment('d1', 'orig');
    const id = e.payload.commentId;
    await window.MyFbTriage.editComment('d1', id, 'fixed');
    const comments = window.MyFbTriage.listComments('d1');
    expect(comments[0].text).toBe('fixed');
    expect(comments[0].edited).toBe(true);
  });

  it('deleteComment removes from listComments()', async () => {
    const e = await window.MyFbTriage.addComment('d1', 'meh');
    const id = e.payload.commentId;
    await window.MyFbTriage.deleteComment('d1', id);
    expect(window.MyFbTriage.listComments('d1')).toEqual([]);
  });

  it('rejects empty / invalid comments', async () => {
    await expect(window.MyFbTriage.addComment('d1', '   ')).rejects.toThrow(/empty/);
    await expect(window.MyFbTriage.editComment('d1', 'bogus', 'x')).rejects.toThrow(/unknown comment/);
  });
});

describe('MyFbTriage — queries / counts', () => {
  beforeEach(async () => {
    await freshRuntime();
    await window.MyFbTriage.setStatus('d1', 'accepted');
    await window.MyFbTriage.setStatus('d2', 'shipped');
    await window.MyFbTriage.setPriority('d1', 'high');
    await window.MyFbTriage.setAssignee('d2', 'admin-1');
    await window.MyFbTriage.addTag('d1', 'bug');
    await window.MyFbTriage.addTag('d2', 'bug');
  });

  it('listByStatus returns matching demandes', () => {
    expect(window.MyFbTriage.listByStatus('accepted').map((d) => d.id)).toEqual(['d1']);
    expect(window.MyFbTriage.listByStatus('shipped').map((d) => d.id)).toEqual(['d2']);
    expect(window.MyFbTriage.listByStatus('new')).toEqual([]);
  });

  it('listByPriority returns matching demandes', () => {
    expect(window.MyFbTriage.listByPriority('high').map((d) => d.id)).toEqual(['d1']);
  });

  it('listByAssignee returns matching demandes', () => {
    expect(window.MyFbTriage.listByAssignee('admin-1').map((d) => d.id)).toEqual(['d2']);
    expect(window.MyFbTriage.listByAssignee('nobody')).toEqual([]);
  });

  it('listByTag returns matching demandes', () => {
    expect(window.MyFbTriage.listByTag('bug').map((d) => d.id).sort()).toEqual(['d1', 'd2']);
    expect(window.MyFbTriage.listByTag('urgent')).toEqual([]);
  });

  it('statusCounts aggregates non-deleted demandes', () => {
    expect(window.MyFbTriage.statusCounts()).toEqual({ new: 0, accepted: 1, rejected: 0, shipped: 1 });
  });
});

describe('MyFbTriage — _normalizeTag', () => {
  it('trims, lowercases, hyphenates, truncates to 40 chars', () => {
    expect(window.MyFbTriage._normalizeTag('  Hello World  ')).toBe('hello-world');
    expect(window.MyFbTriage._normalizeTag('UPPERCASE')).toBe('uppercase');
    expect(window.MyFbTriage._normalizeTag('a'.repeat(100))).toBe('a'.repeat(40));
    expect(window.MyFbTriage._normalizeTag('')).toBeNull();
    expect(window.MyFbTriage._normalizeTag(null)).toBeNull();
    expect(window.MyFbTriage._normalizeTag(123)).toBeNull();
  });
});
