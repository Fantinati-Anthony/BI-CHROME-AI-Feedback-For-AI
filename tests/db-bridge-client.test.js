import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';

beforeAll(() => {
  // jsdom provides crypto.subtle in Node 20+; fall back to webcrypto if absent.
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    globalThis.crypto = crypto.webcrypto;
  }
  loadAddonScript('sidepanel/db-bridge-client.js');
});

/** PHP equivalent for cross-checking the signature:
 *
 *     $canon = json_encode($args, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
 *     $msg   = $ts . '.' . $nonce . '.' . $op . '.' . $canon;
 *     $sig   = hash_hmac('sha256', $msg, $secret);
 */
function nodeHmac(secret, ts, nonce, op, canonArgs) {
  const msg = `${ts}.${nonce}.${op}.${canonArgs}`;
  return crypto.createHmac('sha256', secret).update(msg).digest('hex');
}

describe('BIAIFDbBridge.signRequest', () => {
  const SECRET = 'test-secret-do-not-use';

  it('signs an empty-args request identically to PHP', async () => {
    const ts = 1716000000, nonce = 'a'.repeat(16), op = 'meta', args = {};
    const sig    = await window.BIAIFDbBridge.signRequest(SECRET, ts, nonce, op, args);
    const expect_ = nodeHmac(SECRET, ts, nonce, op, '[]'); // PHP encodes empty assoc as []
    expect(sig).toBe(expect_);
  });

  it('signs a single-arg request identically to PHP', async () => {
    const ts = 1716000000, nonce = 'b'.repeat(16), op = 'describe', args = { table: 'wp_posts' };
    const sig    = await window.BIAIFDbBridge.signRequest(SECRET, ts, nonce, op, args);
    const canon  = JSON.stringify(args);                       // '{"table":"wp_posts"}'
    const expect_ = nodeHmac(SECRET, ts, nonce, op, canon);
    expect(sig).toBe(expect_);
  });

  it('signs a multi-arg request with stable ordering', async () => {
    const ts = 1716000000, nonce = 'c'.repeat(16), op = 'sample';
    const args = { table: 'wp_options', limit: 3, strategy: 'mixed' };
    const sig    = await window.BIAIFDbBridge.signRequest(SECRET, ts, nonce, op, args);
    const expect_ = nodeHmac(SECRET, ts, nonce, op, JSON.stringify(args));
    expect(sig).toBe(expect_);
  });

  it('produces different signatures for different secrets', async () => {
    const ts = 1, nonce = 'd'.repeat(16);
    const a = await window.BIAIFDbBridge.signRequest('k1', ts, nonce, 'meta', {});
    const b = await window.BIAIFDbBridge.signRequest('k2', ts, nonce, 'meta', {});
    expect(a).not.toBe(b);
  });

  it('produces different signatures for different ops', async () => {
    const ts = 1, nonce = 'e'.repeat(16);
    const a = await window.BIAIFDbBridge.signRequest('k', ts, nonce, 'meta',   {});
    const b = await window.BIAIFDbBridge.signRequest('k', ts, nonce, 'tables', {});
    expect(a).not.toBe(b);
  });
});

describe('BIAIFDbBridge._canonArgs', () => {
  it('returns "[]" for empty args (matches PHP)', () => {
    expect(window.BIAIFDbBridge._canonArgs({})).toBe('[]');
    expect(window.BIAIFDbBridge._canonArgs(null)).toBe('[]');
    expect(window.BIAIFDbBridge._canonArgs(undefined)).toBe('[]');
  });
  it('returns JSON.stringify for non-empty args', () => {
    expect(window.BIAIFDbBridge._canonArgs({ a: 1 })).toBe('{"a":1}');
  });
});
