/**
 * MyFb VS Code Bridge
 *
 * Serveur HTTP local sur 127.0.0.1:<port> (défaut 51473).
 * POST /inject  { target, text, images[] }
 *   target = 'vscode'  → clipboard + temp files + notification
 *   target = 'copilot' → GitHub Copilot Chat (texte pré-rempli + pièces jointes)
 */

const vscode = require('vscode');
const http   = require('http');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const cp     = require('child_process');

let server    = null;
let statusBar = null;
let lastImages = [];

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('myfb.toggleBridge', () => {
      if (server) { stopBridge(); vscode.window.showInformationMessage('MyFb Bridge arrêté.'); }
      else        { startBridge(context); }
    }),
    vscode.commands.registerCommand('myfb.showLastImages', () => {
      if (!lastImages.length) {
        vscode.window.showInformationMessage('MyFb : aucune image reçue pour l\'instant.');
        return;
      }
      lastImages.forEach((p) => {
        if (fs.existsSync(p)) vscode.commands.executeCommand('vscode.open', vscode.Uri.file(p));
      });
    }),
  );
  const cfg = vscode.workspace.getConfiguration('myfb');
  if (cfg.get('autoStart', true)) startBridge(context);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

// ── Hardening limits ──────────────────────────────────────────────────────
// Listening on 127.0.0.1 still means every page in every browser on the local
// machine can reach this server (including malicious local pages). Without
// these caps, a hostile script could DoS the editor or fill the temp dir.
const MAX_BODY_BYTES   = 20 * 1024 * 1024;  // 20 MB total payload
const MAX_TEXT_BYTES   = 1  * 1024 * 1024;  // 1 MB of prompt text
const MAX_IMAGE_COUNT  = 10;
const MAX_IMAGE_BYTES  = 8  * 1024 * 1024;  // 8 MB per image (post-decode)
const ALLOWED_TARGETS  = new Set(['vscode', 'copilot']);

// Restricts the X-origin to chrome-extension://* (the MyFb side panel).
// Loopback-binding alone is NOT enough: any local page can fetch 127.0.0.1.
// A concrete origin check + the secret-token contract closes the gap.
function _isAllowedOrigin(req) {
  const origin = req.headers['origin'] || '';
  if (!origin) return true; // server-to-server style request (curl, ping)
  return origin.startsWith('chrome-extension://') ||
         origin.startsWith('moz-extension://')    ||
         origin.startsWith('safari-web-extension://');
}

function startBridge(context) {
  if (server) return;
  const port = Number(vscode.workspace.getConfiguration('myfb').get('bridgePort', 51473));

  server = http.createServer((req, res) => {
    const origin = req.headers['origin'] || '';
    // Echo back the requesting extension origin (exact-match) — never `*`.
    if (_isAllowedOrigin(req)) {
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    } else {
      // Reject browsers from disallowed origins outright.
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'origin not allowed' }));
      return;
    }

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const workspaceName = vscode.workspace.name || 'Untitled';
      res.end(JSON.stringify({ ok: true, version: '0.5.0', port: server.address().port, workspaceName }));
      return;
    }

    if (req.method === 'POST' && req.url === '/inject') {
      let received = 0;
      const chunks = [];
      let aborted = false;
      req.on('data', (c) => {
        if (aborted) return;
        received += c.length;
        if (received > MAX_BODY_BYTES) {
          aborted = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'payload too large (> ' + MAX_BODY_BYTES + ' bytes)' }));
          try { req.destroy(); } catch (_) {}
          return;
        }
        chunks.push(c);
      });
      req.on('end', async () => {
        if (aborted) return;
        try {
          const body    = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          const valid   = _validatePayload(payload);
          if (valid.error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: valid.error }));
            return;
          }
          const result = payload.target === 'copilot'
            ? await handleInjectCopilot(payload)
            : await handleInjectVscode(payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || String(e) }));
        }
      });
      return;
    }

    res.writeHead(404); res.end();
  });

  let currentPort = port;
  const maxPort = port + 9;

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      if (currentPort < maxPort) {
        currentPort++;
        server.listen(currentPort, '127.0.0.1');
      } else {
        server = null;
        vscode.window.showWarningMessage('MyFb Bridge : Aucun port disponible entre ' + port + ' et ' + maxPort + '.');
        _updateStatusBar(false);
      }
    } else {
      server = null;
      vscode.window.showWarningMessage('MyFb Bridge erreur : ' + e.message);
      _updateStatusBar(false);
    }
  });

  server.listen(currentPort, '127.0.0.1', () => { _updateStatusBar(true, currentPort); });
  if (context) context.subscriptions.push({ dispose: stopBridge });
}

