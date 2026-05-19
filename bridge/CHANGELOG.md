# Bridge changelog

Versioning is independent from the Chrome extension : the bridge can be
upgraded on the client's server without touching the extension, and vice-
versa. The extension's `MyFbDbBridge.MIN_BRIDGE_VERSION` constant tells
which bridge versions it can talk to.

Bumps follow [SemVer](https://semver.org/) :
- **MAJOR** : breaking protocol change (signature format, header rename, …)
- **MINOR** : new optional op or response field, backwards-compatible
- **PATCH** : security fix, bug fix, perf, doc

## [1.1.0] — 2026-05-19

### Added
- **Setup wizard intégré** (premier `GET /myfb-bridge.php`) — formulaire
  HTML qui détecte les drivers PDO disponibles, valide la connexion DB
  en live (bouton 🔌 « Tester la connexion »), génère le secret HMAC
  via `random_bytes(32)`, écrit `myfb-bridge.config.php` en chmod 0600
  et affiche le secret **une seule fois** avec boutons copy.
- **Config externalisée** : la version 1.0 hardcodait secret + DSN au
  début du `.php`. La 1.1 lit tout depuis le `.config.php` sibling →
  updates = remplacer le `.php`, le config est préservé.
- **Auto-lock** post-setup : le wizard refuse d'écraser un config
  existant. Pour rejouer le setup, supprimer manuellement le fichier
  config.

### Security
- Le config file est `chmod 0600` (rwx user only).
- README documente les règles `.htaccess` / nginx `deny all` pour
  protéger le fichier au niveau webserver.

### Breaking
- Aucune — l'API REST est inchangée (mêmes ops, même protocole HMAC).
  Les installs 1.0 continuent à fonctionner avec leurs constantes
  hardcodées tant qu'aucun `.config.php` n'existe à côté. Le wizard
  prend la priorité sinon.

## [1.0.0] — 2026-05-19 (PR #145)

### Added — initial release
- Endpoint POST signé HMAC-SHA256 avec `ts` + `nonce` (replay
  protection ±60s).
- 6 opérations whitelistées :
  - `meta` : driver, version, nb tables, lignes, octets totaux
  - `tables` : `[{name, rows, bytes, engine}]`
  - `describe(table)` : colonnes `[{name, type, null, key, default, ...}]`
  - `sample(table, limit?, strategy?)` : 1..9 lignes, stratégies `mixed`
    (1/3 début + milieu + fin) ou `first`
  - `count(table)` : `{count}`
  - `schema_md` : markdown complet prêt à coller dans un prompt IA
- Filtre tables par glob `expose` / blacklist `deny`.
- `hash_equals()` constant-time pour la vérification HMAC.
- Identifiants validés par regex `^[A-Za-z0-9_\$-]{1,64}$` puis
  backticked.
- PDO + prepared statements (no raw SQL execution from the client).
- CORS `*` (auth is HMAC-based, pas origin-based).
- Audit minimal `myfb-bridge.audit.log` : timestamp + op + result +
  IP, **sans payload ni SQL**.
- Nonces persistés dans un fichier rotatif `myfb-bridge.nonces`.
- Header `X-Myfb-Bridge-Version: 1.0.0` retourné à chaque appel.

### Requirements
- PHP 7.4+
- PDO_MYSQL ou PDO_PGSQL
- Apache / nginx / LiteSpeed / Caddy ou autre serveur exécutant PHP

---

## Compatibility matrix

| Bridge version | Compatible extension MIN_BRIDGE_VERSION |
|---:|---|
| 1.0.0 | extension < 2.4 (legacy path) |
| 1.1.0 | extension ≥ 2.4 |
| ≥ 1.1.0 | extension ≥ 2.4 (forward-compat) |

When the bridge is older than the extension's `MIN_BRIDGE_VERSION`, the
client throws `Bridge trop ancien (X.Y.Z < MIN) — mets à jour myfb-bridge.php`
so the user knows to upgrade.
