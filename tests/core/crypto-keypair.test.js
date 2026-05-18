import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';

beforeAll(() => {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    globalThis.crypto = webcrypto;
  }
  loadAddonScript('shared/core/crypto/keypair.js');
});

function mkStore() {
  const mem = {};
  return {
    metaGet: (k) => Promise.resolve(mem[k]),
    metaSet: (k, v) => { mem[k] = v; return Promise.resolve(); },
    _mem: mem,
  };
}

describe('crypto.keypair.generate', () => {
  it('generates a public + private JWK pair', async () => {
    const out = await window.MyFb.core.crypto.keypair.generate();
    expect(out.publicJwk).toBeDefined();
    expect(out.privateJwk).toBeDefined();
    expect(out.publicJwk.crv).toBe('P-256');
    expect(out.publicJwk.kty).toBe('EC');
    expect(out.privateJwk.d).toBeDefined();  // private "d" coordinate
  });
});

describe('crypto.keypair.loadOrCreate', () => {
  it('creates and persists a fresh keypair on first call', async () => {
    const store = mkStore();
    const out = await window.MyFb.core.crypto.keypair.loadOrCreate(store);
    expect(out.publicJwk).toBeDefined();
    expect(store._mem['crypto.privateJwk']).toBeDefined();
    expect(store._mem['crypto.publicJwk']).toBeDefined();
  });

  it('returns the same keypair on subsequent calls', async () => {
    const store = mkStore();
    const first  = await window.MyFb.core.crypto.keypair.loadOrCreate(store);
    const second = await window.MyFb.core.crypto.keypair.loadOrCreate(store);
    expect(second.publicJwk.x).toBe(first.publicJwk.x);
    expect(second.publicJwk.y).toBe(first.publicJwk.y);
  });

  it('rejects without a store', async () => {
    await expect(window.MyFb.core.crypto.keypair.loadOrCreate(null)).rejects.toThrow();
  });
});

describe('crypto.keypair.encrypt / decrypt round-trip', () => {
  it('Alice → Bob round-trip preserves payload', async () => {
    const aliceStore = mkStore();
    const bobStore   = mkStore();
    const alice = await window.MyFb.core.crypto.keypair.loadOrCreate(aliceStore);
    const bob   = await window.MyFb.core.crypto.keypair.loadOrCreate(bobStore);

    // Alice encrypts a payload for Bob
    const sharedAlice = await window.MyFb.core.crypto.keypair.deriveSharedKey(alice.privateJwk, bob.publicJwk);
    const envelope    = await window.MyFb.core.crypto.keypair.encrypt(sharedAlice, { msg: 'hello bob', n: 42 });
    expect(envelope).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

    // Bob derives the SAME shared key from his side (ECDH symmetry)
    const sharedBob = await window.MyFb.core.crypto.keypair.deriveSharedKey(bob.privateJwk, alice.publicJwk);
    const recovered = await window.MyFb.core.crypto.keypair.decrypt(sharedBob, envelope);
    expect(recovered).toEqual({ msg: 'hello bob', n: 42 });
  });

  it('decrypt rejects a tampered envelope', async () => {
    const s = mkStore();
    const me = await window.MyFb.core.crypto.keypair.loadOrCreate(s);
    const sharedSelf = await window.MyFb.core.crypto.keypair.deriveSharedKey(me.privateJwk, me.publicJwk);
    const envelope = await window.MyFb.core.crypto.keypair.encrypt(sharedSelf, { x: 1 });
    const tampered = envelope.slice(0, -4) + 'XXXX';  // corrupt the auth tag
    await expect(window.MyFb.core.crypto.keypair.decrypt(sharedSelf, tampered)).rejects.toThrow();
  });

  it('decrypt with the wrong key fails (auth tag mismatch)', async () => {
    const sA = mkStore(), sB = mkStore(), sC = mkStore();
    const a = await window.MyFb.core.crypto.keypair.loadOrCreate(sA);
    const b = await window.MyFb.core.crypto.keypair.loadOrCreate(sB);
    const c = await window.MyFb.core.crypto.keypair.loadOrCreate(sC);
    const ab = await window.MyFb.core.crypto.keypair.deriveSharedKey(a.privateJwk, b.publicJwk);
    const ac = await window.MyFb.core.crypto.keypair.deriveSharedKey(a.privateJwk, c.publicJwk);
    const envelope = await window.MyFb.core.crypto.keypair.encrypt(ab, { secret: true });
    await expect(window.MyFb.core.crypto.keypair.decrypt(ac, envelope)).rejects.toThrow();
  });

  it('decrypt rejects a malformed envelope', async () => {
    const s = mkStore();
    const me = await window.MyFb.core.crypto.keypair.loadOrCreate(s);
    const shared = await window.MyFb.core.crypto.keypair.deriveSharedKey(me.privateJwk, me.publicJwk);
    await expect(window.MyFb.core.crypto.keypair.decrypt(shared, 'not-an-envelope')).rejects.toThrow();
  });
});