function stopBridge() {
  if (!server) return;
  server.close();
  server = null;
  _updateStatusBar(false);
}

// ---------------------------------------------------------------------------
// Shared: save images to temp dir
// ---------------------------------------------------------------------------

function _validatePayload(p) {
  if (!p || typeof p !== 'object') return { error: 'payload must be an object' };
  if (!ALLOWED_TARGETS.has(p.target)) {
    return { error: 'invalid target (expected: ' + Array.from(ALLOWED_TARGETS).join(', ') + ')' };
  }
  if (p.text != null && typeof p.text !== 'string') return { error: 'text must be a string' };
  if (typeof p.text === 'string' && Buffer.byteLength(p.text, 'utf8') > MAX_TEXT_BYTES) {
    return { error: 'text too large (> ' + MAX_TEXT_BYTES + ' bytes)' };
  }
  if (p.images != null && !Array.isArray(p.images)) return { error: 'images must be an array' };
  if (Array.isArray(p.images)) {
    if (p.images.length > MAX_IMAGE_COUNT) {
      return { error: 'too many images (max ' + MAX_IMAGE_COUNT + ')' };
    }
    for (let i = 0; i < p.images.length; i++) {
      const u = p.images[i];
      if (typeof u !== 'string' || !/^data:image\/(png|jpeg|gif|webp);base64,/.test(u)) {
        return { error: 'image[' + i + '] must be a data:image/* base64 URL' };
      }
      // Rough decoded-size estimate: 3/4 of the base64 payload.
      const b64 = u.slice(u.indexOf(',') + 1);
      if (b64.length * 0.75 > MAX_IMAGE_BYTES) {
        return { error: 'image[' + i + '] too large (> ' + MAX_IMAGE_BYTES + ' bytes)' };
      }
    }
  }
  return { ok: true };
}

function _saveImages(images) {
  const cfg     = vscode.workspace.getConfiguration('myfb');
  const tmpBase = cfg.get('tempDir', '') || path.join(os.tmpdir(), 'myfb-inject');
  if (!fs.existsSync(tmpBase)) fs.mkdirSync(tmpBase, { recursive: true });

  const now   = Date.now();
  const saved = [];
  for (let i = 0; i < (images || []).length; i++) {
    const dataUrl = images[i];
    const comma   = dataUrl.indexOf(',');
    if (comma < 0) continue;
    const buf  = Buffer.from(dataUrl.slice(comma + 1), 'base64');
    const file = path.join(tmpBase, 'myfb-' + now + '-' + (i + 1) + '.png');
    fs.writeFileSync(file, buf);
    saved.push(file);
  }
  lastImages = saved;
  return { saved, tmpBase };
}

// ---------------------------------------------------------------------------
// Target: VS Code generic (Claude Code CLI / any terminal)
// ---------------------------------------------------------------------------

async function handleInjectVscode(payload) {
  const { text, images } = payload;
  if (text) await vscode.env.clipboard.writeText(text);

  const { saved, tmpBase } = _saveImages(images);

  const imgPart = saved.length ? ' + ' + saved.length + ' image(s) sauvegardée(s)' : '';
  const actions = ['Coller dans terminal'];
  if (saved.length) actions.push('Ouvrir images');

  const choice = await vscode.window.showInformationMessage(
    'MyFb : prompt dans le presse-papier' + imgPart + '.', ...actions,
  );

  if (choice === 'Coller dans terminal') {
    const term = vscode.window.activeTerminal || vscode.window.createTerminal({ name: 'MyFb' });
    term.show(true);
    if (text) term.sendText(text, false);
  }
  if (choice === 'Ouvrir images') {
    for (const p of saved) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(p));
  }

  return { ok: true, text: !!text, images: saved.length, tmpDir: tmpBase };
}

