/**
 * BIAIF Wizard — First-launch onboarding (6 steps, 2 interactive)
 * Storage key versioned so a future update can re-trigger the wizard.
 */
(function (window) {
  'use strict';

  var DONE_KEY   = 'biaif:wizard-v1';
  var _overlay   = null;
  var _curStep   = 0;
  var _STATE     = null;
  var _persistFn = null;

  var STEPS = [
    { id: 'welcome',    fn: _stepWelcome    },
    { id: 'flow',       fn: _stepFlow       },
    { id: 'tools',      fn: _stepTools      },
    { id: 'lang',       fn: _stepLang       },
    { id: 'theme',      fn: _stepTheme      },
    { id: 'templates',  fn: _stepTemplates  },
    { id: 'privacy',    fn: _stepPrivacy    },
    { id: 'shortcuts',  fn: _stepShortcuts  },
    { id: 'export',     fn: _stepExport     },
    { id: 'ready',      fn: _stepReady      },
  ];

  // ── Public ─────────────────────────────────────────────────────

  function init(state, persistFn) {
    _STATE     = state     || null;
    _persistFn = persistFn || null;
    chrome.storage.local.get(DONE_KEY, function (obj) {
      if (!obj[DONE_KEY]) _show();
    });
  }

  function open(state, persistFn) {
    _STATE     = state     || null;
    _persistFn = persistFn || null;
    _show();
  }

  // ── Build overlay ──────────────────────────────────────────────

  function _t(key, fallback) {
    return (window.BIAIFi18n ? window.BIAIFi18n.t(key) : null) || fallback || key;
  }

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
          '<button class="wiz-skip">' + _t('wizard.nav.skip', 'Passer') + '</button>' +
        '</div>' +
        '<div class="wiz-body"></div>' +
        '<div class="wiz-footer">' +
          '<button class="wiz-btn wiz-btn-back" hidden>' + _t('wizard.nav.back', '← Retour') + '</button>' +
          '<button class="wiz-btn wiz-btn-next">' + _t('wizard.nav.next', 'Suivant →') + '</button>' +
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

    var dir = (!initial && idx > _curStep) ? 'fwd' : (!initial && idx < _curStep) ? 'bwd' : 'fwd';
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
      next.textContent = isDone ? _t('wizard.nav.done', '✓ Commencer') : _t('wizard.nav.next', 'Suivant →');
      next.classList.toggle('wiz-btn-done', isDone);
      next.onclick = function () { isDone ? _done() : _renderStep(_curStep + 1, false); };
    }
    _overlay.querySelector('.wiz-skip').onclick = _done;

    // Animate + render
    body.classList.remove('wiz-anim-fwd', 'wiz-anim-bwd');
    body.innerHTML = STEPS[idx].fn();
    _bindStep(idx);
    requestAnimationFrame(function () { body.classList.add('wiz-anim-' + dir); });
  }

  // ── Bind interactive step events ───────────────────────────────

  function _bindStep(idx) {
    var id = STEPS[idx].id;

    if (id === 'lang') {
      _overlay.querySelectorAll('.wiz-lang-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          _overlay.querySelectorAll('.wiz-lang-btn').forEach(function (b) {
            b.classList.remove('is-active');
          });
          btn.classList.add('is-active');
          if (_STATE) {
            _STATE.lang = btn.dataset.lang;
            // Sync with the main settings select
            var sel = document.querySelector('select[name="lang"]');
            if (sel) sel.value = _STATE.lang;
          }
        });
      });
    }

    if (id === 'theme') {
      _overlay.querySelectorAll('[data-pick-theme]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var t = btn.dataset.pickTheme;
          _overlay.querySelectorAll('[data-pick-theme]').forEach(function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
          if (_STATE) _STATE.theme = t;
          document.documentElement.setAttribute('data-theme', t);
          var spBtn = document.querySelector('.sp-theme-btn[data-theme="' + t + '"]');
          if (spBtn) {
            spBtn.parentNode.querySelectorAll('.sp-theme-btn').forEach(function (x) {
              x.classList.toggle('is-active', x === spBtn);
              x.setAttribute('aria-checked', x === spBtn ? 'true' : 'false');
            });
          }
        });
      });
    }

    if (id === 'export') {
      _overlay.querySelectorAll('.wiz-toggle-list input[type="checkbox"]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          if (_STATE && _STATE.visibleButtons) {
            _STATE.visibleButtons[cb.dataset.key] = cb.checked;
            // Sync with the settings panel checkboxes
            var spCb = document.getElementById('vis-' + cb.dataset.key);
            if (spCb) spCb.checked = cb.checked;
          }
        });
      });
    }
  }

  // ── Done ───────────────────────────────────────────────────────

  function _done() {
    chrome.storage.local.set({ [DONE_KEY]: true });
    if (_persistFn) _persistFn();
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
        '<h1 class="wiz-h1">' + _t('wizard.welcome.title', 'Bienvenue dans') + ' <em>BIAIF</em></h1>' +
        '<p class="wiz-sub">' + _t('wizard.welcome.sub', 'BI · Chrome · AI · Feedback') + '</p>' +
        '<p class="wiz-desc">' + _t('wizard.welcome.desc', "Capturez vos idées, bugs et retours directement depuis le navigateur et transmettez-les à votre IA — avec texte, captures d'écran et contexte HTML.") + '</p>' +
        '<div class="wiz-chips">' +
          '<span class="wiz-chip wiz-chip-blue">Claude Code</span>' +
          '<span class="wiz-chip wiz-chip-teal">' + _t('btn.vscode', 'VS-Code Terminal') + '</span>' +
          '<span class="wiz-chip wiz-chip-purple">' + _t('btn.copilot', 'VS-Code GH for Copilot') + '</span>' +
        '</div>' +
      '</div>'
    );
  }

  // ── Step 1 : How it works ──────────────────────────────────────

  function _stepFlow() {
    var items = [
      { n: 1, c: 'blue',   title: _t('wizard.flow.step1_title', 'Démarrez'),         desc: _t('wizard.flow.step1_desc', 'Cliquez "Démarrer" — micro et sélecteur s\'activent') },
      { n: 2, c: 'purple', title: _t('wizard.flow.step2_title', 'Exprimez-vous'),     desc: _t('wizard.flow.step2_desc', 'Parlez ou tapez votre instruction naturellement') },
      { n: 3, c: 'pink',   title: _t('wizard.flow.step3_title', 'Ciblez & capturez'), desc: _t('wizard.flow.step3_desc', 'Pointez un élément, prenez une capture ou ajoutez une erreur JS') },
      { n: 4, c: 'amber',  title: _t('wizard.flow.step4_title', 'Exportez'),          desc: _t('wizard.flow.step4_desc', 'Injectez dans votre IA ou copiez le prompt formaté') },
    ];
    var rows = items.map(function (it) {
      return '<li class="wiz-flow-row wiz-flow-' + it.c + '">' +
        '<span class="wiz-flow-num">' + it.n + '</span>' +
        '<div><strong>' + it.title + '</strong><span>' + it.desc + '</span></div>' +
      '</li>';
    }).join('');
    return '<div class="wiz-step"><h2 class="wiz-h2">' + _t('wizard.flow.title', 'Comment ça marche') + '</h2><ol class="wiz-flow-list">' + rows + '</ol></div>';
  }

  // ── Step 2 : Capture tools ─────────────────────────────────────

  function _stepTools() {
    var tools = [
      { label: _t('wizard.tools.mic_label', 'Micro'),      desc: _t('wizard.tools.mic_desc', 'Dictée vocale multilingue'),                                    path: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>' },
      { label: _t('wizard.tools.picker_label', 'Sélecteur'),  desc: _t('wizard.tools.picker_desc', 'Pointez un élément → selector, tag, texte, HTML'),             path: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>' },
      { label: _t('wizard.tools.capture_label', 'Capture'),    desc: _t('wizard.tools.capture_desc', '4 modes : visible, sélection, élément, pleine page'),           path: '<rect width="18" height="18" x="3" y="3" rx="2"/><line x1="3" x2="21" y1="9" y2="9"/>' },
      { label: _t('wizard.tools.file_label', 'Fichier'),    desc: _t('wizard.tools.file_desc', 'Importez une image ou glissez-déposez'),                        path: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>' },
      { label: _t('wizard.tools.errors_label', 'Erreurs JS'), desc: _t('wizard.tools.errors_desc', 'Capture les erreurs console de la page active'),                path: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>' },
    ];
    var rows = tools.map(function (t) {
      return '<li class="wiz-tool-row">' +
        '<span class="wiz-tool-icon">' + _svg(t.path, 18) + '</span>' +
        '<div><strong>' + t.label + '</strong><span>' + t.desc + '</span></div>' +
      '</li>';
    }).join('');
    return '<div class="wiz-step"><h2 class="wiz-h2">' + _t('wizard.tools.title', 'Outils de capture') + '</h2><ul class="wiz-tool-list">' + rows + '</ul></div>';
  }

  // ── Step 3 : Language selection (interactive) ──────────────────

  function _stepLang() {
    var currentLang = (_STATE && _STATE.lang) ? _STATE.lang : 'fr-FR';
    var langs = [
      { code: 'fr-FR', flag: '🇫🇷', name: 'Français'      },
      { code: 'en-US', flag: '🇺🇸', name: 'English (US)'  },
      { code: 'en-GB', flag: '🇬🇧', name: 'English (UK)'  },
      { code: 'es-ES', flag: '🇪🇸', name: 'Español'       },
      { code: 'de-DE', flag: '🇩🇪', name: 'Deutsch'       },
      { code: 'it-IT', flag: '🇮🇹', name: 'Italiano'      },
      { code: 'pt-BR', flag: '🇧🇷', name: 'Português'     },
      { code: 'nl-NL', flag: '🇳🇱', name: 'Nederlands'    },
    ];
    var buttons = langs.map(function (l) {
      var active = l.code === currentLang ? ' is-active' : '';
      return (
        '<button class="wiz-lang-btn' + active + '" data-lang="' + l.code + '" type="button">' +
          '<span class="wiz-lang-flag">' + l.flag + '</span>' +
          '<span class="wiz-lang-name">' + l.name + '</span>' +
        '</button>'
      );
    }).join('');
    return (
      '<div class="wiz-step">' +
        '<h2 class="wiz-h2">' + _t('wizard.lang.title', 'Langue de reconnaissance vocale') + '</h2>' +
        '<p class="wiz-step-desc">' + _t('wizard.lang.desc', 'Quelle langue utiliserez-vous principalement pour dicter vos instructions ?') + '</p>' +
        '<div class="wiz-lang-grid">' + buttons + '</div>' +
        '<p class="wiz-step-hint">' + _t('wizard.lang.hint', 'Modifiable à tout moment dans ⚙ Réglages → Reconnaissance vocale.') + '</p>' +
      '</div>'
    );
  }

  // ── Step 4 : Export buttons (interactive toggles) ──────────────

  function _stepExport() {
    var VB = (_STATE && _STATE.visibleButtons) ? _STATE.visibleButtons : {};
    var btns = [
      { key: 'inject',        c: 'purple', label: _t('btn.inject', 'Injecter'),               desc: _t('wizard.export.inject_desc', 'Injection directe dans Claude.ai (texte + images)') },
      { key: 'vscode',        c: 'teal',   label: _t('btn.vscode', 'VS-Code Terminal'),       desc: _t('wizard.export.vscode_desc', 'Bridge local → terminal Claude Code CLI') },
      { key: 'copilot',       c: 'indigo', label: _t('btn.copilot', 'VS-Code GH for Copilot'), desc: _t('wizard.export.copilot_desc', 'GitHub Copilot Chat (texte + fichiers joints)') },
      { key: 'copy',          c: 'gray',   label: _t('btn.copy', 'Copier'),                   desc: _t('wizard.export.copy_desc', 'Prompt Markdown dans le presse-papier') },
      { key: 'download',      c: 'muted',  label: _t('btn.download', '.MD'),                  desc: _t('wizard.export.download_desc', 'Archive Markdown + captures PNG') },
      { key: 'claude_online', c: 'gray',   label: _t('btn.claude_online', 'Claude.ai'),       desc: _t('wizard.export.online_desc', 'Copie le prompt et ouvre {name} dans un nouvel onglet', { name: 'Claude.ai' }), online: true },
      { key: 'chatgpt',       c: 'gray',   label: _t('btn.chatgpt', 'ChatGPT'),               desc: _t('wizard.export.online_desc', 'Copie le prompt et ouvre {name} dans un nouvel onglet', { name: 'ChatGPT' }), online: true },
      { key: 'gemini',        c: 'gray',   label: _t('btn.gemini', 'Gemini'),                 desc: _t('wizard.export.online_desc', 'Copie le prompt et ouvre {name} dans un nouvel onglet', { name: 'Gemini' }), online: true },
      { key: 'perplexity',    c: 'gray',   label: _t('btn.perplexity', 'Perplexity'),         desc: _t('wizard.export.online_desc', 'Copie le prompt et ouvre {name} dans un nouvel onglet', { name: 'Perplexity' }), online: true },
      { key: 'grok',          c: 'gray',   label: _t('btn.grok', 'Grok'),                     desc: _t('wizard.export.online_desc', 'Copie le prompt et ouvre {name} dans un nouvel onglet', { name: 'Grok' }), online: true },
      { key: 'lechat',        c: 'gray',   label: _t('btn.lechat', 'Le Chat'),                desc: _t('wizard.export.online_desc', 'Copie le prompt et ouvre {name} dans un nouvel onglet', { name: 'Le Chat' }), online: true },
      { key: 'deepseek',      c: 'gray',   label: _t('btn.deepseek', 'DeepSeek'),             desc: _t('wizard.export.online_desc', 'Copie le prompt et ouvre {name} dans un nouvel onglet', { name: 'DeepSeek' }), online: true },
    ];
    var defaultsFalse = ['claude_online','chatgpt','gemini','perplexity','grok','lechat','deepseek'];
    var rows = btns.map(function (b) {
      var v = VB[b.key];
      var checked = (v === undefined) ? (defaultsFalse.indexOf(b.key) === -1) : !!v;
      return (
        '<label class="wiz-toggle-row" for="wiz-vis-' + b.key + '">' +
          '<span class="wiz-badge wiz-badge-' + b.c + '">' + b.label + '</span>' +
          '<span class="wiz-toggle-desc">' + b.desc + '</span>' +
          '<span class="sp-switch">' +
            '<input type="checkbox" id="wiz-vis-' + b.key + '" data-key="' + b.key + '"' + (checked ? ' checked' : '') + '>' +
            '<span class="sp-switch-track"><span class="sp-switch-thumb"></span></span>' +
          '</span>' +
        '</label>'
      );
    }).join('');
    return (
      '<div class="wiz-step">' +
        '<h2 class="wiz-h2">' + _t('wizard.export.title', "Boutons d'export") + '</h2>' +
        '<p class="wiz-step-desc">' + _t('wizard.export.desc', 'Activez uniquement les outils que vous utilisez. Vous pourrez changer ça dans ⚙ Réglages.') + '</p>' +
        '<ul class="wiz-toggle-list">' + rows + '</ul>' +
      '</div>'
    );
  }

  // ── Step Theme ─────────────────────────────────────────────────

  function _stepTheme() {
    return ''
      + '<h2 class="wiz-title">' + _t('wizard.theme.title', 'Choisissez votre thème') + '</h2>'
      + '<p class="wiz-text">' + _t('wizard.theme.text', 'Sombre, clair ou auto (suit votre OS). Modifiable plus tard dans Réglages › Affichage.') + '</p>'
      + '<div class="wiz-theme-row">'
      + '<button class="wiz-theme-card" data-pick-theme="dark">🌙 ' + _t('settings.display.theme_dark', 'Sombre') + '</button>'
      + '<button class="wiz-theme-card" data-pick-theme="light">☀️ ' + _t('settings.display.theme_light', 'Clair') + '</button>'
      + '<button class="wiz-theme-card" data-pick-theme="auto">🖥️ ' + _t('settings.display.theme_auto', 'Auto') + '</button>'
      + '</div>';
  }

  // ── Step Templates ─────────────────────────────────────────────

  function _stepTemplates() {
    return ''
      + '<h2 class="wiz-title">' + _t('wizard.templates.title', 'Modèles de prompts') + '</h2>'
      + '<p class="wiz-text">' + _t('wizard.templates.text', 'Cliquez sur le bouton 📝 « Modèles » pour enregistrer une saisie comme modèle réutilisable. Idéal pour les prompts récurrents (review, refacto, debug…).') + '</p>'
      + '<ul class="wiz-list">'
      + '<li>' + _t('wizard.templates.tip1', 'Cliquez « Modèles » → « Enregistrer la saisie » pour capturer le prompt actuel.') + '</li>'
      + '<li>' + _t('wizard.templates.tip2', 'Cliquez sur un modèle pour l\'insérer dans la zone de saisie.') + '</li>'
      + '<li>' + _t('wizard.templates.tip3', 'Les modèles sont sauvegardés et exportés avec votre configuration.') + '</li>'
      + '</ul>';
  }

  // ── Step Privacy ───────────────────────────────────────────────

  function _stepPrivacy() {
    return ''
      + '<h2 class="wiz-title">🛡️ ' + _t('wizard.privacy.title', 'Confidentialité par défaut') + '</h2>'
      + '<p class="wiz-text">' + _t('wizard.privacy.text', 'BIAIF masque automatiquement les données sensibles avant qu\'elles soient stockées : emails, IBAN, cartes bancaires (Luhn), JWT, tokens Bearer/sk-/ghp_.') + '</p>'
      + '<p class="wiz-text">' + _t('wizard.privacy.local', 'Tout reste local — aucune télémétrie, aucun envoi serveur. Voir le détail dans Réglages › Confidentialité.') + '</p>';
  }

  // ── Step Shortcuts ─────────────────────────────────────────────

  function _stepShortcuts() {
    return ''
      + '<h2 class="wiz-title">⌨️ ' + _t('wizard.shortcuts.title', 'Raccourcis clavier') + '</h2>'
      + '<ul class="wiz-shortcuts">'
      + '<li><kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd> — ' + _t('wizard.shortcuts.palette', 'Palette de commandes') + '</li>'
      + '<li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> — ' + _t('wizard.shortcuts.toggle', 'Ouvrir/fermer le panneau') + '</li>'
      + '<li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> — ' + _t('wizard.shortcuts.picker', 'Sélecteur d\'élément') + '</li>'
      + '<li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> — ' + _t('wizard.shortcuts.mic', 'Micro on/off') + '</li>'
      + '<li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> — ' + _t('wizard.shortcuts.copy', 'Copier le prompt') + '</li>'
      + '<li><kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> — ' + _t('wizard.shortcuts.merge', 'Fusionner avec voisin') + '</li>'
      + '</ul>'
      + '<p class="wiz-text wiz-text-muted">' + _t('wizard.shortcuts.customize', 'Personnalisables via chrome://extensions/shortcuts.') + '</p>';
  }

  // ── Step Ready ─────────────────────────────────────────────────

  function _stepReady() {
    var langLabel = '';
    if (_STATE && _STATE.lang) {
      var langMap = {
        'fr-FR': '🇫🇷 Français', 'en-US': '🇺🇸 English (US)', 'en-GB': '🇬🇧 English (UK)',
        'es-ES': '🇪🇸 Español',  'de-DE': '🇩🇪 Deutsch',       'it-IT': '🇮🇹 Italiano',
        'pt-BR': '🇧🇷 Português', 'nl-NL': '🇳🇱 Nederlands',
      };
      langLabel = langMap[_STATE.lang] || _STATE.lang;
    }
    var activeButtons = [];
    if (_STATE && _STATE.visibleButtons) {
      var VB = _STATE.visibleButtons;
      var names = {
        inject:        _t('btn.inject', 'Injecter'),
        vscode:        _t('btn.vscode', 'VS-Code Terminal'),
        copilot:       _t('btn.copilot', 'VS-Code GH for Copilot'),
        copy:          _t('btn.copy', 'Copier'),
        download:      _t('btn.download', '.MD'),
        claude_online: _t('btn.claude_online', 'Claude.ai'),
        chatgpt:       _t('btn.chatgpt', 'ChatGPT'),
        gemini:        _t('btn.gemini', 'Gemini'),
        perplexity:    _t('btn.perplexity', 'Perplexity'),
        grok:          _t('btn.grok', 'Grok'),
        lechat:        _t('btn.lechat', 'Le Chat'),
        deepseek:      _t('btn.deepseek', 'DeepSeek'),
      };
      var defaultsFalse = ['claude_online','chatgpt','gemini','perplexity','grok','lechat','deepseek'];
      Object.keys(names).forEach(function (k) {
        var v = VB[k];
        var on = (v === undefined) ? (defaultsFalse.indexOf(k) === -1) : !!v;
        if (on) activeButtons.push(names[k]);
      });
    }

    var recap = [
      { icon: '▶', text: _t('wizard.ready.step1', 'Cliquez <strong>Démarrer</strong> pour activer la session') },
      { icon: '⚙', text: _t('wizard.ready.step2', 'Configurez à nouveau via <strong>⚙ Réglages</strong> à tout moment') },
      { icon: '⌨', text: _t('wizard.ready.step3', '<code>Alt+Shift+M</code> micro &nbsp;·&nbsp; <code>Alt+Shift+C</code> copier') },
      { icon: '↩', text: _t('wizard.ready.step4', 'Retrouvez ce guide : <strong>⚙ Réglages → Revoir le guide</strong>') },
    ];
    var rows = recap.map(function (r) {
      return '<li><span>' + r.icon + '</span><span>' + r.text + '</span></li>';
    }).join('');

    var configSummary = '';
    if (langLabel || activeButtons.length) {
      configSummary =
        '<div class="wiz-config-summary">' +
          (langLabel ? '<div class="wiz-summary-row"><span class="wiz-summary-label">' + _t('wizard.ready.lang_label', 'Langue') + '</span><span class="wiz-summary-val">' + langLabel + '</span></div>' : '') +
          (activeButtons.length ? '<div class="wiz-summary-row"><span class="wiz-summary-label">' + _t('wizard.ready.buttons_label', 'Boutons actifs') + '</span><span class="wiz-summary-val">' + activeButtons.join(' · ') + '</span></div>' : '') +
        '</div>';
    }

    return (
      '<div class="wiz-step wiz-step-ready">' +
        '<div class="wiz-orb wiz-orb-green" aria-hidden="true">' +
          _svg('<circle cx="12" cy="12" r="10"/><polyline points="9 11 12 14 22 4"/>', 52) +
        '</div>' +
        '<h1 class="wiz-h1">' + _t('wizard.ready.title', 'Vous êtes prêt !') + '</h1>' +
        configSummary +
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
