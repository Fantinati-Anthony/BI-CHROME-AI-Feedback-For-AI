import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/core/events/catalog.js');
  loadAddonScript('shared/core/pairing.js');
  loadAddonScript('shared/core/pairing-handler.js');
});

const UUID_ADMIN  = 'a3f2c1b8-1111-4abc-9def-0123456789ab';
const UUID_CLIENT = 'b7e9d2c0-2222-4fed-8cba-fedcba987654';

describe('pairingHandler.resolvePlaceholders', () => {
  it('replaces a pending:<fingerprint> key with the full uuid once link.accepted arrives', () => {
    const pairing = window.MyFb.core.pairing;
    const fp = pairing.fingerprintOf(UUID_ADMIN);
    const links = {
      ['pending:' + fp]: {
        peerUuid: 'pending:' + fp,
        peerRole: 'admin',
        fingerprint: fp,
        status: 'pending',
      },
    };
    const events = [
      { type: 'link.accepted', payload: { peerUuid: UUID_CLIENT, acceptedBy: UUID_ADMIN, displayName: 'Alice' } },
    ];
    const out = window.MyFb.core.pairingHandler.resolvePlaceholders(links, events);
    expect(out[UUID_ADMIN]).toBeDefined();
    expect(out[UUID_ADMIN].peerUuid).toBe(UUID_ADMIN);
    expect(out[UUID_ADMIN].status).toBe('accepted');
    // Original placeholder key should be gone
    expect(out['pending:' + fp]).toBeUndefined();
  });

  it('leaves non-placeholder entries untouched', () => {
    const links = {
      [UUID_ADMIN]: { peerUuid: UUID_ADMIN, status: 'accepted' },
    };
    const out = window.MyFb.core.pairingHandler.resolvePlaceholders(links, []);
    expect(out[UUID_ADMIN].status).toBe('accepted');
  });

  it('keeps the placeholder unchanged if no matching link.accepted event exists', () => {
    const fp = window.MyFb.core.pairing.fingerprintOf(UUID_ADMIN);
    const links = { ['pending:' + fp]: { peerUuid: 'pending:' + fp, fingerprint: fp, status: 'pending' } };
    const out = window.MyFb.core.pairingHandler.resolvePlaceholders(links, []);
    expect(out['pending:' + fp]).toBeDefined();
    expect(out['pending:' + fp].status).toBe('pending');
  });

  it('handles empty inputs', () => {
    expect(window.MyFb.core.pairingHandler.resolvePlaceholders({}, [])).toEqual({});
    expect(window.MyFb.core.pairingHandler.resolvePlaceholders(null, null)).toEqual({});
  });

  it('ignores non-link.accepted events', () => {
    const links = { foo: { peerUuid: 'foo', status: 'accepted' } };
    const events = [
      { type: 'demande.created', payload: {} },
      { type: 'link.requested', payload: { peerUuid: 'pending:X' } },
    ];
    const out = window.MyFb.core.pairingHandler.resolvePlaceholders(links, events);
    expect(out.foo).toBeDefined();
  });
});

describe('pairingHandler.attach', () => {
  function fakeCtx(uuid, links) {
    let _state = { links: links || {} };
    let emitted = [];
    return {
      uuid: uuid,
      state: _state,
      profile: { displayName: 'Test' },
      emit: (type, payload) => {
        emitted.push({ type, payload });
        return Promise.resolve({ type, payload });
      },
      _emitted: () => emitted,
    };
  }

  it('throws without ctx + uuid', () => {
    expect(() => window.MyFb.core.pairingHandler.attach()).toThrow(/requires/);
    expect(() => window.MyFb.core.pairingHandler.attach({})).toThrow(/requires/);
  });

  it('detach() stops the scan timer', () => {
    const ctx = fakeCtx(UUID_ADMIN);
    const detach = window.MyFb.core.pairingHandler.attach(ctx);
    expect(typeof detach).toBe('function');
    detach();
    // No assertion needed beyond "didn't throw" — the timer is internal.
  });

  it('immediately emits link.accepted when a pending request matching our fingerprint exists', async () => {
    const fp = window.MyFb.core.pairing.fingerprintOf(UUID_ADMIN);
    const ctx = fakeCtx(UUID_ADMIN, {
      ['pending:' + fp]: { peerUuid: 'pending:' + fp, fingerprint: fp, status: 'pending' },
    });
    const detach = window.MyFb.core.pairingHandler.attach(ctx);
    // attach() runs an initial scan synchronously
    await new Promise((r) => setTimeout(r, 10));
    const emitted = ctx._emitted();
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('link.accepted');
    expect(emitted[0].payload.acceptedBy).toBe(UUID_ADMIN);
    expect(emitted[0].payload.displayName).toBe('Test');
    detach();
  });

  it('does not re-emit link.accepted for the same peer twice', async () => {
    const fp = window.MyFb.core.pairing.fingerprintOf(UUID_ADMIN);
    const peer = 'pending:' + fp;
    const ctx = fakeCtx(UUID_ADMIN, { [peer]: { peerUuid: peer, fingerprint: fp, status: 'pending' } });
    const detach = window.MyFb.core.pairingHandler.attach(ctx);
    await new Promise((r) => setTimeout(r, 10));
    // simulate ctx.state.links unchanged
    await new Promise((r) => setTimeout(r, 2100)); // wait one poll cycle
    expect(ctx._emitted().length).toBe(1);
    detach();
  });

  it('does NOT respond to a pending request whose fingerprint != ours', async () => {
    const fpOther = window.MyFb.core.pairing.fingerprintOf(UUID_CLIENT);
    const ctx = fakeCtx(UUID_ADMIN, {
      ['pending:' + fpOther]: { peerUuid: 'pending:' + fpOther, fingerprint: fpOther, status: 'pending' },
    });
    const detach = window.MyFb.core.pairingHandler.attach(ctx);
    await new Promise((r) => setTimeout(r, 10));
    expect(ctx._emitted().length).toBe(0);
    detach();
  });

  it('does NOT respond to non-pending links', async () => {
    const fp = window.MyFb.core.pairing.fingerprintOf(UUID_ADMIN);
    const ctx = fakeCtx(UUID_ADMIN, {
      ['pending:' + fp]: { peerUuid: 'pending:' + fp, fingerprint: fp, status: 'accepted' },
    });
    const detach = window.MyFb.core.pairingHandler.attach(ctx);
    await new Promise((r) => setTimeout(r, 10));
    expect(ctx._emitted().length).toBe(0);
    detach();
  });
});
