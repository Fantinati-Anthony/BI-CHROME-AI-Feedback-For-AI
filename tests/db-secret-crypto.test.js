import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';

beforeAll(() => {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    globalThis.crypto = crypto.webcrypto;
  }
  loadAddonScript('sidepanel/db-secret-crypto.js');
});

describe('MyFbDbSecretCrypto.encrypt / decrypt', () => {
  it('round-trips a simple ASCII secret', async () => {
    const env = await window.MyFbDbSecretCrypto.encrypt('hello-world');
    expect(env).toHaveProperty('iv');
    expect(env).toHaveProperty('ct');
    expect(env.iv.length).toBeGreaterThan(0);
    expect(env.ct.length).toBeGreaterThan(0);
    const back = await window.MyFbDbSecretCrypto.decrypt(env);
    expect(back).toBe('hello-world');
  });

  it('round-trips a 64-hex-char HMAC secret', async () => {
    const secret = crypto.randomBytes(32).toString('hex');
    const env = await window.MyFbDbSecretCrypto.encrypt(secret);
    expect(await window.MyFbDbSecretCrypto.decrypt(env)).toBe(secret);
  });

  it('handles UTF-8 characters', async () => {
    const text = 'café — ☕ — éàçü';
    const env = await window.MyFbDbSecretCrypto.encrypt(text);
    expect(await window.MyFbDbSecretCrypto.decrypt(env)).toBe(text);
  });

  it('returns empty envelope for empty string', async () => {
    const env = await window.MyFbDbSecretCrypto.encrypt('');
    expect(env.iv).toBe('');
    expect(env.ct).toBe('');
  });

  it('uses a fresh IV per encryption (no nonce reuse)', async () => {
    const a = await window.MyFbDbSecretCrypto.encrypt('same-secret');
    const b = await window.MyFbDbSecretCrypto.encrypt('same-secret');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(await window.MyFbDbSecretCrypto.decrypt(a)).toBe('same-secret');
    expect(await window.MyFbDbSecretCrypto.decrypt(b)).toBe('same-secret');
  });

  it('isEnvelope recognises valid pairs', () => {
    expect(window.MyFbDbSecretCrypto.isEnvelope({ iv: 'AAA', ct: 'BBB' })).toBe(true);
    expect(window.MyFbDbSecretCrypto.isEnvelope({ iv: '', ct: 'BBB' })).toBe(false);
    expect(window.MyFbDbSecretCrypto.isEnvelope('plain string')).toBe(false);
    expect(window.MyFbDbSecretCrypto.isEnvelope(null)).toBe(false);
  });

  it('rejects a tampered ciphertext (AES-GCM auth)', async () => {
    const env = await window.MyFbDbSecretCrypto.encrypt('important-secret');
    const tampered = Object.assign({}, env, { ct: env.ct.replace(/.$/, (c) => c === 'A' ? 'B' : 'A') });
    await expect(window.MyFbDbSecretCrypto.decrypt(tampered)).rejects.toBeTruthy();
  });
});