// ---------------------------------------------------------------------------
// Target: GitHub Copilot Chat
//
// Texte  → workbench.action.chat.open { query, isPartialQuery:true }  (API)
//          Fallback : clipboard → focus → clic dans iframe → Ctrl+V natif
// Images → API commands (workbench.action.chat.attachFile / attachContext)
//          Fallback : vscode.open (drag manuel)
// ---------------------------------------------------------------------------

async function handleInjectCopilot(payload) {
  const { text, images } = payload;
  const { saved, tmpBase } = _saveImages(images);

  // ── 1. Texte via VS Code Chat API (pre-fills the input without sending) ──
  let textMethod = null;
  if (text) {
    for (const attempt of [
      // VS Code Chat API 1.90+ — pré-remplit le champ, n'envoie pas
      () => vscode.commands.executeCommand('workbench.action.chat.open',
              { query: text, isPartialQuery: true }),
      // Copilot-specific fallback
      () => vscode.commands.executeCommand('github.copilot.chat.open',
              { message: text }),
    ]) {
      try { await attempt(); textMethod = 'api'; break; } catch (_) {}
    }

    // ── Fallback ultime : clipboard → clic dans la fenêtre → Ctrl+V ──────
    // Le problème du Ctrl+V seul : VS Code focus le conteneur du panel,
    // pas l'<input> à l'intérieur du webview (iframe sandboxé).
    // Solution : on simule un clic dans la fenêtre VS Code pour forcer
    // le focus à entrer dans l'iframe, puis on colle.
    if (!textMethod) {
      await vscode.env.clipboard.writeText(text);

      // Ouvrir/focus le panel
      for (const cmd of [
        'workbench.panel.chat.view.copilot.focus',
        'github.copilot.chat.focus',
        'workbench.action.chat.open',
      ]) {
        try { await vscode.commands.executeCommand(cmd); break; } catch (_) {}
      }

      await _sleep(500);
      await _clickAndPaste();   // clic dans iframe + Ctrl+V
      textMethod = 'clipboard+click+paste';
    }
  }

  // ── 2. Images via API ────────────────────────────────────────────────────
  const attached = [];
  for (const filePath of saved) {
    const uri = vscode.Uri.file(filePath);
    let ok = false;
    for (const attempt of [
      () => vscode.commands.executeCommand('workbench.action.chat.attachFile', uri),
      () => vscode.commands.executeCommand('workbench.action.chat.attachContext',
              { uri, kind: 'file' }),
      () => vscode.commands.executeCommand('github.copilot.chat.attachFile', uri),
    ]) {
      try { await attempt(); ok = true; break; } catch (_) {}
    }
    if (ok) attached.push(filePath);
    else { try { await vscode.commands.executeCommand('vscode.open', uri); } catch (_) {} }
  }

  // ── 3. Notification ──────────────────────────────────────────────────────
  const notAttached = saved.length - attached.length;
  let msg = 'MyFb → Copilot : texte injecté (' + textMethod + ')';
  if (attached.length) msg += ', ' + attached.length + ' image(s) jointe(s)';
  if (notAttached > 0) msg += ' (' + notAttached + ' image(s) ouverte(s) — glissez dans le chat)';

  const choice = await vscode.window.showInformationMessage(msg, ...(notAttached > 0 ? ['Aide'] : []));
  if (choice === 'Aide') {
    vscode.window.showInformationMessage(
      'Glissez les images depuis l\'Explorateur vers le champ Copilot Chat.\nDossier : ' + tmpBase,
      { modal: true },
    );
  }

  return {
    ok: true,
    textMethod,
    images: { total: saved.length, attached: attached.length, opened: notAttached },
    tmpDir: tmpBase,
  };
}

