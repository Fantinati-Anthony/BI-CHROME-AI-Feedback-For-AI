/**
 * My-Feedbacks DB Bridge — Node.js client (ESM, zero deps).
 *
 * Mirror of the JS extension client (sidepanel/db-bridge-client.js), the
 * Python client (myfb_bridge.py) and the Go client (myfb_bridge.go).
 * Same HMAC math, same canonical-args quirk (PHP compat — empty args
 * serialize to "[]"), same humanized errors.
 *
 * Node 18+ (native fetch + node:crypto.webcrypto). Also works in Deno
 * and Bun as-is. NO dependencies.
 *
 * Usage:
 *
 *   import { BridgeClient } from './myfb-bridge.mjs';
 *
 *   const bridge = new BridgeClient({
 *     url:    'https://example.com/myfb-bridge.php',
 *     secret: process.env.BRIDGE_SECRET,
 *   });
 *
 *   const { tableCount } = await bridge.meta();
 *   const tables         = await bridge.tables();
 *   const md             = await bridge.schemaMd();
 *
 * Errors throw `Error` with humanized French message. Catch and log.
 */

import { createHmac, randomBytes } from 'node:crypto';

export const MIN_BRIDGE_VERSION = '1.1.0';

// ── Signing ────────────────────────────────────────────────────────────

/** Match PHP's json_encode($args, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE). */
function canonArgs(args) {
  if (!args || (typeof args === 'object' && Object.keys(args).length === 0)) {
    return '[]';   // PHP encodes empty assoc as []
  }
  return JSON.stringify(args);
}

function signRequest(secret, ts, nonce, op, args) {
  const msg = `${ts}.${nonce}.${op}.${canonArgs(args)}`;
  return createHmac('sha256', secret).update(msg).digest('hex');
}

function randomNonce() {
  return randomBytes(16).toString('hex');
}

// ── Errors ─────────────────────────────────────────────────────────────

function humanize(status, raw) {
  raw = String(raw || '').toLowerCase();
  if (status === 0)   return 'Bridge inaccessible (réseau / DNS / CORS)';
  if (status === 404) return "Endpoint introuvable — vérifie l'URL du bridge";
  if (status === 401) {
    if (raw.includes('replay')) return 'Nonce déjà utilisé — horloge décalée ?';
    if (raw.includes('stale'))  return 'Horloge client/serveur décalée (> 60s)';
    if (raw.includes('nonce'))  return 'Nonce invalide';
    return 'Signature HMAC invalide — secret incorrect ?';
  }
  if (status === 403) return 'Table non exposée par la config du bridge';
  if (status === 405) return 'Méthode HTTP refusée — bridge mal configuré';
  if (status >= 500)  return 'Erreur interne du bridge — vérifie audit.log';
  return raw || `Erreur HTTP ${status}`;
}

function cmpVer(a, b) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0, vb = pb[i] || 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

// ── Client ─────────────────────────────────────────────────────────────

export class BridgeClient {
  constructor({ url, secret, timeoutMs = 10_000 }) {
    if (!url || !secret) throw new Error('Bridge non configuré (URL et secret requis)');
    this.url       = url;
    this.secret    = secret;
    this.timeoutMs = timeoutMs;
  }

  async call(op, args = {}) {
    const ts    = Math.floor(Date.now() / 1000);
    const nonce = randomNonce();
    const body  = { op, args, ts, nonce, sig: signRequest(this.secret, ts, nonce, op, args) };

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let resp;
    try {
      resp = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      throw new Error(humanize(0, e?.message || String(e)));
    }
    clearTimeout(timer);

    const text = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* malformed */ }
    if (!parsed) throw new Error(humanize(resp.status, 'malformed response'));

    if (parsed.version && cmpVer(parsed.version, MIN_BRIDGE_VERSION) < 0) {
      throw new Error(
        `Bridge trop ancien (${parsed.version} < ${MIN_BRIDGE_VERSION}) — ` +
        `mets à jour myfb-bridge.php`,
      );
    }
    if (!parsed.ok) throw new Error(humanize(resp.status, parsed.error));
    return parsed.data ?? {};
  }

  meta()                     { return this.call('meta'); }
  tables()                   { return this.call('tables').then((d) => d.tables || []); }
  describe(table)            { return this.call('describe', { table }).then((d) => d.columns || []); }
  sample(table, opts = {})   {
    return this.call('sample', { table, limit: opts.limit ?? 3, strategy: opts.strategy || 'mixed' });
  }
  count(table)               { return this.call('count', { table }).then((d) => d.count | 0); }
  schemaMd()                 { return this.call('schema_md').then((d) => d.markdown || ''); }
}

// Helpers exported for tests / custom usage. Mirror the JS sidepanel API.
export const _internal = { signRequest, canonArgs, humanize, cmpVer, randomNonce };
