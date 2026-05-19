<?php
/**
 * My-Feedbacks DB Bridge — single-file companion endpoint with setup wizard
 *
 *   1. Drop this file at the root of your site (or anywhere served over HTTPS).
 *   2. Visit it once in a browser → setup wizard generates the secret,
 *      tests the DB connection, writes `myfb-bridge.config.php` next to it.
 *   3. Paste the displayed secret into the My-Feedbacks extension. Done.
 *
 * Subsequent visits run in API mode and authenticate every call with
 * HMAC-SHA256 signed by the extension. The wizard auto-locks after first
 * successful save (delete the config file to re-run setup).
 *
 * Security : opérations whitelistées (meta, tables, describe, sample, count,
 * schema_md), aucun SQL libre, identifiants validés + backticked, PDO +
 * prepared statements, table allow/deny patterns, replay protection,
 * constant-time HMAC, audit minimal sans payload.
 *
 * Requirements: PHP 7.4+, PDO_MYSQL or PDO_PGSQL.
 *
 * SPDX-License-Identifier: MIT
 */

declare(strict_types=1);

const MYFB_BRIDGE_VERSION = '1.1.0';
const MYFB_CONFIG_FILE    = __DIR__ . '/myfb-bridge.config.php';
const MYFB_AUDIT_FILE     = __DIR__ . '/myfb-bridge.audit.log';
const MYFB_NONCE_FILE     = __DIR__ . '/myfb-bridge.nonces';
const MYFB_MAX_REQ_AGE    = 60;
const MYFB_MAX_SAMPLE_ROWS = 9;
const MYFB_MAX_VALUE_LEN  = 200;

// ============================================================================
//  Entry point
// ============================================================================

$config = load_config();
if ($config === null) {
    handle_setup();
    exit;
}

handle_api($config);
exit;

// ============================================================================
//  Config loader
// ============================================================================

/** Returns the config array, or null if setup is not complete. */
function load_config(): ?array {
    if (!is_file(MYFB_CONFIG_FILE)) return null;
    $cfg = @include MYFB_CONFIG_FILE;
    if (!is_array($cfg) || empty($cfg['setup_complete']) || empty($cfg['secret'])) return null;
    // Defaults
    $cfg += [
        'dsn'    => 'mysql:host=127.0.0.1;port=3306;dbname=;charset=utf8mb4',
        'user'   => '',
        'pass'   => '',
        'expose' => ['*'],
        'deny'   => [],
    ];
    return $cfg;
}

// ============================================================================
//  Setup wizard
// ============================================================================

function handle_setup(): void {
    header('Content-Type: text/html; charset=utf-8');
    header('X-Myfb-Bridge-Version: ' . MYFB_BRIDGE_VERSION);
    header('X-Robots-Tag: noindex, nofollow');

    $method = $_SERVER['REQUEST_METHOD'];
    $action = $_REQUEST['action'] ?? '';

    if ($method === 'POST' && $action === 'test')  { setup_test_connection();  return; }
    if ($method === 'POST' && $action === 'save')  { setup_save_config();      return; }
    setup_render_form();
}

