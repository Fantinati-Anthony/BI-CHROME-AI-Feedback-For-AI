# Bridge usage examples

Pratique pour debug, scripts d'admin, monitoring custom — appelle le
bridge sans passer par l'extension Chrome. Tous les exemples utilisent
`curl` et `openssl` pour signer.

## Setup

```bash
export BRIDGE_URL='https://example.com/myfb-bridge.php'
export BRIDGE_SECRET='your-64-char-hex-from-myfb-bridge.config.php'
```

## Helper de signature

```bash
sign_call() {
  local op="$1"
  local args_json="${2:-{}}"
  local ts=$(date +%s)
  local nonce=$(openssl rand -hex 16)

  # canonical args : PHP json_encode encode {} as [] for empty assoc
  local canon="$args_json"
  if [ "$args_json" = "{}" ]; then canon='[]'; fi

  local msg="${ts}.${nonce}.${op}.${canon}"
  local sig=$(echo -n "$msg" | openssl dgst -sha256 -hmac "$BRIDGE_SECRET" -r | cut -d' ' -f1)

  local body=$(printf '{"op":"%s","args":%s,"ts":%d,"nonce":"%s","sig":"%s"}' \
    "$op" "$args_json" "$ts" "$nonce" "$sig")

  curl -sS -X POST "$BRIDGE_URL" \
    -H 'Content-Type: application/json' \
    -d "$body"
}
```

## Examples

### Get bridge meta (driver, version, table count)

```bash
$ sign_call meta
{"ok":true,"data":{"driver":"mysql","version":"8.0.36","tableCount":12,"totalRows":4521,"totalBytes":2147483.5},"version":"1.1.0"}
```

### List exposed tables

```bash
$ sign_call tables | jq '.data.tables[] | "\(.name) \(.rows)"'
"wp_posts 152"
"wp_postmeta 832"
"shop_orders 421"
```

### Describe a table

```bash
$ sign_call describe '{"table":"wp_posts"}' | jq '.data.columns'
[
  { "name": "ID",         "type": "bigint(20) unsigned", "null": false, "key": "PRI", "extra": "auto_increment" },
  { "name": "post_title", "type": "text",                "null": false, "key": "" },
  …
]
```

### Sample rows (mixed strategy : début + milieu + fin)

```bash
$ sign_call sample '{"table":"wp_posts","limit":6,"strategy":"mixed"}' | jq '.data'
{
  "rows": [ … 6 rows … ],
  "totalRows": 152
}
```

### Count

```bash
$ sign_call count '{"table":"shop_orders"}' | jq '.data.count'
421
```

### Get the full schema as Markdown (for prompts IA)

```bash
$ sign_call schema_md | jq -r .data.markdown > prod-schema.md
$ wc -l prod-schema.md
312 prod-schema.md
```

## Error responses

```bash
# Bad signature
$ sign_call meta   # with wrong $BRIDGE_SECRET
{"ok":false,"error":"bad signature","version":"1.1.0"}

# Replay (same nonce twice within 60s)
{"ok":false,"error":"replay detected","version":"1.1.0"}

# Stale request (clock skew > 60s)
{"ok":false,"error":"stale request","version":"1.1.0"}

# Forbidden table
$ sign_call describe '{"table":"wp_users"}'
{"ok":false,"error":"table not exposed","version":"1.1.0"}

# Bad table name (regex fails)
$ sign_call describe '{"table":"a;DROP TABLE"}'
{"ok":false,"error":"bad table name","version":"1.1.0"}
```

## Docker (optional)

If you don't have PHP-FPM ready on your VPS, the smallest container
image that runs the bridge :

```dockerfile
FROM php:8.2-apache

RUN docker-php-ext-install pdo_mysql

COPY myfb-bridge.php /var/www/html/

# Protect the config file (sibling, written by the setup wizard on first run)
RUN printf '<Files "myfb-bridge.config.php">\n  Require all denied\n</Files>\n' \
    > /var/www/html/.htaccess && \
    a2enmod headers rewrite

EXPOSE 80
```

```bash
docker build -t myfb-bridge .
docker run -d -p 8080:80 -v $PWD/data:/var/www/html/data myfb-bridge
# open http://localhost:8080/myfb-bridge.php → setup wizard
```

## nginx fragment

If your stack is nginx + PHP-FPM, add this `location` block to protect
the config file *and* the audit log :

```nginx
location ~ /myfb-bridge\.(config\.php|audit\.log|nonces)$ {
  deny all;
  return 404;
}

location = /myfb-bridge.php {
  fastcgi_pass unix:/run/php/php8.2-fpm.sock;
  include fastcgi_params;
  fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
}
```

## Monitoring

A trivial uptime check that doesn't leak data :

```bash
# Bridge is "up" if a signed `meta` call succeeds
sign_call meta | jq -e '.ok == true' > /dev/null && echo OK || echo DOWN
```

For Prometheus / Datadog, parse `data.tableCount` and `data.totalRows`
and alert on sudden drops. Both fields are integers — friendly for
gauges.
