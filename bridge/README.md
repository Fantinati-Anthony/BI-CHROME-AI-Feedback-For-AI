# My-Feedbacks DB Bridge

Mini-endpoint companion à déposer à la racine d'un site qui possède une BDD.
L'extension Chrome My-Feedbacks l'appelle pour récupérer le schéma et un
échantillon de données afin de les fournir comme contexte à l'IA.

## Installation rapide

1. Copie `myfb-bridge.php` à la racine de ton site (ou n'importe où servi en HTTPS).
2. Génère un secret HMAC :
   ```bash
   openssl rand -hex 32
   ```
3. Édite le bloc CONFIGURATION en tête du fichier :
   - `MYFB_SECRET` : le secret généré ci-dessus
   - `MYFB_DB_DSN` / `MYFB_DB_USER` / `MYFB_DB_PASS` : connexion BDD
   - `MYFB_EXPOSE_PATTERNS` : glob des tables à exposer (`['wp_*']`, `['*']`, etc.)
   - `MYFB_DENY_TABLES` : tables à **jamais** exposer (mots de passe hashés, etc.)
4. Crée un utilisateur MySQL dédié, en read-only :
   ```sql
   CREATE USER 'myfb_readonly'@'%' IDENTIFIED BY 'long-random-pw';
   GRANT SELECT ON your_db.* TO 'myfb_readonly'@'%';
   FLUSH PRIVILEGES;
   ```
5. Dans l'extension : *Settings → Bases de données → Ajouter* → renseigne
   l'URL du bridge et colle le secret.

## Garanties de sécurité

| Risque | Mitigation |
|---|---|
| SQL injection | Aucun SQL libre côté client. Opérations whitelistées, identifiants validés par regex `^[A-Za-z0-9_\$-]{1,64}$` puis backticked. |
| Replay attack | Signature inclut `ts` + `nonce`. Requêtes > 60s rejetées, nonces gardés en fichier rotatif. |
| Timing attack sur HMAC | `hash_equals()` constant-time. |
| Exposition tables sensibles | `MYFB_DENY_TABLES` + `MYFB_EXPOSE_PATTERNS` (deny prioritaire). |
| Données massives | Échantillons capés à `MYFB_MAX_SAMPLE_ROWS` (défaut 9), valeurs tronquées à `MYFB_MAX_VALUE_LEN` (défaut 200). |
| Écriture en base | Endpoint **ne supporte que** `SHOW`, `DESCRIBE`, `SELECT`. User MySQL dédié sans `INSERT/UPDATE/DELETE`. |

## Opérations exposées

| `op` | `args` | Retour |
|---|---|---|
| `meta` | — | moteur, version, nb tables exposées, lignes totales, octets totaux |
| `tables` | — | liste `[{name, rows, bytes, engine}]` |
| `describe` | `{table}` | colonnes `[{name, type, null, key, default, extra, comment}]` |
| `sample` | `{table, limit?, strategy?}` | `{rows[], totalRows}` (strategy: `mixed` = 1/3 début + milieu + fin, ou `first`) |
| `count` | `{table}` | `{count}` |
| `schema_md` | — | `{markdown}` = doc complète prête à coller dans le contexte IA |

## Protocole

POST JSON :
```json
{
  "op":    "meta",
  "args":  {},
  "ts":    1716000000,
  "nonce": "<random 16-128 chars>",
  "sig":   "<hex HMAC-SHA256(secret, 'ts.nonce.op.canonArgsJSON')>"
}
```

Réponse :
```json
{ "ok": true,  "data": {...}, "version": "1.0.0" }
{ "ok": false, "error": "...", "version": "1.0.0" }
```

## Mise à jour

Le header `X-Myfb-Bridge-Version` est retourné à chaque appel. L'extension
compare avec sa version connue et affiche un toast si une mise à jour est
publiée. Les fichiers signés sont publiés sur les Releases GitHub.
