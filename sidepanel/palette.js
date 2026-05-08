// @ts-check
/**
 * BIAIF Command Palette — Cmd+K (or Ctrl+K) on any sidepanel page.
 *
 * Single launcher for every action a power user wants to reach without
 * mouse: insert a template, switch theme, open an AI target, jump to
 * settings, run a session command. Inspired by Linear / Raycast.
 *
 * Sources of commands:
 *   - Templates  (window.BIAIFTemplates.list())
 *   - AI targets (window.BIAIF.AI_TARGETS, opens a new tab to the host)
 *   - Built-in commands  (toggle theme, save, disarm, copy prompt, …)
 *
 * Public API:
 *   BIAIFPalette.open()   → show overlay
 *   BIAIFPalette.close()  → hide
 *   BIAIFPalette.init()   → bind global Cmd+K shortcut
 *
 * Keyboard:
 *   ↑ ↓     navigate
 *   Enter   run
 *   Esc     close
 *   typing  fuzzy filter (substring match per word)
 */
(function (window) {
  'use strict';

  /** @type {HTMLElement|null} */ var _overlay = null;
  /** @type {HTMLElement|null} */ var _input   = null;
  /** @type {HTMLElement|null} */ var _list    = null;
  /** @type {Array<{id:string,label:string,hint?:string,kind:string,run:() => void}>} */
  var _commands = [];
  var _filtered = [];
  var _selected = 0;

  function _t(k, fb, vars) {
    var U = window.BIAIF && window.BIAIF.utils;
    return (U && U.t) ? U.t(k, fb, vars) : (fb || k);
  }

  function _buildCommands() {
    var out = [];
    var T = window.BIAIFTemplates;
    var S = window.BIAIFSession;

    // 1) Built-ins (always available)
    if (S) {
      out.push({ id: 'cmd.save',     kind: 'cmd', label: _t('palette.cmd.save', 'Enregistrer la demande courante'),
        hint: 'Enter', run: function () { S.finalizeDemande(false); } });
      out.push({ id: 'cmd.new',      kind: 'cmd', label: _t('palette.cmd.new', 'Nouvelle conversation'),
        run: function () {
          var btn = document.querySelector('[data-act="new-conv"]');
          if (btn) btn.click();
        } });
      out.push({ id: 'cmd.disarm',   kind: 'cmd', label: _t('palette.cmd.disarm', "Retour à l'historique"),
        run: function () { if (S.disarm) S.disarm(); } });
    }
    if (window.BIAIFExport && window.BIAIFExport.copyPrompt) {
      out.push({ id: 'cmd.copy',     kind: 'cmd', label: _t('palette.cmd.copy', 'Copier le prompt complet'),
        hint: 'Alt+Shift+C', run: function () { window.BIAIFExport.copyPrompt(); } });
    }
    out.push({ id: 'cmd.theme.dark',  kind: 'cmd', label: _t('palette.cmd.theme_dark',  'Thème sombre'),  run: function () { _setTheme('dark'); } });
    out.push({ id: 'cmd.theme.light', kind: 'cmd', label: _t('palette.cmd.theme_light', 'Thème clair'),   run: function () { _setTheme('light'); } });
    out.push({ id: 'cmd.theme.auto',  kind: 'cmd', label: _t('palette.cmd.theme_auto',  'Thème auto (OS)'), run: function () { _setTheme('auto'); } });
    out.push({ id: 'cmd.settings',   kind: 'cmd', label: _t('palette.cmd.settings', 'Ouvrir les réglages'),
      run: function () {
        var btn = document.querySelector('[data-act="toggle-settings"]');
        if (btn) btn.click();
      } });
    out.push({ id: 'cmd.search',     kind: 'cmd', label: _t('palette.cmd.search', "Rechercher dans l'historique"),
      run: function () {
        var btn = document.querySelector('[data-act="search-toggle"]');
        if (btn) btn.click();
      } });

    // 2) Templates — insert into the editor with full {{var}} interpolation.
    if (T && typeof T.list === 'function') {
      T.list().forEach(function (tpl) {
        out.push({
          id: 'tpl.' + tpl.id, kind: 'template',
          label: tpl.name || _t('palette.template.unnamed', '(sans nom)'),
          hint: (tpl.body || '').slice(0, 60).replace(/\s+/g, ' '),
          run: function () { T.insertIntoEditor(tpl.id); },
        });
      });
    }

    // 3) AI targets — open in a new tab + copy prompt to clipboard.
    var AI = (window.BIAIF && window.BIAIF.AI_TARGETS) || [];
    AI.forEach(function (t) {
      out.push({
        id: 'ai.' + t.key, kind: 'ai',
        label: _t('palette.ai.open', 'Ouvrir dans {name}', { name: t.label }).replace('{name}', t.label),
        hint: t.webUrl,
        run: function () {
          var fn = window.BIAIFExport && window.BIAIFExport[t.exportFn];
          if (typeof fn === 'function') fn(); else if (t.webUrl) window.open(t.webUrl, '_blank');
        },
      });
    });

    return out;
  }

  function _setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var ctx = window.BIAIFRender && window.BIAIFRender.ctx;
    if (ctx && ctx.STATE) {
      ctx.STATE.theme = t;
      if (window.BIAIFStorage) window.BIAIFStorage.persist(ctx.STATE);
    }
    // Sync the settings picker chips if visible.
    document.querySelectorAll('.sp-theme-btn').forEach(function (b) {
      var match = b.dataset.theme === t;
      b.classList.toggle('is-active', match);
      b.setAttribute('aria-checked', match ? 'true' : 'false');
    });
  }

  // Tiny fuzzy match: every space-separated token must appear (substring,
  // case-insensitive) somewhere in label+hint. Score = match positions sum.
  function _filter(query) {
    var q = (query || '').trim().toLowerCase();
    if (!q) return _commands.slice(0, 12);
    var tokens = q.split(/\s+/);
    var hits = [];
    for (var i = 0; i < _commands.length; i++) {
      var c = _commands[i];
      var hay = (c.label + ' ' + (c.hint || '')).toLowerCase();
      var score = 0;
      var ok = true;
      for (var j = 0; j < tokens.length; j++) {
        var p = hay.indexOf(tokens[j]);
        if (p < 0) { ok = false; break; }
        score += p;
      }
      if (ok) hits.push({ c: c, score: score });
    }
    hits.sort(function (a, b) { return a.score - b.score; });
    return hits.slice(0, 20).map(function (h) { return h.c; });
  }

  function _render() {
    if (!_list) return;
    _list.innerHTML = '';
    if (!_filtered.length) {
      var empty = document.createElement('div');
      empty.className = 'biaif-palette-empty';
      empty.textContent = _t('palette.empty', 'Aucun résultat');
      _list.appendChild(empty);
      return;
    }
    _filtered.forEach(function (cmd, i) {
      var row = document.createElement('div');
      row.className = 'biaif-palette-row' + (i === _selected ? ' is-selected' : '');
      row.setAttribute('role', 'option');
      row.dataset.idx = String(i);
      var kindBadge = document.createElement('span');
      kindBadge.className = 'biaif-palette-kind biaif-palette-kind--' + cmd.kind;
      kindBadge.textContent = cmd.kind === 'template' ? '📝' : (cmd.kind === 'ai' ? '🤖' : '⚡');
      var label = document.createElement('span');
      label.className = 'biaif-palette-label';
      label.textContent = cmd.label;
      row.appendChild(kindBadge);
      row.appendChild(label);
      if (cmd.hint) {
        var hint = document.createElement('span');
        hint.className = 'biaif-palette-hint';
        hint.textContent = cmd.hint;
        row.appendChild(hint);
      }
      row.addEventListener('mouseenter', function () { _selected = i; _render(); });
      row.addEventListener('click', function () { _run(i); });
      _list.appendChild(row);
    });
  }

  function _run(i) {
    var cmd = _filtered[i];
    if (!cmd) return;
    close();
    try { cmd.run(); } catch (e) { console.warn('[BIAIF Palette] run failed', e); }
  }

  function _onKeydown(e) {
    if (!_overlay) return;
    if (e.key === 'Escape')      { e.preventDefault(); close(); return; }
    if (e.key === 'Enter')       { e.preventDefault(); _run(_selected); return; }
    if (e.key === 'ArrowDown')   { e.preventDefault(); _selected = Math.min(_filtered.length - 1, _selected + 1); _render(); return; }
    if (e.key === 'ArrowUp')     { e.preventDefault(); _selected = Math.max(0, _selected - 1); _render(); return; }
  }

  function open() {
    if (_overlay) return;
    _commands = _buildCommands();
    _filtered = _commands.slice(0, 12);
    _selected = 0;
    _overlay = document.createElement('div');
    _overlay.className = 'biaif-palette-overlay';
    _overlay.setAttribute('role', 'dialog');
    _overlay.setAttribute('aria-modal', 'true');
    _overlay.setAttribute('aria-label', _t('palette.aria', 'Palette de commandes'));
    var box = document.createElement('div');
    box.className = 'biaif-palette';
    _input = document.createElement('input');
    _input.className = 'biaif-palette-input';
    _input.type = 'search';
    _input.placeholder = _t('palette.placeholder', 'Tapez une commande, un modèle ou une IA…');
    _input.setAttribute('aria-controls', 'biaif-palette-list');
    _input.setAttribute('aria-autocomplete', 'list');
    _input.addEventListener('input', function () {
      _filtered = _filter(_input ? _input.value : '');
      _selected = 0;
      _render();
    });
    _list = document.createElement('div');
    _list.className = 'biaif-palette-list';
    _list.id = 'biaif-palette-list';
    _list.setAttribute('role', 'listbox');
    box.appendChild(_input);
    box.appendChild(_list);
    _overlay.appendChild(box);
    _overlay.addEventListener('click', function (e) { if (e.target === _overlay) close(); });
    document.body.appendChild(_overlay);
    document.addEventListener('keydown', _onKeydown, true);
    _render();
    setTimeout(function () { if (_input) _input.focus(); }, 30);
  }

  function close() {
    if (!_overlay) return;
    document.removeEventListener('keydown', _onKeydown, true);
    if (_overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = _input = _list = null;
  }

  function init() {
    document.addEventListener('keydown', function (e) {
      var meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (_overlay) close(); else open();
      }
    });
  }

  window.BIAIFPalette = { open: open, close: close, init: init };
})(window);
