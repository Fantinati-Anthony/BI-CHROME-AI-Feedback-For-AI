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

describe('MyFbDbBridge.signRequest', () => {
  const SECRET = 'test-secret-do-not-use';

  it('signs an empty-args request identically to PHP', async () => {
    const ts = 1716000000, nonce = 'a'.repeat(16), op = 'meta', args = {};
    const sig    = await window.MyFbDbBridge.signRequest(SECRET, ts, nonce, op, args);
    const expect_ = nodeHmac(SECRET, ts, nonce, op, '[]'); // PHP encodes empty assoc as []
    expect(sig).toBe(expect_);
  });

  it('signs a single-arg request identically to PHP', async () => {
    const ts = 1716000000, nonce = 'b'.repeat(16), op = 'describe', args = { table: 'wp_posts' };
    const sig    = await window.MyFbDbBridge.signRequest(SECRET, ts, nonce, op, args);
    const canon  = JSON.stringify(args);                       // '{"table":"wp_posts"}'
    const expect_ = nodeHmac(SECRET, ts, nonce, op, canon);
    expect(sig).toBe(expect_);
  });

  it('signs a multi-arg request with stable ordering', async () => {
    const ts = 1716000000, nonce = 'c'.repeat(16), op = 'sample';
    const args = { table: 'wp_options', limit: 3, strategy: 'mixed' };
    const sig    = await window.MyFbDbBridge.signRequest(SECRET, ts, nonce, op, args);
    const expect_ = nodeHmac(SECRET, ts, nonce, op, JSON.stringify(args));
    expect(sig).toBe(expect_);
  });

  it('produces different signatures for different secrets', async () => {
    const ts = 1, nonce = 'd'.repeat(16);
    const a = await window.MyFbDbBridge.signRequest('k1', ts, nonce, 'meta', {});
    const b = await window.MyFbDbBridge.signRequest('k2', ts, nonce, 'meta', {});
    expect(a).not.toBe(b);
  });

  it('produces different signatures for different ops', async () => {
    const ts = 1, nonce = 'e'.repeat(16);
    const a = await window.MyFbDbBridge.signRequest('k', ts, nonce, 'meta',   {});
    const b = await window.MyFbDbBridge.signRequest('k', ts, nonce, 'tables', {});
    expect(a).not.toBe(b);
  });
});

describe('MyFbDbBridge._canonArgs', () => {
  it('returns "[]" for empty args (matches PHP)', () => {
    expect(window.MyFbDbBridge._canonArgs({})).toBe('[]');
    expect(window.MyFbDbBridge._canonArgs(null)).toBe('[]');
    expect(window.MyFbDbBridge._canonArgs(undefined)).toBe('[]');
  });
  it('returns JSON.stringify for non-empty args', () => {
    expect(window.MyFbDbBridge._canonArgs({ a: 1 })).toBe('{"a":1}');
  });
});

describe('MyFbDbBridge._cmpVer', () => {
  const cmp = (a, b) => window.MyFbDbBridge._cmpVer(a, b);
  it('returns 0 for equal versions', () => {
    expect(cmp('1.0.0', '1.0.0')).toBe(0);
    expect(cmp('1.1.0', '1.1.0')).toBe(0);
  });
  it('returns -1 when first is older', () => {
    expect(cmp('1.0.0', '1.1.0')).toBe(-1);
    expect(cmp('1.0.9', '1.1.0')).toBe(-1);
    expect(cmp('1.1.0', '2.0.0')).toBe(-1);
  });
  it('returns 1 when first is newer', () => {
    expect(cmp('1.2.0', '1.1.0')).toBe(1);
    expect(cmp('2.0.0', '1.9.9')).toBe(1);
  });
  it('handles missing minor/patch as 0', () => {
    expect(cmp('1', '1.0.0')).toBe(0);
    expect(cmp('1.0', '1.0.0')).toBe(0);
    expect(cmp('2', '1.9')).toBe(1);
  });
  it('treats undefined/null as 0.0.0', () => {
    expect(cmp(undefined, '0.0.0')).toBe(0);
    expect(cmp(null,      '1.0.0')).toBe(-1);
  });
});

describe('MyFbDbBridge._humanizeError', () => {
  const h = (s, r) => window.MyFbDbBridge._humanizeError(s, r);
  it('status 0 → network-level message', () => {
    expect(h(0, 'NetworkError')).toMatch(/inaccessible/);
  });
  it('status 404 → endpoint introuvable', () => {
    expect(h(404, 'not found')).toMatch(/introuvable/);
  });
  it('401 with "replay" → nonce déjà utilisé', () => {
    expect(h(401, 'replay detected')).toMatch(/déjà utilisé/);
  });
  it('401 with "stale" → horloge décalée', () => {
    expect(h(401, 'stale request')).toMatch(/décalée/);
  });
  it('401 with "nonce" → nonce invalide', () => {
    expect(h(401, 'bad nonce')).toMatch(/Nonce invalide/);
  });
  it('401 generic → signature HMAC invalide', () => {
    expect(h(401, 'bad signature')).toMatch(/Signature/);
  });
  it('403 → table non exposée', () => {
    expect(h(403, 'table not exposed')).toMatch(/non exposée/);
  });
  it('5xx → erreur interne', () => {
    expect(h(500, 'internal: SQL boom')).toMatch(/interne/);
    expect(h(503, 'down')).toMatch(/interne/);
  });
  it('unknown status → falls back to raw', () => {
    expect(h(418, 'i am a teapot')).toBe('i am a teapot');
  });
});

describe('MyFbDbBridge.MIN_BRIDGE_VERSION', () => {
  it('is a semver string', () => {
    expect(typeof window.MyFbDbBridge.MIN_BRIDGE_VERSION).toBe('string');
    expect(window.MyFbDbBridge.MIN_BRIDGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
