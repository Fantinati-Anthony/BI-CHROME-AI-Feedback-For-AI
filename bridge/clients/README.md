# Bridge clients

Three minimal SDKs for the My-Feedbacks DB Bridge. Each one is a **single
file with zero dependencies** (standard library only), targets a different
ecosystem, and mirrors the JS reference client in `sidepanel/db-bridge-client.js`.

Use them when you want to call the bridge **outside the Chrome
extension** : CI checks, monitoring probes, ETL pipelines, internal
ops scripts, …

## What's here

| File | Language | Use case |
|---|---|---|
| `myfb_bridge.py` | Python 3.10+ | CI pipelines (GitHub Actions, GitLab CI), CLI ad-hoc, pytest integration tests |
| `myfb_bridge.go` | Go 1.21+   | k8s sidecars, init-containers, single-binary CLIs, ops daemons |
| (reference) `../../sidepanel/db-bridge-client.js` | JS / WebCrypto | The actual client that ships in the Chrome extension |

A Bash / curl recipe lives in [`../EXAMPLES.md`](../EXAMPLES.md) if you
just need one-shot calls without writing code.

## Contract — all clients implement the same surface

```
new(url, secret)                       # constructor
meta()                                 # → {driver, version, tableCount, totalRows, totalBytes}
tables()                               # → [{name, rows, bytes, engine}]
describe(table)                        # → [{name, type, null, key, default, extra, comment}]
sample(table, limit?, strategy?)       # → {rows, totalRows}
count(table)                           # → int
schema_md()                            # → str  (markdown ready to feed the AI)
```

Errors carry a humanised French message (same set across all
implementations) :

- *Bridge inaccessible (réseau / DNS / CORS)*
- *Endpoint introuvable — vérifie l'URL du bridge*
- *Nonce déjà utilisé — horloge décalée ?*
- *Horloge client/serveur décalée (> 60s)*
- *Signature HMAC invalide — secret incorrect ?*
- *Table non exposée par la config du bridge*
- *Méthode HTTP refusée — bridge mal configuré*
- *Erreur interne du bridge — vérifie audit.log*
- *Bridge trop ancien (X.Y.Z < {MIN}) — mets à jour myfb-bridge.php*

`MIN_BRIDGE_VERSION` is the same constant in every client (currently
`1.1.0`).

## Why no `requests` / `axios` / `resty` ?

These clients are meant to drop into existing scripts **without touching
the dependency tree**. A monitoring probe written in plain Go that links
in resty needs to vendor it ; same for a CI step that runs Python — many
runners don't have `requests` pre-installed and `pip install` adds 5
seconds to every job. Sticking to `urllib` / `net/http` keeps the
binaries and the cold-start cost minimal.

For the JS client, sidepanel pages run under a strict CSP that forbids
`fetch()` to arbitrary HTTPS hosts — we route through the background
service worker instead. The clients in this folder do not have that
constraint, so they speak HTTPS directly.

## Adding another language

Same contract :

1. `canonArgs(args)` : `json_encode($args, JSON_UNESCAPED_SLASHES |
   JSON_UNESCAPED_UNICODE)`. **Empty assoc → `[]`** (PHP quirk).
2. `sign(secret, ts, nonce, op, args)` : `HMAC-SHA256(secret,
   "{ts}.{nonce}.{op}.{canonArgs}")`, hex-encoded.
3. `POST` JSON `{op, args, ts, nonce, sig}` with
   `Content-Type: application/json`.
4. Parse response, version-check vs `MIN_BRIDGE_VERSION`, humanise
   error.

Verify your implementation against the canonical test vector :

```
secret = "test-secret-do-not-use"
ts     = 1716000000
nonce  = "a".repeat(16)
op     = "meta"
args   = {}                                  # encodes as "[]"

expected sig = 655dd858fe4375fbe5ee18531214b75b1bfb825727792002f60c36280bd37118
```

Every existing client agrees on this hash — if yours doesn't, you've
diverged from the protocol.
