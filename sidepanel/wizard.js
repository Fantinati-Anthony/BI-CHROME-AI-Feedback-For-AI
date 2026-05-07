/**
 * BIAIF Wizard — First-launch onboarding (5 steps)
 * Storage key versioned so a future update can re-trigger the wizard.
 */
(function (window) {
  'use strict';

  var DONE_KEY    = 'biaif:wizard-v1';
  var _overlay    = null;
  var _curStep    = 0;

  var STEPS = [
    { id: 'welcome', fn: _stepWelcome },
    { id: 'flow',    fn: _stepFlow    },
    { id: 'tools',   fn: _stepTools   },
    { id: 'export',  fn: _stepExport  },
    { id: 'ready',   fn: _stepReady   },
  ];

  // ── Public ─────────────────────────────────────────────────────

  function init() {
    chrome.storage.local.get(DONE_KEY, function (obj) {
      if (!obj[DONE_KEY]) _show();
    });
  }

  function open() { _show(); }

  // ── Build overlay ──────────────────────────────────────────────

  function _show() {
    if (_overlay) return;
    _curStep = 0;

    _overlay = document.createElement('div');
    _overlay.className = 'biaif-wizard';
    _overlay.setAttribute('role', 'dialog');
    _overlay.setAttribute('aria-modal', 'true');
    _overlay.setAttribute('aria-label', 'Guide de démarrage BIAIF');

    var dots = STEPS.map(function (_, i) {
      return '<button class="wiz-dot" data-s="' + i + '" aria-label="Étape ' + (i + 1) + ' sur ' + STEPS.length + '"></button>';
    }).join('');

    _overlay.innerHTML =
      '<div class="wiz-panel">' +
        '<div class="wiz-header">' +
          '<div class="wiz-dots">' + dots + '</div>' +
          '<button class="wiz-skip">Passer</button>' +
        '</div>' +
        '<div class="wiz-body"></div>' +
        '<div class="wiz-footer">' +
          '<button class="wiz-btn wiz-btn-back" hidden>← Retour</button>' +
          '<button class="wiz-btn wiz-btn-next">Suivant →</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(_overlay);
    _renderStep(0, true);
    requestAnimationFrame(function () { _overlay.classList.add('is-visible'); });
  }

  // ── Navigation ─────────────────────────────────────────────────

  function _renderStep(idx, initial) {
    var body = _overlay.querySelector('.wiz-body');
    var back = _overlay.querySelector('.wiz-btn-back');
    var next = _overlay.querySelector('.wiz-btn-next');
    var last = STEPS.length - 1;

    var dir  = (!initial && idx > _curStep) ? 'fwd' : (!initial && idx < _curStep) ? 'bwd' : 'fwd';
    _curStep = idx;

    // Dots
    _overlay.querySelectorAll('.wiz-dot').forEach(function (d, i) {
      d.classList.toggle('is-on', i === idx);
      d.onclick = function () { _renderStep(Number(d.dataset.s), false); };
    });

    // Buttons
    if (back) {
      back.hidden  = (idx === 0);
      back.onclick = function () { _renderStep(_curStep - 1, false); };
    }
    if (next) {
      var isDone = idx === last;
      next.textContent = isDone ? '✓ Commencer' : 'Suivant →';
      next.classList.toggle('wiz-btn-done', isDone);
      next.onclick = function () { isDone ? _done() : _renderStep(_curStep + 1, false); };
    }
    _overlay.querySelector('.wiz-skip').onclick = _done;

    // Animate + render
    body.classList.remove('wiz-anim-fwd', 'wiz-anim-bwd');
    body.innerHTML = STEPS[idx].fn();
    requestAnimationFrame(function () { body.classList.add('wiz-anim-' + dir); });
  }

  function _done() {
    chrome.storage.local.set({ [DONE_KEY]: true });
    _overlay.classList.remove('is-visible');
    _overlay.classList.add('is-out');
    setTimeout(function () {
      if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
      _overlay = null;
    }, 320);
  }

  // ── Step 0 : Welcome ───────────────────────────────────────────

  function _stepWelcome() {
    return (
      '<div class="wiz-step wiz-step-welcome">' +
        '<div class="wiz-orb wiz-orb-blue" aria-hidden="true">' +
          _svg('<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>', 52) +
        '</div>' +
        '<h1 class="wiz-h1">Bienvenue dans <em>BIAIF</em></h1>' +
        '<p class="wiz-sub">BI · Chrome · AI · Feedback</p>' +
        '<p class="wiz-desc">Capturez vos idées, bugs et retours directement depuis le navigateur et transmettez-les à votre IA — avec texte, captures d\'écran et contexte HTML.</p>' +
        '<div class="wiz-chips">' +
          '<span class="wiz-chip wiz-chip-blue">Claude Code</span>' +
          '<span class="wiz-chip wiz-chip-teal">VS Code</span>' +
          '<span class="wiz-chip wiz-chip-purple">Copilot</span>' +
        '</div>' +
      '</div>'
    );
  }

  // ── Step 1 : How it works ──────────────────────────────────────

  function _stepFlow() {
    var items = [
      { n: 1, c: 'blue',   title: 'Démarrez',       desc: 'Cliquez "Démarrer" — micro et sélecteur s\'activent' },
      { n: 2, c: 'purple', title: 'Exprimez-vous',   desc: 'Parlez ou tapez votre instruction naturellement' },
      { n: 3, c: 'pink',   title: 'Ciblez & capturez', desc: 'Pointez un élément, prenez une capture ou ajoutez une erreur JS' },
      { n: 4, c: 'amber',  title: 'Exportez',        desc: 'Injectez dans votre IA ou copiez le prompt formaté' },
    ];
    var rows = items.map(function (it) {
      return '<li class="wiz-flow-row wiz-flow-' + it.c + '">' +
        '<span class="wiz-flow-num">' + it.n + '</span>' +
        '<div><strong>' + it.title + '</strong><span>' + it.desc + '</span></div>' +
      '</li>';
    }).join('');
    return '<div class="wiz-step"><h2 class="wiz-h2">Comment ça marche</h2><ol class="wiz-flow-list">' + rows + '</ol></div>';
  }

  // ── Step 2 : Capture tools ─────────────────────────────────────

  function _stepTools() {
    var tools = [
      { label: 'Micro',      desc: 'Dictée vocale multilingue',         path: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>' },
      { label: 'Sélecteur',  desc: 'Pointez un élément → récupère selector, tag, texte, HTML', path: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>' },
      { label: 'Capture',    desc: '4 modes : visible, sélection, élément, pleine page',       path: '<rect width="18" height="18" x="3" y="3" rx="2"/><line x1="3" x2="21" y1="9" y2="9"/>' },
      { label: 'Fichier',    desc: 'Importez une image ou glissez-déposez',                    path: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>' },
      { label: 'Erreurs JS', desc: 'Capture les erreurs console de la page active',            path: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>' },
    ];
    var rows = tools.map(function (t) {
      return '<li class="wiz-tool-row">' +
        '<span class="wiz-tool-icon">' + _svg(t.path, 18) + '</span>' +
        '<div><strong>' + t.label + '</strong><span>' + t.desc + '</span></div>' +
      '</li>';
    }).join('');
    return '<div class="wiz-step"><h2 class="wiz-h2">Outils de capture</h2><ul class="wiz-tool-list">' + rows + '</ul></div>';
  }

  // ── Step 3 : Export destinations ──────────────────────────────

  function _stepExport() {
    var dests = [
      { c: 'gray',   label: 'Copier',   desc: 'Prompt Markdown dans le presse-papier' },
      { c: 'purple', label: 'Injecter', desc: 'Directement dans l\'éditeur Claude.ai (texte + images)' },
      { c: 'teal',   label: 'VS Code',  desc: 'Bridge local → terminal Claude Code CLI' },
      { c: 'indigo', label: 'Copilot',  desc: 'GitHub Copilot Chat (texte pré-rempli + fichiers joints)' },
      { c: 'muted',  label: '.MD',      desc: 'Archive : fichier Markdown + captures PNG' },
    ];
    var rows = dests.map(function (d) {
      return '<li class="wiz-export-row">' +
        '<span class="wiz-badge wiz-badge-' + d.c + '">' + d.label + '</span>' +
        '<span class="wiz-export-desc">' + d.desc + '</span>' +
      '</li>';
    }).join('');
    return (
      '<div class="wiz-step">' +
        '<h2 class="wiz-h2">Export vers votre IA</h2>' +
        '<ul class="wiz-export-list">' + rows + '</ul>' +
        '<div class="wiz-tip">💡 Activez ou désactivez chaque bouton dans <strong>⚙ Réglages → Boutons d\'export</strong></div>' +
      '</div>'
    );
  }

  // ── Step 4 : Ready ─────────────────────────────────────────────

  function _stepReady() {
    var recap = [
      { icon: '▶', text: 'Cliquez <strong>Démarrer</strong> pour activer la session' },
      { icon: '⚙', text: 'Configurez la langue et les boutons dans <strong>Réglages</strong>' },
      { icon: '⌨', text: '<code>Alt+Shift+M</code> micro &nbsp;·&nbsp; <code>Alt+Shift+C</code> copier' },
      { icon: '↩', text: 'Retrouvez ce guide : <strong>⚙ Réglages → Revoir le guide</strong>' },
    ];
    var rows = recap.map(function (r) {
      return '<li><span>' + r.icon + '</span><span>' + r.text + '</span></li>';
    }).join('');
    return (
      '<div class="wiz-step wiz-step-ready">' +
        '<div class="wiz-orb wiz-orb-green" aria-hidden="true">' +
          _svg('<circle cx="12" cy="12" r="10"/><polyline points="9 11 12 14 22 4"/>', 52) +
        '</div>' +
        '<h1 class="wiz-h1">Vous êtes prêt !</h1>' +
        '<ul class="wiz-recap">' + rows + '</ul>' +
      '</div>'
    );
  }

  // ── Helpers ────────────────────────────────────────────────────

  function _svg(path, size) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  window.BIAIFWizard = { init: init, open: open };

})(window);
