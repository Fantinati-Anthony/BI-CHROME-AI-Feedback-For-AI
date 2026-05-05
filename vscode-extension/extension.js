/**
 * BIAIF VS Code Bridge
 *
 * Démarre un serveur HTTP local sur 127.0.0.1:<port> (défaut 51473).
 * Accepte les requêtes POST /inject depuis l'extension Chrome BIAIF et :
 *   1. Écrit le prompt markdown dans le presse-papier (Ctrl+V dans Claude Code).
 *   2. Sauvegarde chaque image en fichier PNG temporaire.
 *   3. Affiche une notification avec des actions rapides.
 *   4. Tente de coller directement dans le terminal actif (Claude Code CLI).
 */

const vscode = require('vscode');
const http   = require('http');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

let server      = null;
let statusBar   = null;
let lastImages  = [];   // paths of last received images (for showLastImages command)

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
      if (!lastImages.length) { vscode.window.showInformationMessage('BIAIF : aucune image reçue pour l\'instant.'); return; }
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
    // CORS — allow requests from the Chrome extension and localhost
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
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body);
          const result  = await handleInject(payload);
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
    if (e.code === 'EADDRINUSE') {
      vscode.window.showWarningMessage(
        'BIAIF Bridge : port ' + port + ' déjà utilisé. Changez `biaif.bridgePort` dans les paramètres.',
      );
    } else {
      vscode.window.showErrorMessage('BIAIF Bridge erreur : ' + e.message);
    }
    _updateStatusBar(false);
  });

  server.listen(port, '127.0.0.1', () => {
    _updateStatusBar(true, port);
  });

  if (context) context.subscriptions.push({ dispose: stopBridge });
}

function stopBridge() {
  if (!server) return;
  server.close();
  server = null;
  _updateStatusBar(false);
}

// ---------------------------------------------------------------------------
// Injection handler
// ---------------------------------------------------------------------------

async function handleInject(payload) {
  const { text, images } = payload;
  const cfg     = vscode.workspace.getConfiguration('biaif');
  const tmpBase = cfg.get('tempDir', '') || path.join(os.tmpdir(), 'biaif-inject');

  // 1. Write text to clipboard
  if (text) {
    await vscode.env.clipboard.writeText(text);
  }

  // 2. Save images to temp directory
  if (!fs.existsSync(tmpBase)) fs.mkdirSync(tmpBase, { recursive: true });
  const now = Date.now();
  const savedPaths = [];

  for (let i = 0; i < (images || []).length; i++) {
    const dataUrl = images[i];
    const comma   = dataUrl.indexOf(',');
    if (comma < 0) continue;
    const buf      = Buffer.from(dataUrl.slice(comma + 1), 'base64');
    const filePath = path.join(tmpBase, 'biaif-' + now + '-' + (i + 1) + '.png');
    fs.writeFileSync(filePath, buf);
    savedPaths.push(filePath);
  }

  lastImages = savedPaths;

  // 3. Build notification message
  const imgPart = savedPaths.length
    ? ' + ' + savedPaths.length + ' image(s) sauvegardée(s)'
    : '';
  const msg = 'BIAIF : prompt dans le presse-papier' + imgPart + '.';

  const actions = ['Coller dans terminal'];
  if (savedPaths.length) actions.push('Ouvrir images');

  const choice = await vscode.window.showInformationMessage(msg, ...actions);

  // 4. Coller dans terminal (Claude Code CLI ou autre)
  if (choice === 'Coller dans terminal') {
    const terminal = vscode.window.activeTerminal
      || vscode.window.createTerminal({ name: 'BIAIF' });
    terminal.show(true);
    if (text) terminal.sendText(text, false); // false = no auto newline, user confirms
  }

  // 5. Ouvrir images dans VS Code
  if (choice === 'Ouvrir images') {
    for (const p of savedPaths) {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(p));
    }
  }

  return { ok: true, text: !!text, images: savedPaths.length, tmpDir: tmpBase };
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function _updateStatusBar(active, port) {
  if (!statusBar) {
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    statusBar.command = 'biaif.toggleBridge';
  }
  if (active) {
    statusBar.text        = '$(plug) BIAIF';
    statusBar.tooltip     = 'BIAIF Bridge actif — port ' + port + '\nCliquer pour désactiver';
    statusBar.color       = '#4ec9b0';
    statusBar.show();
  } else {
    statusBar.text        = '$(circle-slash) BIAIF';
    statusBar.tooltip     = 'BIAIF Bridge inactif\nCliquer pour activer';
    statusBar.color       = undefined;
    statusBar.show();
  }
}

// ---------------------------------------------------------------------------

function deactivate() { stopBridge(); }

module.exports = { activate, deactivate };
