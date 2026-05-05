/**
 * BIAIF VS Code Bridge
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
    vscode.commands.registerCommand('biaif.toggleBridge', () => {
      if (server) { stopBridge(); vscode.window.showInformationMessage('BIAIF Bridge arrêté.'); }
      else        { startBridge(context); }
    }),
    vscode.commands.registerCommand('biaif.showLastImages', () => {
      if (!lastImages.length) {
        vscode.window.showInformationMessage('BIAIF : aucune image reçue pour l\'instant.');
        return;
      }
      lastImages.forEach((p) => {
        if (fs.existsSync(p)) vscode.commands.executeCommand('vscode.open', vscode.Uri.file(p));
      });
    }),
  );
  const cfg = vscode.workspace.getConfiguration('biaif');
  if (cfg.get('autoStart', true)) startBridge(context);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function startBridge(context) {
  if (server) return;
  const port = Number(vscode.workspace.getConfiguration('biaif').get('bridgePort', 51473));

  server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, version: '0.4.0', port }));
      return;
    }

    if (req.method === 'POST' && req.url === '/inject') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body);
          const result  = payload.target === 'copilot'
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

  server.on('error', (e) => {
    server = null;
    const msg = e.code === 'EADDRINUSE'
      ? 'BIAIF Bridge : port ' + port + ' déjà utilisé. Changez `biaif.bridgePort`.'
      : 'BIAIF Bridge erreur : ' + e.message;
    vscode.window.showWarningMessage(msg);
    _updateStatusBar(false);
  });

  server.listen(port, '127.0.0.1', () => { _updateStatusBar(true, port); });
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

function _saveImages(images) {
  const cfg     = vscode.workspace.getConfiguration('biaif');
  const tmpBase = cfg.get('tempDir', '') || path.join(os.tmpdir(), 'biaif-inject');
  if (!fs.existsSync(tmpBase)) fs.mkdirSync(tmpBase, { recursive: true });

  const now   = Date.now();
  const saved = [];
  for (let i = 0; i < (images || []).length; i++) {
    const dataUrl = images[i];
    const comma   = dataUrl.indexOf(',');
    if (comma < 0) continue;
    const buf  = Buffer.from(dataUrl.slice(comma + 1), 'base64');
    const file = path.join(tmpBase, 'biaif-' + now + '-' + (i + 1) + '.png');
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
    'BIAIF : prompt dans le presse-papier' + imgPart + '.', ...actions,
  );

  if (choice === 'Coller dans terminal') {
    const term = vscode.window.activeTerminal || vscode.window.createTerminal({ name: 'BIAIF' });
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
// Stratégie : clipboard → focus panel → Ctrl+V natif → images
// ---------------------------------------------------------------------------

async function handleInjectCopilot(payload) {
  const { text, images } = payload;
  const { saved, tmpBase } = _saveImages(images);

  // ── 1. Texte dans le presse-papier ──────────────────────────────────────
  if (text) await vscode.env.clipboard.writeText(text);

  // ── 2. Focus le panel Copilot Chat ──────────────────────────────────────
  const focusCandidates = [
    'workbench.panel.chat.view.copilot.focus',
    'github.copilot.chat.focus',
    'workbench.action.chat.open',
    'workbench.view.extension.github-copilot-chat',
  ];
  for (const cmd of focusCandidates) {
    try { await vscode.commands.executeCommand(cmd); break; } catch (_) {}
  }

  // ── 3. Attendre que le champ soit prêt, puis coller ─────────────────────
  // 400 ms laisse VS Code le temps d'ouvrir le panel et de focus l'input.
  await _sleep(400);
  await _simulatePaste();

  // ── 4. Images : essaie attachment API, sinon ouvre pour drag manuel ─────
  const attached = [];
  for (const filePath of saved) {
    const uri = vscode.Uri.file(filePath);
    let ok = false;
    for (const attempt of [
      () => vscode.commands.executeCommand('workbench.action.chat.attachFile', uri),
      () => vscode.commands.executeCommand('workbench.action.chat.attachContext', { uri, kind: 'file' }),
      () => vscode.commands.executeCommand('github.copilot.chat.attachFile', uri),
    ]) {
      try { await attempt(); ok = true; break; } catch (_) {}
    }
    if (ok) attached.push(filePath);
    else { try { await vscode.commands.executeCommand('vscode.open', uri); } catch (_) {} }
  }

  // ── 5. Notification résultat ─────────────────────────────────────────────
  const notAttached = saved.length - attached.length;
  let msg = 'BIAIF → Copilot : texte collé dans le chat';
  if (attached.length) msg += ', ' + attached.length + ' image(s) jointe(s)';
  if (notAttached > 0) msg += ' (' + notAttached + ' image(s) ouverte(s) — glissez dans le chat)';

  const choice = await vscode.window.showInformationMessage(msg, ...(notAttached > 0 ? ['Aide'] : []));
  if (choice === 'Aide') {
    vscode.window.showInformationMessage(
      'Glissez les fichiers images depuis l\'Explorateur (ou l\'onglet ouvert) vers le champ Copilot Chat.\nDossier : ' + tmpBase,
      { modal: true },
    );
  }

  return {
    ok: true,
    textMethod: 'clipboard+paste',
    images: { total: saved.length, attached: attached.length, opened: notAttached },
    tmpDir: tmpBase,
  };
}

// ---------------------------------------------------------------------------
// Native paste simulation (fallback when VS Code Chat API is unavailable)
//
// Simulates Ctrl+V at the OS level so text lands in whatever input has focus.
// Works on Linux (xdotool), macOS (osascript), Windows (PowerShell).
// Requires the chat panel to already be focused before calling.
// ---------------------------------------------------------------------------

function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function _simulatePaste() {
  const platform = process.platform;
  try {
    if (platform === 'linux') {
      // xdotool must be installed: sudo apt install xdotool
      cp.execSync('xdotool key ctrl+v', { timeout: 2000 });

    } else if (platform === 'darwin') {
      cp.execSync(
        'osascript -e \'tell application "System Events" to keystroke "v" using command down\'',
        { timeout: 2000 },
      );

    } else if (platform === 'win32') {
      cp.execSync(
        'powershell -command "Add-Type -AssemblyName System.Windows.Forms; ' +
        '[System.Windows.Forms.SendKeys]::SendWait(\\"^v\\")"',
        { timeout: 3000 },
      );
    }
  } catch (_) {
    // Native tool unavailable — clipboard fallback already done, user pastes manually
  }
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function _updateStatusBar(active, port) {
  if (!statusBar) {
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    statusBar.command = 'biaif.toggleBridge';
  }
  statusBar.text    = active ? '$(plug) BIAIF'          : '$(circle-slash) BIAIF';
  statusBar.tooltip = active
    ? 'BIAIF Bridge actif — port ' + port + '\nCliquer pour désactiver'
    : 'BIAIF Bridge inactif\nCliquer pour activer';
  statusBar.color   = active ? '#4ec9b0' : undefined;
  statusBar.show();
}

// ---------------------------------------------------------------------------

function deactivate() { stopBridge(); }
module.exports = { activate, deactivate };
