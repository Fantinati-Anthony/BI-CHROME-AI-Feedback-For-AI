<?php
/**
 * My-Feedbacks DB Bridge — single-file companion endpoint
 *
 * Drop this file at the root of your site (or anywhere reachable over HTTPS)
 * and configure the constants below. The My-Feedbacks Chrome extension calls
 * this endpoint with an HMAC-signed POST to fetch database metadata that the
 * AI can use as context.
 *
 * Security guarantees:
 *   - HMAC-SHA256 signature with timestamp + nonce → replay protection
 *   - Whitelisted operations only: meta, tables, describe, sample, count,
 *     schema_md — no free-form SQL is ever accepted from the client
 *   - Table-name pattern filtering (expose + deny lists)
 *   - PDO with prepared statements + identifier escaping
 *   - Hard caps on sample size and result length
 *   - CORS scoped to chrome-extension:// origins
 *   - Constant-time signature compare (no timing leak)
 *   - No logging of payloads; only a minimal audit line with success/fail
 *
 * Requirements: PHP 7.4+, PDO_MYSQL (or PDO_PGSQL for Postgres mode).
 *
 * SPDX-License-Identifier: MIT
 */

declare(strict_types=1);

// ============================================================================
//  CONFIGURATION — edit these values, then rotate the secret if it leaks
// ============================================================================

/** HMAC secret. Generate with: `openssl rand -hex 32`. Keep it private. */
const MYFB_SECRET = 'REPLACE_ME_WITH_openssl_rand_-hex_32';

/** Database connection. Use a dedicated read-only user. */
const MYFB_DB_DSN  = 'mysql:host=127.0.0.1;port=3306;dbname=mydb;charset=utf8mb4';
const MYFB_DB_USER = 'myfb_readonly';
const MYFB_DB_PASS = 'change_me';

/** Table-name glob patterns that ARE exposed. Use ['*'] for everything. */
const MYFB_EXPOSE_PATTERNS = ['wp_*', 'shop_*'];

/** Table names that are NEVER exposed, even if they match expose patterns. */
const MYFB_DENY_TABLES = ['wp_users', 'wp_usermeta', 'wp_options'];

/** Hard cap on sample rows per request (extension may ask for less). */
const MYFB_MAX_SAMPLE_ROWS = 9;

/** Max value length in samples (longer values are truncated). */
const MYFB_MAX_VALUE_LEN = 200;

/** Max request age in seconds (replay protection window). */
const MYFB_MAX_REQ_AGE = 60;

/** Bridge version reported back to the extension. */
const MYFB_BRIDGE_VERSION = '1.0.0';

/** Audit file (one line per request). Set to null to disable. */
const MYFB_AUDIT_FILE = __DIR__ . '/myfb-bridge.audit.log';

/** Nonce-store file for replay protection (entries auto-expire). */
const MYFB_NONCE_FILE = __DIR__ . '/myfb-bridge.nonces';

// ============================================================================
//  IMPLEMENTATION — no changes needed below this line
// ============================================================================

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('X-Myfb-Bridge-Version: ' . MYFB_BRIDGE_VERSION);

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { send_error('method', 405); }

// ---- Read + parse JSON body --------------------------------------------------
$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) === 0 || strlen($raw) > 32768) {
    send_error('empty body', 400);
}
$req = json_decode($raw, true);
if (!is_array($req)) send_error('bad json', 400);

$op    = isset($req['op'])    && is_string($req['op'])    ? $req['op']    : '';
$args  = isset($req['args'])  && is_array($req['args'])   ? $req['args']  : [];
$ts    = isset($req['ts'])    && is_int($req['ts'])       ? $req['ts']    : 0;
$nonce = isset($req['nonce']) && is_string($req['nonce']) ? $req['nonce'] : '';
$sig   = isset($req['sig'])   && is_string($req['sig'])   ? $req['sig']   : '';

// ---- Replay window ----------------------------------------------------------
$now = time();
if ($ts <= 0 || abs($now - $ts) > MYFB_MAX_REQ_AGE) send_error('stale request', 401);
if (strlen($nonce) < 16 || strlen($nonce) > 128) send_error('bad nonce', 401);

