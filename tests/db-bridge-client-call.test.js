/**
 * Integration tests for MyFbDbBridge.call() — the full path from
 * `call(profile, op, args)` → HMAC sign → chrome.runtime.sendMessage
 * → mocked SW response → parsed body.
 *
 * The signing math itself is cross-verified against PHP in
 * tests/db-bridge-client.test.js. This file focuses on the message-
 * passing + error mapping layer that wasn't covered there.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import crypto from 'node:crypto';

beforeAll(() => {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    globalThis.crypto = crypto.webcrypto;
  }
  loadAddonScript('sidepanel/db-bridge-client.js');
});

const PROFILE = { bridgeUrl: 'https://example.com/myfb-bridge.php', bridgeSecret: 'test-secret' };

let _lastMessage = null;
let _stubResponse = null;
beforeEach(() => {
  _lastMessage = null;
  _stubResponse = null;
  globalThis.chrome = globalThis.chrome || {};
  globalThis.chrome.runtime = {
    id: 'test-extension',
    sendMessage: (msg, cb) => {
      _lastMessage = msg;
      // Defer the callback so the test sees the await flow correctly.
      Promise.resolve().then(() => cb(_stubResponse));
    },
  };
});

describe('MyFbDbBridge.call — integration via mocked chrome.runtime', () => {
  it('sends a signed body to the SW with the expected envelope shape', async () => {
    _stubResponse = { status: 200, ok: true, body: { ok: true, data: { tableCount: 3 }, version: '1.1.0' } };
    const data = await window.MyFbDbBridge.call(PROFILE, 'meta');
    expect(data).toEqual({ tableCount: 3 });
    expect(_lastMessage.type).toBe('myfb:db-bridge-call');
    expect(_lastMessage.url).toBe(PROFILE.bridgeUrl);
    expect(_lastMessage.body.op).toBe('meta');
    expect(_lastMessage.body.args).toEqual({});
    expect(typeof _lastMessage.body.ts).toBe('number');
    expect(_lastMessage.body.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(_lastMessage.body.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws clear error when the SW returns null (no listener)', async () => {
    _stubResponse = null;
    await expect(window.MyFbDbBridge.call(PROFILE, 'meta'))
      .rejects.toThrow(/inaccessible|no response/i);
  });

  it('throws clear error when the SW returns { error }', async () => {
    _stubResponse = { error: 'NetworkError' };
    await expect(window.MyFbDbBridge.call(PROFILE, 'meta'))
      .rejects.toThrow(/inaccessible|NetworkError/i);
  });

  // The next three specs assume PR #157's humanizeError + version-check
  // features. They activate the moment #157 lands on main — until then
  // skipped to keep this PR mergeable on its own.
  it.skip('throws when body is missing/malformed (requires #157 humanizeError)', async () => {
    _stubResponse = { status: 502, ok: false, body: null, raw: '<html>502</html>' };
    await expect(window.MyFbDbBridge.call(PROFILE, 'meta'))
      .rejects.toThrow(/interne|malformed|502/i);
  });

  it.skip('throws when the bridge replies with ok: false (humanized) (requires #157)', async () => {
    _stubResponse = { status: 401, ok: false, body: { ok: false, error: 'bad signature', version: '1.1.0' } };
    await expect(window.MyFbDbBridge.call(PROFILE, 'meta'))
      .rejects.toThrow(/Signature HMAC invalide/);
  });

  it.skip('throws when bridge version is older than MIN_BRIDGE_VERSION (requires #157)', async () => {
    _stubResponse = { status: 200, ok: true, body: { ok: true, data: {}, version: '1.0.0' } };
    await expect(window.MyFbDbBridge.call(PROFILE, 'meta'))
      .rejects.toThrow(/trop ancien.*1\.0\.0/);
  });

  it('accepts a bridge response with any version field (forward-compat current behaviour)', async () => {
    _stubResponse = { status: 200, ok: true, body: { ok: true, data: {}, version: '2.99.0' } };
    await expect(window.MyFbDbBridge.call(PROFILE, 'meta')).resolves.toEqual({});
  });

  it('refuses to send when profile lacks URL or secret', async () => {
    await expect(window.MyFbDbBridge.call({}, 'meta')).rejects.toThrow(/non configuré/);
    await expect(window.MyFbDbBridge.call({ bridgeUrl: 'x' }, 'meta')).rejects.toThrow(/non configuré/);
    await expect(window.MyFbDbBridge.call({ bridgeSecret: 'x' }, 'meta')).rejects.toThrow(/non configuré/);
  });

  it('serialises args correctly into the signed body', async () => {
    _stubResponse = { status: 200, ok: true, body: { ok: true, data: { count: 9 }, version: '1.1.0' } };
    await window.MyFbDbBridge.call(PROFILE, 'count', { table: 'wp_posts' });
    expect(_lastMessage.body.args).toEqual({ table: 'wp_posts' });
    // Sig MUST cover the args — change them and the sig must change too.
    const sigWithArgs = _lastMessage.body.sig;
    await window.MyFbDbBridge.call(PROFILE, 'count', { table: 'wp_other' });
    expect(_lastMessage.body.sig).not.toBe(sigWithArgs);
  });

  it('fetchSchemaMd returns the markdown field from data', async () => {
    _stubResponse = { status: 200, ok: true, body: { ok: true, data: { markdown: '# schema\nfoo' }, version: '1.1.0' } };
    const md = await window.MyFbDbBridge.fetchSchemaMd(PROFILE);
    expect(md).toBe('# schema\nfoo');
    expect(_lastMessage.body.op).toBe('schema_md');
  });

  it('fetchSchemaMd returns empty string when bridge omits markdown field', async () => {
    _stubResponse = { status: 200, ok: true, body: { ok: true, data: {}, version: '1.1.0' } };
    const md = await window.MyFbDbBridge.fetchSchemaMd(PROFILE);
    expect(md).toBe('');
  });
});
