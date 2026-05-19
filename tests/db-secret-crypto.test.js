import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';

beforeAll(() => {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    globalThis.crypto = crypto.webcrypto;
  }
  loadAddonScript('sidepanel/db-secret-crypto.js');
});

describe('BIAIFDbSecretCrypto.encrypt / decrypt', () => {
  it('round-trips a simple ASCII secret', async () => {
    const env = await window.BIAIFDbSecretCrypto.encrypt('hello-world');
    expect(env).toHaveProperty('iv');
    expect(env).toHaveProperty('ct');
    expect(env.iv.length).toBeGreaterThan(0);
    expect(env.ct.length).toBeGreaterThan(0);
    const back = await window.BIAIFDbSecretCrypto.decrypt(env);
    expect(back).toBe('hello-world');
  });

  it('round-trips a 64-hex-char HMAC secret', async () => {
    const secret = crypto.randomBytes(32).toString('hex');
    const env = await window.BIAIFDbSecretCrypto.encrypt(secret);
    expect(await window.BIAIFDbSecretCrypto.decrypt(env)).toBe(secret);
  });

  it('handles UTF-8 characters', async () => {
    const text = 'café — ☕ — éàçü';
    const env = await window.BIAIFDbSecretCrypto.encrypt(text);
    expect(await window.BIAIFDbSecretCrypto.decrypt(env)).toBe(text);
  });

  it('returns empty envelope for empty string', async () => {
    const env = await window.BIAIFDbSecretCrypto.encrypt('');
    expect(env.iv).toBe('');
    expect(env.ct).toBe('');
  });

  it('uses a fresh IV per encryption (no nonce reuse)', async () => {
    const a = await window.BIAIFDbSecretCrypto.encrypt('same-secret');
    const b = await window.BIAIFDbSecretCrypto.encrypt('same-secret');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(await window.BIAIFDbSecretCrypto.decrypt(a)).toBe('same-secret');
    expect(await window.BIAIFDbSecretCrypto.decrypt(b)).toBe('same-secret');
  });

  it('isEnvelope recognises valid pairs', () => {
    expect(window.BIAIFDbSecretCrypto.isEnvelope({ iv: 'AAA', ct: 'BBB' })).toBe(true);
    expect(window.BIAIFDbSecretCrypto.isEnvelope({ iv: '', ct: 'BBB' })).toBe(false);
    expect(window.BIAIFDbSecretCrypto.isEnvelope('plain string')).toBe(false);
    expect(window.BIAIFDbSecretCrypto.isEnvelope(null)).toBe(false);
  });

  it('rejects a tampered ciphertext (AES-GCM auth)', async () => {
    const env = await window.BIAIFDbSecretCrypto.encrypt('important-secret');
    const tampered = Object.assign({}, env, { ct: env.ct.replace(/.$/, (c) => c === 'A' ? 'B' : 'A') });
    await expect(window.BIAIFDbSecretCrypto.decrypt(tampered)).rejects.toBeTruthy();
  });
});