function setup_render_form(): void {
    $drivers = PDO::getAvailableDrivers();
    $defaultEngine = in_array('mysql', $drivers, true) ? 'mysql'
        : (in_array('pgsql', $drivers, true) ? 'pgsql' : ($drivers[0] ?? ''));
    $autoHost = '127.0.0.1';
    $autoPort = $defaultEngine === 'pgsql' ? 5432 : 3306;
    $bridgeUrl = (isset($_SERVER['HTTPS']) ? 'https' : 'http') . '://'
        . ($_SERVER['HTTP_HOST'] ?? 'localhost') . ($_SERVER['REQUEST_URI'] ?? '');
    $bridgeUrl = strtok($bridgeUrl, '?');
    ?><!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>My-Feedbacks Bridge — Setup</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { --ink:#0f172a; --muted:#64748b; --accent:#0ea5b7; --danger:#dc2626; --ok:#16a34a; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color: var(--ink); background:#f8fafc; margin:0; padding:24px; }
  .card { max-width: 640px; margin: 0 auto; background:#fff; border:1px solid #e2e8f0; border-radius:12px; box-shadow: 0 4px 12px rgba(0,0,0,.04); padding:24px; }
  h1 { margin: 0 0 6px; font-size: 22px; }
  .lead { color: var(--muted); margin: 0 0 18px; }
  .step { display: inline-block; padding: 2px 10px; background: var(--accent); color:#fff; border-radius: 12px; font-size: 11px; font-weight:600; margin-bottom: 10px; }
  fieldset { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px 4px; margin: 0 0 14px; }
  legend { padding: 0 6px; font-weight: 600; color: var(--accent); }
  label { display: block; margin-bottom: 12px; }
  label > span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; font-weight: 600; }
  input, select, textarea { width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; }
  input:focus, select:focus, textarea:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(14,165,183,.18); }
  .row { display: grid; grid-template-columns: 1fr 110px; gap: 10px; }
  .actions { display:flex; gap:10px; margin-top: 14px; }
  button { background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 9px 16px; font: 600 13px inherit; cursor: pointer; }
  button.ghost { background: #fff; color: var(--ink); border: 1px solid #cbd5e1; }
  button:hover { filter: brightness(1.08); }
  .status { padding: 10px 12px; border-radius: 6px; font-size: 13px; margin-top: 10px; display: none; }
  .status.ok { background: #ecfdf5; color: var(--ok); border: 1px solid #a7f3d0; }
  .status.err { background: #fef2f2; color: var(--danger); border: 1px solid #fecaca; }
  details { margin-top: 14px; }
  details summary { cursor: pointer; color: var(--muted); font-size: 12px; }
  .hint { font-size: 11px; color: var(--muted); margin-top: -8px; margin-bottom: 12px; line-height: 1.5; }
  code { font-family: ui-monospace,Consolas,monospace; font-size: 12px; background:#f1f5f9; padding: 1px 5px; border-radius: 3px; }
</style></head><body>
<div class="card">
  <span class="step">Étape 1/2 — Connexion BDD</span>
  <h1>My-Feedbacks Bridge</h1>
  <p class="lead">Configure la connexion à ta base de données et génère un secret HMAC. Le fichier <code>myfb-bridge.config.php</code> sera écrit à côté de ce script.</p>

  <?php if (empty($drivers)): ?>
    <div class="status err" style="display:block">Aucun driver PDO trouvé. Installe au minimum <code>php-mysql</code> ou <code>php-pgsql</code>.</div>
  <?php endif; ?>

  <form id="setup-form" autocomplete="off">
    <fieldset>
      <legend>Connexion</legend>
      <div class="row">
        <label><span>Moteur</span>
          <select name="engine" id="engine">
            <?php foreach ($drivers as $d): if (!in_array($d, ['mysql', 'pgsql'], true)) continue; ?>
              <option value="<?= htmlspecialchars($d) ?>"<?= $d === $defaultEngine ? ' selected' : '' ?>>
                <?= $d === 'mysql' ? 'MySQL / MariaDB' : 'PostgreSQL' ?>
              </option>
            <?php endforeach; ?>
          </select>
        </label>
        <label><span>Port</span><input type="number" name="port" id="port" min="1" max="65535" value="<?= $autoPort ?>"></label>
      </div>
      <label><span>Hôte</span><input type="text" name="host" id="host" value="<?= htmlspecialchars($autoHost) ?>"></label>
      <label><span>Base</span><input type="text" name="database" id="database" placeholder="ex : my_app_prod" required></label>
      <div class="row">
        <label><span>Utilisateur (read-only recommandé)</span><input type="text" name="user" id="user" placeholder="myfb_readonly" required></label>
        <label><span>Mot de passe</span><input type="password" name="pass" id="pass" required></label>
      </div>
      <div class="actions">
        <button type="button" id="btn-test" class="ghost">🔌 Tester la connexion</button>
        <span id="test-status" class="status"></span>
      </div>
      <p class="hint">Crée idéalement un user MySQL dédié : <code>CREATE USER 'myfb_readonly'@'%' IDENTIFIED BY '...'; GRANT SELECT ON ta_base.* TO 'myfb_readonly'@'%';</code></p>
    </fieldset>

    <fieldset>
      <legend>Tables exposées</legend>
      <label><span>Patterns à exposer (un par ligne, glob — ex : <code>wp_*</code>, <code>shop_*</code>, ou <code>*</code> pour tout)</span>
        <textarea name="expose" id="expose" rows="2">*</textarea>
      </label>
      <label><span>Tables interdites (un nom par ligne — ex : <code>wp_users</code>, <code>wp_options</code>)</span>
        <textarea name="deny" id="deny" rows="2"></textarea>
      </label>
    </fieldset>

    <div class="actions">
      <button type="submit" id="btn-save">✓ Générer le secret et écrire le config</button>
      <span id="save-status" class="status"></span>
    </div>
  </form>

  <details>
    <summary>Aide & sécurité</summary>
    <ul style="font-size:12px;color:var(--muted);line-height:1.6;">
      <li>Le secret HMAC est généré localement (<code>random_bytes(32)</code>) et stocké uniquement dans <code>myfb-bridge.config.php</code>.</li>
      <li>Aucune requête SQL libre n'est jamais acceptée. Seules les opérations <code>meta</code>, <code>tables</code>, <code>describe</code>, <code>sample</code>, <code>count</code>, <code>schema_md</code> sont exposées, signées HMAC-SHA256.</li>
      <li>Une fois le setup terminé, ce wizard se verrouille. Pour rejouer le setup, supprime <code>myfb-bridge.config.php</code> à la main.</li>
      <li>Pense à protéger <code>myfb-bridge.config.php</code> par une règle <code>deny from all</code> (<code>.htaccess</code>) ou à placer le fichier hors du document root.</li>
    </ul>
  </details>
</div>

<script>
(function () {
  function $(id) { return document.getElementById(id); }
  function show(el, kind, msg) { el.className = 'status ' + kind; el.style.display = 'inline-block'; el.textContent = msg; }
  function collect() {
    return {
      engine:   $('engine').value,
      host:     $('host').value.trim(),
      port:     parseInt($('port').value, 10) || 3306,
      database: $('database').value.trim(),
      user:     $('user').value.trim(),
      pass:     $('pass').value,
      expose:   $('expose').value,
      deny:     $('deny').value,
    };
  }
  function post(action, data) {
    var fd = new FormData();
    fd.append('action', action);
    Object.keys(data).forEach(function (k) { fd.append(k, data[k]); });
    return fetch(window.location.pathname, { method: 'POST', body: fd })
      .then(function (r) { return r.json().catch(function () { return { ok:false, error:'bad response' }; }); });
  }
  $('btn-test').addEventListener('click', function () {
    var st = $('test-status');
    show(st, '', 'Test en cours…'); st.style.display = 'inline-block';
    post('test', collect()).then(function (r) {
      if (r.ok) show(st, 'ok', '✓ Connexion OK — ' + (r.data && r.data.tables ? r.data.tables : 0) + ' table(s) visible(s)');
      else show(st, 'err', '✗ ' + (r.error || 'échec'));
    });
  });
  $('setup-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var st = $('save-status');
    show(st, '', 'Génération du secret…'); st.style.display = 'inline-block';
    post('save', collect()).then(function (r) {
      if (r.ok && r.data && r.data.secret) {
        document.open();
        document.write(r.data.html);
        document.close();
      } else {
        show(st, 'err', '✗ ' + (r.error || 'échec'));
      }
    });
  });
})();
</script>
</body></html><?php
}

function setup_test_connection(): void {
    $cfg = setup_form_to_config();
    try {
        $pdo = new PDO($cfg['dsn'], $cfg['user'], $cfg['pass'], [
            PDO::ATTR_ERRMODE          => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $tables = count($pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN) ?: []);
        send_json_ok(['tables' => $tables, 'driver' => $pdo->getAttribute(PDO::ATTR_DRIVER_NAME)]);
    } catch (Throwable $e) {
        send_json_err($e->getMessage());
    }
}

function setup_save_config(): void {
    if (is_file(MYFB_CONFIG_FILE)) {
        // Refuse silently to avoid overwriting credentials of an already-set-up
        // bridge. Admin must delete the config file manually.
        send_json_err('Setup déjà complet — supprime myfb-bridge.config.php pour rejouer');
    }
    $cfg = setup_form_to_config();
    try {
        $pdo = new PDO($cfg['dsn'], $cfg['user'], $cfg['pass'], [
            PDO::ATTR_ERRMODE          => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $pdo->query("SHOW TABLES")->fetchAll();
    } catch (Throwable $e) {
        send_json_err('Connexion KO avant écriture : ' . $e->getMessage());
    }
    $secret = bin2hex(random_bytes(32));
    $payload = [
        'setup_complete' => true,
        'secret'         => $secret,
        'dsn'            => $cfg['dsn'],
        'user'           => $cfg['user'],
        'pass'           => $cfg['pass'],
        'expose'         => $cfg['expose_list'],
        'deny'           => $cfg['deny_list'],
        'generated_at'   => date('c'),
    ];
    $content = "<?php\n// Generated by myfb-bridge.php setup wizard.\n// DO NOT COMMIT THIS FILE.\nreturn " . var_export($payload, true) . ";\n";
    if (@file_put_contents(MYFB_CONFIG_FILE, $content, LOCK_EX) === false) {
        send_json_err("Impossible d'écrire myfb-bridge.config.php (permissions ?)");
    }
    @chmod(MYFB_CONFIG_FILE, 0600);

    $bridgeUrl = (isset($_SERVER['HTTPS']) ? 'https' : 'http') . '://'
        . ($_SERVER['HTTP_HOST'] ?? 'localhost')
        . strtok(($_SERVER['REQUEST_URI'] ?? ''), '?');

    $html = render_success($secret, $bridgeUrl);
    send_json_ok(['secret' => $secret, 'html' => $html]);
}

function setup_form_to_config(): array {
    $engine   = $_POST['engine']   ?? 'mysql';
    $host     = $_POST['host']     ?? '127.0.0.1';
    $port     = (int)($_POST['port'] ?? 3306);
    $database = $_POST['database'] ?? '';
    $user     = $_POST['user']     ?? '';
    $pass     = $_POST['pass']     ?? '';
    $expose   = array_filter(array_map('trim', preg_split('/[\r\n,]+/', $_POST['expose'] ?? '*')));
    $deny     = array_filter(array_map('trim', preg_split('/[\r\n,]+/', $_POST['deny'] ?? '')));
    if ($engine === 'pgsql') {
        $dsn = "pgsql:host={$host};port={$port};dbname={$database}";
    } else {
        $dsn = "mysql:host={$host};port={$port};dbname={$database};charset=utf8mb4";
    }
    return [
        'dsn'  => $dsn,
        'user' => $user,
        'pass' => $pass,
        'expose_list' => $expose ?: ['*'],
        'deny_list'   => $deny,
    ];
}

function render_success(string $secret, string $bridgeUrl): string {
    $secretHtml = htmlspecialchars($secret);
    $urlHtml    = htmlspecialchars($bridgeUrl);
    return <<<HTML
<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Bridge configuré</title>
<style>body{font:14px/1.5 -apple-system,sans-serif;color:#0f172a;background:#f8fafc;margin:0;padding:24px}
.card{max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;box-shadow:0 4px 12px rgba(0,0,0,.04)}
h1{margin:0 0 8px;color:#16a34a;font-size:22px}
.lead{color:#64748b;margin:0 0 18px}
.box{background:#0f172a;color:#e2e8f0;font-family:ui-monospace,Consolas,monospace;font-size:13px;padding:12px 14px;border-radius:8px;word-break:break-all;margin:8px 0;position:relative}
.box .copy{position:absolute;top:6px;right:6px;background:#0ea5b7;border:0;color:#fff;font:600 11px inherit;padding:4px 8px;border-radius:4px;cursor:pointer}
.label{font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-top:14px;display:block}
.warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e;padding:10px 12px;border-radius:6px;font-size:13px;margin-top:18px}
ol{margin:14px 0 0;padding-left:22px;font-size:13px;line-height:1.7}</style></head><body>
<div class="card">
<h1>✓ Bridge configuré</h1>
<p class="lead">Garde cette page ouverte le temps de coller le secret dans My-Feedbacks — il ne sera plus jamais affiché.</p>

<span class="label">URL du bridge</span>
<div class="box"><button class="copy" data-c="u">📋</button><span id="u">{$urlHtml}</span></div>

<span class="label">Secret HMAC (à coller dans l'extension, à NE pas commiter)</span>
<div class="box"><button class="copy" data-c="s">📋</button><span id="s">{$secretHtml}</span></div>

<div class="warn">
⚠ Ce secret n'est plus jamais ré-affiché. Si tu le perds, supprime <code>myfb-bridge.config.php</code> et rejoue le setup.
</div>

<ol>
<li>Ouvre My-Feedbacks → Settings → Bases de données → <b>+ Ajouter</b>.</li>
<li>Mode = <b>Bridge HTTP</b>. Colle l'URL et le Secret ci-dessus.</li>
<li>Clique <b>🔄 Rafraîchir</b> sur la fiche → l'IA reçoit ton schéma automatiquement.</li>
</ol>
</div>
<script>
document.querySelectorAll('.copy').forEach(function(b){b.addEventListener('click',function(){
  var t=document.getElementById(b.dataset.c).textContent;
  navigator.clipboard.writeText(t).then(function(){b.textContent='✓';setTimeout(function(){b.textContent='📋';},1200);});
});});
</script>
</body></html>
HTML;
}

function send_json_ok($data = null): void {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => true, 'data' => $data, 'version' => MYFB_BRIDGE_VERSION], JSON_UNESCAPED_SLASHES);
    exit;
}
function send_json_err(string $msg, int $code = 400): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => $msg, 'version' => MYFB_BRIDGE_VERSION], JSON_UNESCAPED_SLASHES);
    exit;
}

// ============================================================================
//  API mode
// ============================================================================

function handle_api(array $config): void {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('X-Myfb-Bridge-Version: ' . MYFB_BRIDGE_VERSION);

    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        // GET on an already-configured bridge: harmless info page, no secrets.
        header('Content-Type: text/plain; charset=utf-8');
        echo "My-Feedbacks Bridge v" . MYFB_BRIDGE_VERSION . " — configured, API only via POST.";
        exit;
    }

    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) === 0 || strlen($raw) > 32768) {
        api_error($config, 'empty body', 400);
    }
    $req = json_decode($raw, true);
    if (!is_array($req)) api_error($config, 'bad json', 400);

    $op    = isset($req['op'])    && is_string($req['op'])    ? $req['op']    : '';
    $args  = isset($req['args'])  && is_array($req['args'])   ? $req['args']  : [];
    $ts    = isset($req['ts'])    && is_int($req['ts'])       ? $req['ts']    : 0;
    $nonce = isset($req['nonce']) && is_string($req['nonce']) ? $req['nonce'] : '';
    $sig   = isset($req['sig'])   && is_string($req['sig'])   ? $req['sig']   : '';

    $now = time();
    if ($ts <= 0 || abs($now - $ts) > MYFB_MAX_REQ_AGE) api_error($config, 'stale request', 401);
    if (strlen($nonce) < 16 || strlen($nonce) > 128)    api_error($config, 'bad nonce', 401);

    $canon   = json_encode($args, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $message = $ts . '.' . $nonce . '.' . $op . '.' . ($canon === false ? '{}' : $canon);
    $expect  = hash_hmac('sha256', $message, $config['secret']);
    if (!hash_equals($expect, $sig)) {
        audit($op, 'bad_sig');
        api_error($config, 'bad signature', 401);
    }
    if (nonce_seen($nonce, $now)) {
        audit($op, 'replay');
        api_error($config, 'replay detected', 401);
    }

    try {
        switch ($op) {
            case 'meta':       $data = op_meta($config);               break;
            case 'tables':     $data = op_tables($config);             break;
            case 'describe':   $data = op_describe($config, $args);    break;
            case 'sample':     $data = op_sample($config, $args);      break;
            case 'count':      $data = op_count($config, $args);       break;
            case 'schema_md':  $data = op_schema_md($config, $args);   break;
            default:           api_error($config, 'unknown op: ' . $op, 400);
        }
        audit($op, 'ok');
        api_ok($config, $data);
    } catch (Throwable $e) {
        audit($op, 'err');
        api_error($config, 'internal: ' . $e->getMessage(), 500);
    }
}

function api_ok(array $config, $data): void {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => true, 'data' => $data, 'version' => MYFB_BRIDGE_VERSION],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}
function api_error(array $config, string $msg, int $code): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => $msg, 'version' => MYFB_BRIDGE_VERSION], JSON_UNESCAPED_SLASHES);
    exit;
}

// ============================================================================
//  Operations
// ============================================================================

function op_meta(array $config): array {
    $pdo = db($config);
    $tables  = list_exposed_tables($config, $pdo);
    $rowsAll = 0; $sizeAll = 0;
    foreach ($tables as $t) { $rowsAll += (int)$t['rows']; $sizeAll += (float)$t['bytes']; }
    return [
        'driver'     => $pdo->getAttribute(PDO::ATTR_DRIVER_NAME),
        'version'    => $pdo->getAttribute(PDO::ATTR_SERVER_VERSION),
        'tableCount' => count($tables),
        'totalRows'  => $rowsAll,
        'totalBytes' => $sizeAll,
    ];
}

function op_tables(array $config): array {
    return ['tables' => list_exposed_tables($config, db($config))];
}

function op_describe(array $config, array $args): array {
    $name = require_table_name($config, $args);
    $cols = db($config)->query("SHOW FULL COLUMNS FROM " . quote_ident($name))->fetchAll(PDO::FETCH_ASSOC);
    return ['columns' => array_map(function ($c) {
        return [
            'name'    => $c['Field'],
            'type'    => $c['Type'],
            'null'    => $c['Null'] === 'YES',
            'key'     => $c['Key'],
            'default' => $c['Default'],
            'extra'   => $c['Extra'],
            'comment' => $c['Comment'] ?? '',
        ];
    }, $cols)];
}

function op_sample(array $config, array $args): array {
    $name  = require_table_name($config, $args);
    $limit = isset($args['limit']) && is_int($args['limit']) ? $args['limit'] : 3;
    $limit = max(1, min(MYFB_MAX_SAMPLE_ROWS, $limit));
    $strategy = $args['strategy'] ?? 'mixed';
    $pdo = db($config);

    $totalRows = (int)$pdo->query("SELECT COUNT(*) FROM " . quote_ident($name))->fetchColumn();
    if ($totalRows === 0) return ['rows' => [], 'totalRows' => 0];

    $rows = [];
    if ($strategy === 'first') {
        $stmt = $pdo->prepare("SELECT * FROM " . quote_ident($name) . " LIMIT :n");
        $stmt->bindValue(':n', $limit, PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } else {
        $each = max(1, intdiv($limit, 3));
        $rows = array_merge($rows, fetch_slice($pdo, $name, 0, $each));
        if ($totalRows > $each * 2) {
            $rows = array_merge($rows, fetch_slice($pdo, $name, intdiv(max(0, $totalRows - $each), 2), $each));
        }
        if ($totalRows > $each) {
            $rows = array_merge($rows, fetch_slice($pdo, $name, max(0, $totalRows - $each), $each));
        }
    }
    return [
        'rows'      => array_map('truncate_row', $rows),
        'totalRows' => $totalRows,
    ];
}

function op_count(array $config, array $args): array {
    $name = require_table_name($config, $args);
    $n = (int)db($config)->query("SELECT COUNT(*) FROM " . quote_ident($name))->fetchColumn();
    return ['count' => $n];
}

function op_schema_md(array $config, array $args): array {
    $pdo  = db($config);
    $tables = list_exposed_tables($config, $pdo);
    $totalRows = 0; $totalBytes = 0;
    foreach ($tables as $t) { $totalRows += (int)$t['rows']; $totalBytes += (float)$t['bytes']; }

    $md  = "# Base de données\n\n";
    $md .= "- Moteur : `" . $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) . "` " . htmlspecialchars((string)$pdo->getAttribute(PDO::ATTR_SERVER_VERSION)) . "\n";
    $md .= "- Tables exposées : " . count($tables) . "\n";
    $md .= "- Lignes totales : " . number_format($totalRows, 0, '.', ' ') . "\n";
    $md .= "- Taille totale : " . sprintf('%.2f', $totalBytes / 1048576) . " Mo\n\n";
    $md .= "## Récap tables\n\n| Table | Lignes | Mo |\n|---|---:|---:|\n";
    foreach ($tables as $t) {
        $mb = sprintf('%.2f', ((float)$t['bytes']) / 1048576);
        $md .= "| `{$t['name']}` | {$t['rows']} | {$mb} |\n";
    }
    $md .= "\n## Détail\n\n";

    foreach ($tables as $t) {
        $name = $t['name'];
        $md .= "### `{$name}`\n\n";
        $cols = $pdo->query("SHOW FULL COLUMNS FROM " . quote_ident($name))->fetchAll(PDO::FETCH_ASSOC);
        $md .= "| Colonne | Type | Null | Clé | Défaut |\n|---|---|---|---|---|\n";
        foreach ($cols as $c) {
            $md .= "| `{$c['Field']}` | `{$c['Type']}` | "
                 . ($c['Null'] === 'YES' ? 'oui' : 'non') . " | {$c['Key']} | "
                 . ($c['Default'] === null ? '∅' : "`{$c['Default']}`") . " |\n";
        }
        $samp = op_sample($config, ['table' => $name, 'limit' => MYFB_MAX_SAMPLE_ROWS, 'strategy' => 'mixed']);
        if (!empty($samp['rows'])) {
            $colNames = array_map(function ($c) { return $c['Field']; }, $cols);
            $md .= "\n_Échantillon (" . count($samp['rows']) . " lignes) :_\n\n";
            $md .= '| ' . implode(' | ', array_map(fn($c) => '`' . $c . '`', $colNames)) . " |\n";
            $md .= '| ' . implode(' | ', array_fill(0, count($colNames), '---')) . " |\n";
            foreach ($samp['rows'] as $row) {
                $cells = [];
                foreach ($colNames as $cn) {
                    $v = $row[$cn] ?? '';
                    if ($v === null) $v = '∅';
                    $v = str_replace(['|', "\n", "\r"], ['\\|', ' ', ' '], (string)$v);
                    $cells[] = $v;
                }
                $md .= '| ' . implode(' | ', $cells) . " |\n";
            }
        }
        $md .= "\n";
    }
    return ['markdown' => $md, 'generatedTs' => time()];
}

// ============================================================================
//  Helpers
// ============================================================================

function db(array $config): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;
    $pdo = new PDO($config['dsn'], $config['user'], $config['pass'], [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    return $pdo;
}

function list_exposed_tables(array $config, PDO $pdo): array {
    $rows = $pdo->query("SHOW TABLE STATUS")->fetchAll(PDO::FETCH_ASSOC);
    $out = [];
    foreach ($rows as $r) {
        $name = $r['Name'];
        if (!table_allowed($config, $name)) continue;
        $out[] = [
            'name'   => $name,
            'rows'   => (int)($r['Rows'] ?? 0),
            'bytes'  => (float)(($r['Data_length'] ?? 0) + ($r['Index_length'] ?? 0)),
            'engine' => $r['Engine'] ?? '',
        ];
    }
    return $out;
}

function table_allowed(array $config, string $name): bool {
    foreach ($config['deny'] as $deny) { if ($name === $deny) return false; }
    foreach ($config['expose'] as $pat) { if (fnmatch($pat, $name)) return true; }
    return false;
}

function require_table_name(array $config, array $args): string {
    $n = $args['table'] ?? '';
    if (!is_string($n) || $n === '' || !preg_match('/^[A-Za-z0-9_\$-]{1,64}$/', $n)) {
        api_error($config, 'bad table name', 400);
    }
    if (!table_allowed($config, $n)) api_error($config, 'table not exposed', 403);
    return $n;
}

function fetch_slice(PDO $pdo, string $table, int $offset, int $limit): array {
    $stmt = $pdo->prepare("SELECT * FROM " . quote_ident($table) . " LIMIT :o, :n");
    $stmt->bindValue(':o', $offset, PDO::PARAM_INT);
    $stmt->bindValue(':n', $limit,  PDO::PARAM_INT);
    $stmt->execute();
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

function truncate_row(array $row): array {
    foreach ($row as $k => $v) {
        if (is_string($v) && strlen($v) > MYFB_MAX_VALUE_LEN) {
            $row[$k] = substr($v, 0, MYFB_MAX_VALUE_LEN - 3) . '...';
        }
    }
    return $row;
}

function quote_ident(string $name): string {
    if (!preg_match('/^[A-Za-z0-9_\$-]{1,64}$/', $name)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'bad identifier']);
        exit;
    }
    return '`' . str_replace('`', '``', $name) . '`';
}

function nonce_seen(string $nonce, int $now): bool {
    $file = MYFB_NONCE_FILE;
    $window = MYFB_MAX_REQ_AGE;
    $entries = [];
    if (is_file($file)) {
        $fh = @fopen($file, 'r');
        if ($fh) {
            while (($line = fgets($fh)) !== false) {
                $line = trim($line);
                if ($line === '') continue;
                [$ts, $n] = array_pad(explode(' ', $line, 2), 2, '');
                $ts = (int)$ts;
                if ($ts <= 0 || abs($now - $ts) > $window * 2) continue;
                $entries[$n] = $ts;
            }
            fclose($fh);
        }
    }
    if (isset($entries[$nonce])) return true;
    $entries[$nonce] = $now;
    $tmp = $file . '.tmp';
    $fh = @fopen($tmp, 'w');
    if ($fh) {
        foreach ($entries as $n => $ts) fwrite($fh, $ts . ' ' . $n . "\n");
        fclose($fh);
        @rename($tmp, $file);
    }
    return false;
}

function audit(string $op, string $result): void {
    if (!MYFB_AUDIT_FILE) return;
    $ip = $_SERVER['REMOTE_ADDR'] ?? '?';
    $line = sprintf("%s op=%s result=%s ip=%s\n", date('c'), $op, $result, $ip);
    @file_put_contents(MYFB_AUDIT_FILE, $line, FILE_APPEND | LOCK_EX);
}
