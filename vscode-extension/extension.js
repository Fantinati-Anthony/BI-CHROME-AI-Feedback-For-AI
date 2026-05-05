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
// ---------------------------------------------------------------------------

async function handleInjectCopilot(payload) {
  const { text, images } = payload;
  const { saved, tmpBase } = _saveImages(images);

  // ── 1. Inject text into Copilot Chat ────────────────────────────────────
  // Try each command in order, stop at first success.
  // isPartialQuery: true → text appears in the input but is NOT auto-sent.
  let textMethod = null;

  const chatCandidates = [
    // VS Code Chat API (1.90+) — works with Copilot since it's the panel host
    () => vscode.commands.executeCommand('workbench.action.chat.open', {
            query: text, isPartialQuery: true }),
    // GitHub Copilot specific (older versions)
    () => vscode.commands.executeCommand('github.copilot.chat.open', { message: text }),
    // Copilot inline chat
    () => vscode.commands.executeCommand('inlineChat.start', { query: text }),
  ];

  for (const attempt of chatCandidates) {
    try { await attempt(); textMethod = attempt; break; } catch (_) {}
  }

  // Fallback: clipboard + focus panel + native Ctrl+V simulation
  if (!textMethod) {
    if (text) await vscode.env.clipboard.writeText(text);

    // Focus the Copilot Chat input (try several command IDs)
    const focusCandidates = [
      'workbench.panel.chat.view.copilot.focus',
      'github.copilot.chat.focus',
      'workbench.action.chat.open',
    ];
    for (const cmd of focusCandidates) {
      try { await vscode.commands.executeCommand(cmd); break; } catch (_) {}
    }

    // Give VS Code time to focus the chat input, then simulate Ctrl+V
    // so the text lands directly in the field without user interaction.
    await _sleep(400);
    await _simulatePaste();
  }

  // ── 2. Attach images ────────────────────────────────────────────────────
  const attached = [];
  for (const filePath of saved) {
    const uri = vscode.Uri.file(filePath);

    // VS Code Chat attachment commands (1.94+ or Copilot extension)
    const attachCandidates = [
      () => vscode.commands.executeCommand('workbench.action.chat.attachFile', uri),
      () => vscode.commands.executeCommand('workbench.action.chat.attachContext',
              { uri, kind: 'file' }),
      () => vscode.commands.executeCommand('github.copilot.chat.attachFile', uri),
    ];

    let ok = false;
    for (const attempt of attachCandidates) {
      try { await attempt(); ok = true; break; } catch (_) {}
    }

    if (ok) {
      attached.push(filePath);
    } else {
      // Fallback: open file in editor (user drags the tab/thumbnail to chat)
      try { await vscode.commands.executeCommand('vscode.open', uri); } catch (_) {}
    }
  }

  // ── 3. Notification ─────────────────────────────────────────────────────
  const notAttached = saved.length - attached.length;
  let msg = 'BIAIF → Copilot : texte pré-rempli';
  if (attached.length)   msg += ', ' + attached.length + ' image(s) jointe(s)';
  if (notAttached > 0)   msg += ' (' + notAttached + ' image(s) ouverte(s) — glissez-les dans le chat)';
  msg += '.';

  const actions = notAttached > 0 ? ['Aide'] : [];
  const choice  = await vscode.window.showInformationMessage(msg, ...actions);

  if (choice === 'Aide') {
    vscode.window.showInformationMessage(
      'Pour attacher une image au chat Copilot : glissez le fichier depuis l\'Explorateur ' +
      '(ou depuis l\'onglet ouvert) dans le champ texte du chat. ' +
      'Les images sont dans : ' + tmpBase,
      { modal: true },
    );
  }

  return {
    ok: true,
    text: !!text,
    textMethod: textMethod ? 'command' : 'clipboard',
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
