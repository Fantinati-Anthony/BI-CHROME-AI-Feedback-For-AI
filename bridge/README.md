# My-Feedbacks DB Bridge

Mini-endpoint companion à déposer à la racine d'un site qui possède une BDD.
L'extension Chrome My-Feedbacks l'appelle pour récupérer le schéma et un
échantillon de données afin de les fournir comme contexte à l'IA.

## Installation — 3 étapes

1. **Copie `myfb-bridge.php`** à la racine de ton site (ou n'importe où servi en HTTPS).
2. **Ouvre l'URL dans ton navigateur** → un wizard de configuration s'affiche :
   - Sélectionne le moteur (MySQL ou PostgreSQL — détecté automatiquement)
   - Renseigne hôte, port, base, utilisateur, mot de passe
   - Patterns expose / deny (defaults : `*` exposé, rien deny)
   - Clique 🔌 **Tester la connexion** puis ✓ **Générer le secret**
   - Le secret HMAC s'affiche **une seule fois** → garde la page ouverte
3. **Dans l'extension** : *Settings → Bases de données → + Ajouter*, mode
   *Bridge HTTP*, colle l'URL et le Secret. Clique 🔄 **Rafraîchir** : le
   schéma arrive automatiquement, prêt pour l'IA.

Le wizard écrit `myfb-bridge.config.php` à côté du script ; toute la config
y vit, le `.php` lui-même n'est plus à éditer. Updates = remplace juste le
`.php`, le config est intact.

## Sécuriser le fichier de config

Le fichier `myfb-bridge.config.php` contient credentials BDD + secret HMAC.
**Protège-le** au minimum :

**Apache** (`.htaccess` à côté du fichier) :
```apache
<Files "myfb-bridge.config.php">
  Require all denied
</Files>
```

**nginx** :
```nginx
location = /myfb-bridge.config.php { deny all; return 404; }
```

Ou idéalement, place-le **hors document root** et adapte la constante
`MYFB_CONFIG_FILE` en tête du `.php`.

## Rejouer le setup (rotation secret, changement BDD)

Supprime `myfb-bridge.config.php` à la main → la prochaine ouverture
relance le wizard. Mets à jour la fiche dans l'extension avec le nouveau
secret.

## Garanties de sécurité

| Risque | Mitigation |
|---|---|
| SQL injection | Aucun SQL libre côté client. Opérations whitelistées, identifiants validés par regex `^[A-Za-z0-9_\$-]{1,64}$` puis backticked. |
| Replay attack | Signature inclut `ts` + `nonce`. Requêtes > 60s rejetées, nonces gardés en fichier rotatif. |
| Timing attack sur HMAC | `hash_equals()` constant-time. |
| Exposition tables sensibles | `deny` prioritaire sur `expose` (glob `fnmatch`). |
| Données massives | Échantillons capés à 9 lignes, valeurs tronquées à 200 caractères. |
| Écriture en base | Endpoint **ne supporte que** `SHOW`, `DESCRIBE`, `SELECT`. User MySQL dédié sans `INSERT/UPDATE/DELETE`. |
| Secret en clair côté extension | Chiffré AES-GCM-256 avec clé non-extractable WebCrypto, stockée en IndexedDB du profil Chrome. |
| Lecture du fichier config par HTTP | À toi de poser `.htaccess` (cf. plus haut) — le fichier est en mode 0600 par défaut mais ne pas dépendre de ça. |

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
{ "ok": true,  "data": {...}, "version": "1.1.0" }
{ "ok": false, "error": "...", "version": "1.1.0" }
```

## Compatibilité

- PHP 7.4+
- PDO_MYSQL ou PDO_PGSQL
- Apache / nginx / LiteSpeed / Caddy — n'importe quel serveur exécutant PHP
