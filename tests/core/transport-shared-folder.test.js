import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/core/events/catalog.js');
  loadAddonScript('shared/core/transports/shared-folder.js');
});

// ── Mock File System Access API: a simple in-memory dir handle ──────
function mockDirHandle() {
  const files = {};
  function getFileHandle(name) {
    return Promise.resolve({
      getFile: () => Promise.resolve({
        text: () => Promise.resolve(files[name] || ''),
      }),
      createWritable: () => {
        let pending = '';
        return Promise.resolve({
          write: (s) => { pending = s; return Promise.resolve(); },
          close: () => { files[name] = pending; return Promise.resolve(); },
        });
      },
    });
  }
  return {
    getFileHandle: (name, opts) => getFileHandle(name),
    _files: files,
  };
}

function mkEvent(lamportTs, id) {
  const { makeEvent, TYPES } = window.MyFb.core.events;
  return makeEvent(TYPES.DEMANDE_CREATED, { id: 'dem-' + id, text: 't' }, {
    actorUuid: 'actor-x',
    lamportTs,
    id: 'evt-' + id,
  });
}

describe('shared-folder transport — basics', () => {
  it('init() rejects without a dirHandle', async () => {
    const tx = window.MyFb.core.transports.sharedFolder.create();
    await expect(tx.init()).rejects.toThrow(/dirHandle/);
    expect(tx.status().state).toBe('error');
  });

  it('init() resolves with a valid dirHandle and sets status to idle', async () => {
    const tx = window.MyFb.core.transports.sharedFolder.create();
    await tx.init({ dirHandle: mockDirHandle(), poll: 60_000 });
    expect(tx.status().state).toBe('idle');
    await tx.dispose();
  });
});

describe('shared-folder transport — push / pull cycle', () => {
  let tx, dir;
  beforeEach(async () => {
    dir = mockDirHandle();
    tx  = window.MyFb.core.transports.sharedFolder.create();
    await tx.init({ dirHandle: dir, poll: 60_000 });
  });

  it('push() appends events as JSONL lines', async () => {
    await tx.push([mkEvent(1, 'a'), mkEvent(2, 'b')]);
    const txt = dir._files['events.jsonl'];
    expect(txt).toBeTruthy();
    const lines = txt.trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).id).toBe('evt-a');
    expect(JSON.parse(lines[1]).id).toBe('evt-b');
  });

  it('pull() returns new events not yet seen', async () => {
    // Simulate another peer writing events first
    dir._files['events.jsonl'] = JSON.stringify(mkEvent(1, 'a')) + '\n' +
                                  JSON.stringify(mkEvent(2, 'b')) + '\n';
    const events = await tx.pull(-1);
    expect(events.length).toBe(2);
    expect(events.map((e) => e.id)).toEqual(['evt-a', 'evt-b']);
  });

  it('pull() skips events already seen in a previous pull', async () => {
    dir._files['events.jsonl'] = JSON.stringify(mkEvent(1, 'a')) + '\n';
    const first = await tx.pull(-1);
    expect(first.length).toBe(1);
    // Add another event
    dir._files['events.jsonl'] += JSON.stringify(mkEvent(2, 'b')) + '\n';
    const second = await tx.pull(-1);
    expect(second.length).toBe(1);
    expect(second[0].id).toBe('evt-b');
  });

  it('pull(since) filters events with lamportTs <= since', async () => {
    dir._files['events.jsonl'] = [
      JSON.stringify(mkEvent(1, 'a')),
      JSON.stringify(mkEvent(2, 'b')),
      JSON.stringify(mkEvent(3, 'c')),
    ].join('\n') + '\n';
    const events = await tx.pull(1);
    expect(events.map((e) => e.id)).toEqual(['evt-b', 'evt-c']);
  });

  it('pull() ignores malformed lines silently', async () => {
    dir._files['events.jsonl'] = [
      'not json',
      JSON.stringify(mkEvent(1, 'a')),
      '{"bad": "missing required fields"}',
    ].join('\n') + '\n';
    const events = await tx.pull(-1);
    expect(events.length).toBe(1);
    expect(events[0].id).toBe('evt-a');
  });

  it('push() then pull() round-trip — pushed events show up as seen', async () => {
    await tx.push([mkEvent(1, 'a')]);
    const events = await tx.pull(-1);
    // Our own push shouldn't come back in our own pull (seen set)
    expect(events.length).toBe(0);
  });
});

describe('shared-folder transport — subscribe + dispose', () => {
  it('subscribe() returns an unsubscriber', async () => {
    const tx = window.MyFb.core.transports.sharedFolder.create();
    await tx.init({ dirHandle: mockDirHandle(), poll: 60_000 });
    const unsub = tx.subscribe(() => {});
    expect(typeof unsub).toBe('function');
    unsub();
    await tx.dispose();
  });

  it('dispose() stops polling and resets state', async () => {
    const tx = window.MyFb.core.transports.sharedFolder.create();
    await tx.init({ dirHandle: mockDirHandle(), poll: 60_000 });
    await tx.dispose();
    expect(tx.status().state).toBe('idle');
  });
});
