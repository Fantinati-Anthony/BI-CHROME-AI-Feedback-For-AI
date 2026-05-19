# Security model — `myfb-bridge.php`

This document describes the threat model, mitigations, and known
limitations of the My-Feedbacks DB bridge. It complements `README.md`
which explains *how to use* the bridge — this one explains *why it's
safe to deploy on a public-facing webserver*.

## Threat model

The bridge is a single PHP file accessible over HTTP/HTTPS that
returns DB metadata (schemas + sample rows). The asset to protect is :

1. **The database credentials** stored in `myfb-bridge.config.php`
2. **The HMAC secret** that authenticates the extension
3. **The actual DB rows** returned by `sample` and `schema_md` ops
4. **The DB itself** — no write, drop, or non-whitelisted read

Adversaries assumed :

- **Unauthenticated attacker on the public internet** — knows the URL
- **Authenticated attacker** with a stolen HMAC secret
- **Network observer** (passive MITM, ISP, corporate proxy)
- **Compromised browser extension** running alongside My-Feedbacks
- **Malicious local script** injected into the extension

Out of scope :

- Full server compromise (root access on the PHP host)
- Physical access to the Chrome profile directory
- DB-level vulnerabilities (SQL engine bugs, info_schema leaks)

## Mitigations by attacker type

### Unauthenticated attacker

| Attack | Mitigation |
|---|---|
| GET probe to discover the endpoint | Returns a one-line plaintext info page on configured bridge ; setup wizard on unconfigured. No data leak. |
| POST without signature | `401 bad signature` — `hash_equals()` constant-time compare. |
| POST with replay of a captured request | `ts` window (±60s) + nonce file rejects every duplicate. |
| Timing attack on HMAC | `hash_equals()` is constant-time per PHP design. |
| DoS via large payload | Body capped at 32 KB ; longer requests rejected with `400 empty body`. |
| Brute force secret | 32-byte `random_bytes()` secret = 2²⁵⁶ space. Computationally infeasible. |
| SQL injection via op args | No free-form SQL accepted. Identifiers validated `^[A-Za-z0-9_\$-]{1,64}$` then backticked. PDO prepared statements with `:o`/`:n` binds for LIMIT. |
| Path traversal | Only sibling files (`.config.php`, `.nonces`, `.audit.log`) are touched ; paths are hard-coded constants. |
| Read of `myfb-bridge.config.php` via HTTP | **You** must protect it (`.htaccess` deny, nginx `deny all`, or place outside docroot). README documents this clearly. File is `chmod 0600` after writing. |

### Authenticated attacker (stolen HMAC)

If a secret leaks, the attacker can call the API but is still
constrained :

| Attack | Mitigation |
|---|---|
| Run arbitrary SQL | **Impossible** — the dispatch switch has 6 cases only. |
| Read every table | `expose_patterns` glob filter + `deny_tables` blacklist. Use a DB user with `GRANT SELECT ON specific_db.specific_table TO myfb_readonly`. |
| Dump entire table | `sample` caps to 9 rows ; `count` returns only an integer. To exfil more an attacker needs to write a custom client AND has to run thousands of requests (each rate-limit-friendly). |
| Modify data | DB user should have `SELECT` only — no `INSERT/UPDATE/DELETE/DROP`. |
| Discover other endpoints on the host | None — single file, isolated. |

**Rotation in case of leak** : delete `myfb-bridge.config.php`, re-run
the setup wizard, paste the new secret into the extension. Existing
sessions with the old secret start failing immediately (nonces use the
**current** secret in HMAC computation, no grace period).

### Network observer

| Asset | Protection |
|---|---|
| Body in transit | TLS via HTTPS (you must serve the bridge over HTTPS — HTTP is supported only for local dev). |
| HMAC signature | Even unencrypted, the secret cannot be recovered from HMAC outputs alone (computational infeasibility). |
| Database rows | TLS. |

### Compromised browser extension running alongside My-Feedbacks

| Attack | Mitigation |
|---|---|
| Read the secret from `chrome.storage.local` | Secret is AES-GCM-encrypted with a non-extractable WebCrypto key stored in IndexedDB of the My-Feedbacks extension. Other extensions cannot access either store. |
| Sniff the `MSG.DB_BRIDGE_CALL` payload | `chrome.runtime.onMessage` checks `sender.id === chrome.runtime.id` before dispatching — rejects messages from other extensions. |

### Malicious script injected into My-Feedbacks (worst case)

| Asset | Result |
|---|---|
| Read encrypted secret blob | Yes (chrome.storage.local is readable by any script in the extension). |
| Extract the AES key via `exportKey()` | **No** — the key is created with `extractable: false`. The script can call `decrypt()` but cannot exfiltrate the key material for offline use. |
| Decrypt the secret in-place and exfiltrate | Yes — this is the residual risk of an injected-script scenario. We raise the bar (no key extraction, IndexedDB isolation) but cannot prevent in-process abuse. |

## Audit trail

By default, every request appends a single line to
`myfb-bridge.audit.log` :

```
2026-05-19T01:23:45+00:00 op=schema_md result=ok ip=1.2.3.4
```

No payload, no SQL, no DB content. Sufficient for billing and abuse
detection ; unhelpful to an attacker who steals the file.

Disable by setting `MYFB_AUDIT_FILE = null` at the top of the script.

## What we explicitly do NOT do

- We do not log request bodies.
- We do not store DB content beyond the lifetime of one HTTP response.
- We do not phone home — the bridge is purely a passive endpoint.
- We do not include any analytics or telemetry SDK.
- We do not accept SQL from the client.
- We do not return DDL or DML capabilities through the API.

## Reporting

If you find a vulnerability, please report it via a GitHub issue on
the My-Feedbacks repo or directly to the maintainer. **Do not** post
exploits publicly until a patch is shipped.
