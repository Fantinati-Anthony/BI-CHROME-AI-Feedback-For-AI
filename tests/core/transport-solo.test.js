import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/core/transports/interface.js');
  loadAddonScript('shared/core/transports/solo.js');
});

describe('MyFb.core.transports.interface', () => {
  it('exposes the canonical TRANSPORTS enum', () => {
    const { TRANSPORTS } = window.MyFb.core.transports;
    expect(TRANSPORTS.SOLO).toBe('solo');
    expect(TRANSPORTS.SHARED_FOLDER).toBe('shared-folder');
    expect(TRANSPORTS.SELF_HOSTED).toBe('self-hosted');
    expect(TRANSPORTS.CLOUD).toBe('cloud');
    expect(Object.isFrozen(TRANSPORTS)).toBe(true);
  });
});

describe('MyFb.core.transports.solo', () => {
  it('init() resolves and status() reports idle', async () => {
    const tx = window.MyFb.core.transports.solo.create();
    await tx.init();
    expect(tx.status().state).toBe('idle');
  });

  it('push() is a no-op (resolves with no side effect)', async () => {
    const tx = window.MyFb.core.transports.solo.create();
    await tx.init();
    await expect(tx.push([{ id: 'evt-1' }])).resolves.toBeUndefined();
  });

  it('pull() always returns empty array', async () => {
    const tx = window.MyFb.core.transports.solo.create();
    await tx.init();
    expect(await tx.pull(-1)).toEqual([]);
    expect(await tx.pull(100)).toEqual([]);
  });

  it('subscribe() returns a no-op unsubscriber, never fires', () => {
    const tx = window.MyFb.core.transports.solo.create();
    let called = false;
    const unsub = tx.subscribe(() => { called = true; });
    expect(typeof unsub).toBe('function');
    unsub();
    expect(called).toBe(false);
  });

  it('dispose() is idempotent', async () => {
    const tx = window.MyFb.core.transports.solo.create();
    await tx.init();
    await tx.dispose();
    await tx.dispose();
    expect(tx.status().state).toBe('idle');
  });
});
