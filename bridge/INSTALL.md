# My-Feedbacks DB Bridge — install in 3 minutes

Happy-path install guide. Pour le détail des opérations, voir
[`README.md`](README.md). Pour les recettes dev (curl, Docker,
nginx, Caddy), voir [`EXAMPLES.md`](EXAMPLES.md).

## What you need

- A web server running PHP 7.4+ with `pdo_mysql` (or `pdo_pgsql`)
- A database you control
- 3 minutes

## Step 1 — Drop the file

```bash
# Upload to the root of your site (via SFTP, cPanel, scp, whatever)
scp bridge/myfb-bridge.php user@server:/var/www/your-site/
# Optionally also drop the .htaccess template
scp bridge/.htaccess user@server:/var/www/your-site/
```

If you're using Docker instead :

```bash
cd bridge/
docker compose up -d
# Bridge now responds at http://localhost:8080/myfb-bridge.php
```

## Step 2 — Run the setup wizard

Open the bridge URL in your browser :

```
https://your-site.com/myfb-bridge.php
```

You'll see a setup form :

1. **Moteur** — auto-detected (MySQL or PostgreSQL)
2. **Hôte / Port / Base / Utilisateur / Mot de passe** — fill with
   your DB credentials. **Use a dedicated read-only user** :
   ```sql
   CREATE USER 'myfb_readonly'@'%' IDENTIFIED BY 'long-random-pw';
   GRANT SELECT ON your_database.* TO 'myfb_readonly'@'%';
   FLUSH PRIVILEGES;
   ```
3. **Tables à exposer** — glob patterns. Defaults to `*` (everything).
   Restrict to `wp_*` if you only want WordPress tables, etc.
4. **Tables interdites** — names that are NEVER exposed even if they
   match the expose glob. Always add sensitive tables here :
   `wp_users`, `wp_usermeta`, `wp_options`, `password_reset_tokens`, …
5. Click **🔌 Tester la connexion** → should show
   `✓ Connexion OK — N table(s) visible(s)`
6. Click **✓ Générer le secret et écrire le config**

A success page now shows :
- The **bridge URL** (auto-detected)
- The **HMAC secret** — copy it now, this is the only time it's shown

## Step 3 — Configure the extension

In My-Feedbacks side panel :

1. Open **Settings → Bases de données**
2. Click **+ Ajouter une BDD**
3. Fill :
   - **Libellé** : `WP prod` (or whatever)
   - **Mode** : `Bridge HTTP`
   - **URL du bridge** : the URL from the success page
   - **Secret HMAC** : the secret from the success page
4. (Optional) Tick **Auto-injecter au démarrage d'un segment** if
   you want the schema in every new feedback context.
5. Click **🔌 Tester** → green "Connexion OK".
6. **Enregistrer**.

Done. Click **🔄 Rafraîchir** on the new profile card to fetch the
schema. The AI now has DB context.

## Step 4 — Lock down the config file (production only)

Apache : nothing to do if you dropped the bundled `.htaccess`.

nginx : add to your server block (see `bridge/nginx.conf.example`) :

```nginx
location ~ /myfb-bridge\.(config\.php|audit\.log|nonces)$ {
  deny all;
  return 404;
}
```

Caddy : see `bridge/Caddyfile.example`.

That's it. The config file already has chmod 0600 but a webserver
rule is belt-and-suspenders.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Setup wizard never shows | Already configured | Delete `myfb-bridge.config.php` to re-run setup |
| `✗ Bridge inaccessible` | URL wrong, or HTTPS required | Check URL ; serve over HTTPS |
| `✗ Signature HMAC invalide` | Secret mismatch | Re-copy the secret from the success page ; if lost, delete config and re-setup |
| `✗ Horloge décalée` | Client/server clock skew > 60s | Sync server time via NTP |
| `✗ Table non exposée` | Table not in `expose` patterns | Edit `myfb-bridge.config.php`, add the table to `'expose'` |
| Bridge upgraded → `Bridge trop ancien` | Extension's `MIN_BRIDGE_VERSION` increased | Update `myfb-bridge.php` from latest release |

## See also

- [`README.md`](README.md) — full reference
- [`SECURITY.md`](SECURITY.md) — threat model
- [`EXAMPLES.md`](EXAMPLES.md) — curl / Docker / nginx / monitoring
- [`CHANGELOG.md`](CHANGELOG.md) — bridge version history