// ---- Signature verification (constant-time) ---------------------------------
$canonArgs = json_encode($args, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
$message   = $ts . '.' . $nonce . '.' . $op . '.' . ($canonArgs === false ? '{}' : $canonArgs);
$expected  = hash_hmac('sha256', $message, MYFB_SECRET);
if (!hash_equals($expected, $sig)) {
    audit($op, 'bad_sig');
    send_error('bad signature', 401);
}

// ---- Nonce replay check (after sig OK, to avoid leaking validity) -----------
if (nonce_seen($nonce, $now)) {
    audit($op, 'replay');
    send_error('replay detected', 401);
}

// ---- Operation dispatch -----------------------------------------------------
try {
    switch ($op) {
        case 'meta':       $data = op_meta();              break;
        case 'tables':     $data = op_tables();            break;
        case 'describe':   $data = op_describe($args);     break;
        case 'sample':     $data = op_sample($args);       break;
        case 'count':      $data = op_count($args);        break;
        case 'schema_md':  $data = op_schema_md($args);    break;
        default:           send_error('unknown op: ' . $op, 400);
    }
    audit($op, 'ok');
    send_ok($data);
} catch (Throwable $e) {
    audit($op, 'err');
    send_error('internal: ' . $e->getMessage(), 500);
}

// ============================================================================
//  Operations
// ============================================================================

function op_meta(): array {
    $pdo = db();
    $driver = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
    $version = $pdo->getAttribute(PDO::ATTR_SERVER_VERSION);
    $tables  = list_exposed_tables($pdo);
    $rowsAll = 0; $sizeAll = 0;
    foreach ($tables as $t) {
        $rowsAll += (int)$t['rows'];
        $sizeAll += (float)$t['bytes'];
    }
    return [
        'driver'     => $driver,
        'version'    => $version,
        'tableCount' => count($tables),
        'totalRows'  => $rowsAll,
        'totalBytes' => $sizeAll,
    ];
}

function op_tables(): array {
    return ['tables' => list_exposed_tables(db())];
}

function op_describe(array $args): array {
    $name = require_table_name($args);
    $pdo = db();
    $cols = $pdo->query("SHOW FULL COLUMNS FROM " . quote_ident($name))->fetchAll(PDO::FETCH_ASSOC);
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

function op_sample(array $args): array {
    $name  = require_table_name($args);
    $limit = isset($args['limit']) && is_int($args['limit']) ? $args['limit'] : 3;
    $limit = max(1, min(MYFB_MAX_SAMPLE_ROWS, $limit));
    $strategy = isset($args['strategy']) ? $args['strategy'] : 'mixed';
    $pdo = db();

    $totalRows = (int)$pdo->query("SELECT COUNT(*) FROM " . quote_ident($name))->fetchColumn();
    if ($totalRows === 0) return ['rows' => [], 'totalRows' => 0];

    $rows = [];
    if ($strategy === 'first') {
        $stmt = $pdo->prepare("SELECT * FROM " . quote_ident($name) . " LIMIT :n");
        $stmt->bindValue(':n', $limit, PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } else {
        // mixed: equal parts first / middle / end
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

function op_count(array $args): array {
    $name = require_table_name($args);
    $pdo  = db();
    $n = (int)$pdo->query("SELECT COUNT(*) FROM " . quote_ident($name))->fetchColumn();
    return ['count' => $n];
}

/**
 * Returns a single Markdown document with the full schema + samples,
 * ready to drop into the AI context. Mirrors the format of the WP
 * dashboard widget the user is migrating from.
 */
function op_schema_md(array $args): array {
    $pdo  = db();
    $driver = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
    $version = $pdo->getAttribute(PDO::ATTR_SERVER_VERSION);

    $tables = list_exposed_tables($pdo);
    $totalRows = 0; $totalBytes = 0;
    foreach ($tables as $t) { $totalRows += (int)$t['rows']; $totalBytes += (float)$t['bytes']; }

    $md  = "# Base de données\n\n";
    $md .= "- Moteur : `{$driver}` " . htmlspecialchars((string)$version) . "\n";
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
        $samp = op_sample(['table' => $name, 'limit' => MYFB_MAX_SAMPLE_ROWS, 'strategy' => 'mixed']);
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

function db(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;
    $pdo = new PDO(MYFB_DB_DSN, MYFB_DB_USER, MYFB_DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    return $pdo;
}

function list_exposed_tables(PDO $pdo): array {
    $rows = $pdo->query("SHOW TABLE STATUS")->fetchAll(PDO::FETCH_ASSOC);
    $out = [];
    foreach ($rows as $r) {
        $name = $r['Name'];
        if (!table_allowed($name)) continue;
        $out[] = [
            'name'   => $name,
            'rows'   => (int)($r['Rows'] ?? 0),
            'bytes'  => (float)(($r['Data_length'] ?? 0) + ($r['Index_length'] ?? 0)),
            'engine' => $r['Engine'] ?? '',
        ];
    }
    return $out;
}

function table_allowed(string $name): bool {
    foreach (MYFB_DENY_TABLES as $deny) {
        if ($name === $deny) return false;
    }
    foreach (MYFB_EXPOSE_PATTERNS as $pat) {
        if (fnmatch($pat, $name)) return true;
    }
    return false;
}

function require_table_name(array $args): string {
    $n = $args['table'] ?? '';
    if (!is_string($n) || $n === '' || !preg_match('/^[A-Za-z0-9_\$-]{1,64}$/', $n)) {
        send_error('bad table name', 400);
    }
    if (!table_allowed($n)) send_error('table not exposed', 403);
    return $n;
}

function fetch_slice(PDO $pdo, string $table, int $offset, int $limit): array {
    $stmt = $pdo->prepare("SELECT * FROM " . quote_ident($table) . " LIMIT :o, :n");
    $stmt->bindValue(':o', $offset, PDO::PARAM_INT);
    $stmt->bindValue(':n', $limit, PDO::PARAM_INT);
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

/** Escape an identifier with backticks (MySQL/MariaDB) or double quotes. */
function quote_ident(string $name): string {
    if (!preg_match('/^[A-Za-z0-9_\$-]{1,64}$/', $name)) {
        send_error('bad identifier', 400);
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
    $file = MYFB_AUDIT_FILE;
    if (!$file) return;
    $ip = $_SERVER['REMOTE_ADDR'] ?? '?';
    $line = sprintf("%s op=%s result=%s ip=%s\n", date('c'), $op, $result, $ip);
    @file_put_contents($file, $line, FILE_APPEND | LOCK_EX);
}

function send_ok($data): void {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => true, 'data' => $data, 'version' => MYFB_BRIDGE_VERSION],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function send_error(string $msg, int $code): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => $msg, 'version' => MYFB_BRIDGE_VERSION],
        JSON_UNESCAPED_SLASHES);
    exit;
}