// ---------------------------------------------------------------------------
// Native click-then-paste
//
// Problème : VS Code focus le conteneur du panel (niveau Electron/chrome),
// pas l'<input> qui est dans un iframe sandboxé. Ctrl+V tout seul ne suffit pas.
//
// Solution : simuler un clic à la position du champ texte Copilot pour forcer
// le focus à entrer dans l'iframe, PUIS coller.
//
// Linux  : xdotool (sudo apt install xdotool)
// macOS  : osascript
// Windows: PowerShell
// ---------------------------------------------------------------------------

function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function _clickAndPaste() {
  const plat = process.platform;
  try {
    if (plat === 'linux') {
      // Trouver la fenêtre VS Code, obtenir sa géométrie, cliquer en bas du panel
      const winId = cp.execSync(
        'xdotool search --name "Visual Studio Code" 2>/dev/null | tail -1',
        { timeout: 2000 },
      ).toString().trim();

      if (winId) {
        // Géométrie : X Y W H
        const geo = cp.execSync(
          'xdotool getwindowgeometry --shell ' + winId + ' 2>/dev/null',
          { timeout: 2000 },
        ).toString();
        const w = Number((geo.match(/WIDTH=(\d+)/)  || [])[1] || 800);
        const h = Number((geo.match(/HEIGHT=(\d+)/) || [])[1] || 600);

        // Le champ Copilot Chat est typiquement en bas à droite (~80% x, 92% y)
        const cx = Math.round(w * 0.80);
        const cy = Math.round(h * 0.92);
        cp.execSync(
          'xdotool mousemove --window ' + winId + ' ' + cx + ' ' + cy +
          ' click 1 sleep 0.1 key ctrl+v',
          { timeout: 3000 },
        );
      } else {
        cp.execSync('xdotool key ctrl+v', { timeout: 2000 });
      }

    } else if (plat === 'darwin') {
      // Sur macOS, on clique dans la fenêtre VS Code via osascript puis on colle
      cp.execSync(`osascript << 'EOF'
tell application "Visual Studio Code" to activate
delay 0.3
tell application "System Events"
  tell process "Electron"
    set frontmost to true
    -- Clic dans la zone du chat (bas du panneau)
    click at {800, 750}
    delay 0.15
    keystroke "v" using command down
  end tell
end tell
EOF`, { timeout: 5000 });

    } else if (plat === 'win32') {
      // Windows : focus la fenêtre VS Code, cliquer, coller
      cp.execSync(
        'powershell -command "' +
        'Add-Type -AssemblyName System.Windows.Forms; ' +
        'Add-Type -AssemblyName System.Drawing; ' +
        '$vscode = Get-Process -Name Code -ErrorAction SilentlyContinue | Select-Object -First 1; ' +
        'if ($vscode) { ' +
        '  [System.Windows.Forms.SendKeys]::SendWait(\\"^v\\"); ' +
        '}"',
        { timeout: 4000 },
      );
    }
  } catch (_) {
    // Native tool failed — text is in clipboard, user pastes manually (Ctrl+V)
  }
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function _updateStatusBar(active, port) {
  if (!statusBar) {
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    statusBar.command = 'myfb.toggleBridge';
  }
  const workspaceName = vscode.workspace.name || 'Untitled';
  statusBar.text    = active ? '$(plug) MyFb'          : '$(circle-slash) MyFb';
  statusBar.tooltip = active
    ? 'MyFb Bridge actif — port ' + port + ' (' + workspaceName + ')\nCliquer pour désactiver'
    : 'MyFb Bridge inactif\nCliquer pour activer';
  statusBar.color   = active ? '#4ec9b0' : undefined;
  statusBar.show();
}

// ---------------------------------------------------------------------------

function deactivate() { stopBridge(); }
module.exports = { activate, deactivate };
