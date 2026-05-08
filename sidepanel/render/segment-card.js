/**
 * BIAIF Render — Segment card
 *
 * Builds one editable demande card. Owns the long inline-HTML string for
 * a card's header / actions, the meta-tags row (filter badges), the
 * fallback page tag, the per-button visibility filter, and all the
 * card-scoped event listeners (text edit, action buttons, drag-drop merge,
 * keyboard merge via Alt+↑/↓).
 *
 * Public API:
 *   build(dem, origIndex)  → HTMLElement <article.biaif-segment>
 */
(function (window) {
  'use strict';
  window.BIAIFRender = window.BIAIFRender || {};
  var ctx   = window.BIAIFRender.ctx;
  var DOM   = (window.BIAIF && window.BIAIF.dom)   || {};
  var UTILS = (window.BIAIF && window.BIAIF.utils) || {};
  var esc   = DOM.esc || function (s) { return String(s == null ? '' : s); };
  function _t(k, fb, vars) { return UTILS.t ? UTILS.t(k, fb, vars) : (fb || k); }

  var VB_MAP = {
    inject: 'seg-inject', vscode: 'seg-vscode', copilot: 'seg-copilot',
    copy: 'seg-copy', download: 'seg-download',
    claude_online: 'seg-claude-online', chatgpt: 'seg-chatgpt', gemini: 'seg-gemini',
    perplexity: 'seg-perplexity', grok: 'seg-grok', lechat: 'seg-lechat', deepseek: 'seg-deepseek',
  };
  var DEFAULT_FALSE_BUTTONS = ['claude_online','chatgpt','gemini','perplexity','grok','lechat','deepseek'];

  var ONLINE_FN = {
    'seg-claude-online': 'openInClaudeOnline',
    'seg-chatgpt':       'openInChatgpt',
    'seg-gemini':        'openInGemini',
    'seg-perplexity':    'openInPerplexity',
    'seg-grok':          'openInGrok',
    'seg-lechat':        'openInLechat',
    'seg-deepseek':      'openInDeepseek',
  };

  function _onlineButton(origIndex, slug, i18nKey, fallback) {
    var ICONS = window.BIAIFRender.icons;
    var label = esc(_t(i18nKey, fallback));
    var aria  = esc(_t('aria.open_in_new_tab', 'Ouvrir ' + fallback + ' dans un nouvel onglet et copier le prompt', { name: fallback }));
    return (
      '<button class="seg-action-btn seg-action-btn--online seg-action-btn--' + slug +
        '" data-act="seg-' + slug + '" data-i="' + origIndex + '" aria-label="' + aria +
        '" title="' + label + '">' +
        ICONS.chat(11) + label +
      '</button>'
    );
  }

  function _buildPageTag(url) {
    var ICONS = window.BIAIFRender.icons;
    var icon = ICONS.link(11);
    if (!url) return '<div class="seg-urlbar">' + icon +
      '<span class="seg-url seg-url-empty">URL inconnue</span></div>';
    var short = DOM.formatUrl ? DOM.formatUrl(url) : url;
    return '<div class="seg-urlbar">' + icon +
      '<a class="seg-url" href="' + esc(url) + '" target="_blank" rel="noopener" title="' +
      esc(url) + '">' + esc(short) + '</a></div>';
  }

  function _buildMetaTags(dem) {
    var STATE = ctx.STATE;
    var ICONS = window.BIAIFRender.icons;
    var parts = [];

    if (dem.repoId) {
      var activeRepo = STATE.repoFilter === dem.repoId;
      parts.push('<button class="seg-filter-badge seg-filter-badge--repo' +
        (activeRepo ? ' is-active' : '') +
        '" data-fk="repoFilter" data-fv="' + esc(dem.repoId) +
        '" title="Filtrer par repo : ' + esc(dem.repoId) + '" type="button">' +
        ICONS.repo(9) + esc(dem.repoId) + '</button>');
    }
    if (dem.conversationUrl) {
      var activeConv = STATE.conversationFilter === dem.conversationUrl;
      var convShort = dem.conversationUrl;
      try { convShort = new URL(dem.conversationUrl).hostname; } catch (_) {}
      parts.push('<button class="seg-filter-badge seg-filter-badge--conv' +
        (activeConv ? ' is-active' : '') +
        '" data-fk="conversationFilter" data-fv="' + esc(dem.conversationUrl) +
        '" title="Filtrer par conversation : ' + esc(dem.conversationUrl) + '" type="button">' +
        ICONS.chat(9) + esc(convShort) + '</button>');
    }
    var seen = {};
    (dem.refs || []).forEach(function (r) {
      if (!r.tabUrl) return;
      var host = DOM.hostname ? DOM.hostname(r.tabUrl) : '';
      if (!host || seen[host]) return;
      seen[host] = true;
      var activeDom = STATE.domainFilter === host;
      parts.push('<button class="seg-filter-badge seg-filter-badge--domain' +
        (activeDom ? ' is-active' : '') +
        '" data-fk="domainFilter" data-fv="' + esc(host) +
        '" title="Filtrer par domaine : ' + esc(host) + '" type="button">' +
        esc(host) + '</button>');
    });
    if (!parts.length) return _buildPageTag(dem.url || '');
    return '<div class="seg-meta-tags">' + parts.join('') + '</div>';
  }

  function _statusHtml(dem) {
    if (dem.status === 'submitted') {
      var to = dem.submittedTo ? esc(dem.submittedTo) : 'IA';
      return '<span class="seg-status seg-status--submitted" title="' +
        _t('seg.status_submitted_tip', 'En attente de réponse de ' + (dem.submittedTo || 'l\'IA')) + '">' +
        '<span class="seg-status-pulse"></span>' +
        _t('seg.status_submitted', '⌛ Envoyé à ' + to) + '</span>';
    }
    if (dem.status === 'done') {
      return '<span class="seg-status seg-status--done" title="' +
        _t('seg.status_done_tip', 'Réponse reçue') + '">' +
        '✓ ' + _t('seg.status_done', 'Réponse reçue') + '</span>';
    }
    return '';
  }

  function _editBtnHtml(origIndex, isEditing) {
    var ICONS = window.BIAIFRender.icons;
    if (isEditing) {
      return '<button class="seg-edit-btn is-active" data-i="' + origIndex +
        '" aria-label="Terminer l\'édition" title="Terminer l\'édition">' +
        ICONS.checkmark(12).replace('stroke-width="2"', 'stroke-width="2.5"') +
        '<span>Terminer</span></button>';
    }
    return '<button class="seg-edit-btn" data-i="' + origIndex +
      '" aria-label="Éditer cette demande" title="Éditer (voix, picker, capture s\'y insèrent)">' +
      ICONS.pencil(12) + '</button>';
  }

  function _applyButtonVisibility(card, STATE) {
    var VB = STATE.visibleButtons || {};
    Object.keys(VB_MAP).forEach(function (key) {
      var v = VB[key];
      var visible = (v === undefined) ? (DEFAULT_FALSE_BUTTONS.indexOf(key) === -1) : !!v;
      if (!visible) {
        var b = card.querySelector('[data-act="' + VB_MAP[key] + '"]');
        if (b) b.hidden = true;
      }
    });
  }

  function build(dem, origIndex) {
    var STATE = ctx.STATE;
    var ICONS = window.BIAIFRender.icons;
    var Chips = window.BIAIFRender.chips;

    var num       = origIndex + 1;
    var card      = document.createElement('article');
    card.className = 'biaif-segment';
    var dt        = new Date(dem.ts || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    var refsCount = (dem.refs || []).length;
    var refsLabel = _t(refsCount > 1 ? 'segments.ref_plural' : 'segments.ref_singular',
      refsCount + ' réf' + (refsCount > 1 ? 's' : ''), { n: refsCount });
    var isEditing = STATE.editingDemandeIdx === origIndex;
    if (isEditing) card.classList.add('is-editing');
    card.dataset.i = String(origIndex);

    card.innerHTML =
      '<header>' +
        '<span class="seg-num" aria-label="Demande ' + num + '">#' + num + '</span>' +
        '<span class="seg-meta">' + dt + ' · <span aria-label="' + refsCount + ' références">' +
          esc(refsLabel) + '</span></span>' +
        _statusHtml(dem) +
        _editBtnHtml(origIndex, isEditing) +
        '<button class="seg-del" data-i="' + origIndex +
          '" aria-label="Supprimer la demande ' + num + '" title="Supprimer">×</button>' +
      '</header>' +
      _buildMetaTags(dem) +
      '<div class="demande-text ' + (dem.text ? '' : 'demande-text-empty') +
        '" data-i="' + origIndex +
        '" aria-label="Texte de la demande ' + num +
        '" data-placeholder="(demande vide)"></div>' +
      '<div class="seg-actions">' +
        '<button class="seg-action-btn seg-action-btn--inject" data-act="seg-inject" data-i="' +
          origIndex + '" aria-label="Injecter dans Claude Code (texte + images)" ' +
          'title="Injecter texte + images dans l\'éditeur Claude Code">' +
          ICONS.inject(11) + 'Injecter' +
        '</button>' +
        '<button class="seg-action-btn seg-action-btn--vscode" data-act="seg-vscode" data-i="' +
          origIndex + '" aria-label="' + esc(_t('btn.vscode','VS-Code Terminal')) +
          '" title="' + esc(_t('btn.vscode','VS-Code Terminal')) + '">' +
          ICONS.code(11) + esc(_t('btn.vscode','VS-Code Terminal')) +
        '</button>' +
        '<button class="seg-action-btn seg-action-btn--copilot" data-act="seg-copilot" data-i="' +
          origIndex + '" aria-label="' + esc(_t('btn.copilot','VS-Code GH for Copilot')) +
          '" title="' + esc(_t('btn.copilot','VS-Code GH for Copilot')) + '">' +
          ICONS.octocat(11) + esc(_t('btn.copilot','VS-Code GH for Copilot')) +
        '</button>' +
        _onlineButton(origIndex, 'claude-online', 'btn.claude_online', 'Claude.ai') +
        _onlineButton(origIndex, 'chatgpt',       'btn.chatgpt',       'ChatGPT') +
        _onlineButton(origIndex, 'gemini',        'btn.gemini',        'Gemini') +
        _onlineButton(origIndex, 'perplexity',    'btn.perplexity',    'Perplexity') +
        _onlineButton(origIndex, 'grok',          'btn.grok',          'Grok') +
        _onlineButton(origIndex, 'lechat',        'btn.lechat',        'Le Chat') +
        _onlineButton(origIndex, 'deepseek',      'btn.deepseek',      'DeepSeek') +
        '<button class="seg-action-btn" data-act="seg-copy" data-i="' + origIndex +
          '" aria-label="Copier le prompt de cette demande" title="Copier le prompt">' +
          ICONS.copy(11) + 'Copier' +
        '</button>' +
        '<button class="seg-action-btn" data-act="seg-download" data-i="' + origIndex +
          '" aria-label="Télécharger .MD de cette demande" title="Télécharger .MD + captures">' +
          ICONS.download(11) + '.MD' +
        '</button>' +
      '</div>';

    _applyButtonVisibility(card, STATE);

    // ── Display-only text area (editing is done via the unified top editor)
    var textEl = card.querySelector('.demande-text');
    Chips.renderTextWithChips(dem.text || '', dem.refs || [], textEl, { readOnly: true, demKey: origIndex });

    // ── Action buttons ─────────────────────────────────────────────────
    var Export = window.BIAIFExport;
    var ACTIONS = {
      'seg-inject':   Export && Export.injectDemande,
      'seg-vscode':   Export && Export.injectToVscode,
      'seg-copilot':  Export && Export.injectToCopilot,
      'seg-copy':     Export && Export.copyPromptForDemande,
      'seg-download': Export && Export.downloadDemande,
    };
    Object.keys(ACTIONS).forEach(function (act) {
      var fn  = ACTIONS[act];
      if (!fn) return;
      var btn = card.querySelector('[data-act="' + act + '"]');
      if (!btn) return;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        fn(Number(e.currentTarget.dataset.i));
      });
    });
    Object.keys(ONLINE_FN).forEach(function (act) {
      var btn = card.querySelector('[data-act="' + act + '"]');
      if (!btn) return;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (window.BIAIFExport && window.BIAIFExport[ONLINE_FN[act]]) {
          window.BIAIFExport[ONLINE_FN[act]](Number(e.currentTarget.dataset.i));
        }
      });
    });

    card.querySelector('.seg-edit-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      var i = Number(e.currentTarget.dataset.i);
      if (!window.BIAIFSession) return;
      if (STATE.editingDemandeIdx === i) window.BIAIFSession.exitEditMode();
      else window.BIAIFSession.enterEditMode(i);
    });
    card.querySelector('.seg-del').addEventListener('click', function (e) {
      var i   = Number(e.currentTarget.dataset.i);
      var d   = STATE.demandes[i];
      var prv = (d && d.text || '').replace(/\{\{ref:\d+\}\}/g, '…').trim().slice(0, 60) || '(vide)';
      if (!confirm(_t('confirm.delete_demande',
        'Supprimer la demande #' + (i + 1) + ' ?\n\n' + prv,
        { n: i + 1, preview: prv }))) return;
      if (STATE.editingDemandeIdx === i && window.BIAIFSession) window.BIAIFSession.exitEditMode({ silent: true });
      if (typeof STATE.editingDemandeIdx === 'number' && STATE.editingDemandeIdx > i) STATE.editingDemandeIdx--;
      STATE.demandes.splice(i, 1);
      if (window.BIAIFRender.segments) window.BIAIFRender.segments.render();
      if (window.BIAIFStorage) window.BIAIFStorage.persist(STATE);
      if (window.BIAIFToast) window.BIAIFToast.show(
        _t('toast.demande_deleted', 'Demande #' + (i + 1) + ' supprimée.', { n: i + 1 }),
        'info');
    });

    // ── Keyboard merge: Alt+↑/↓ on the card ───────────────────────────
    card.addEventListener('keydown', function (e) {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      var dst = e.key === 'ArrowUp' ? origIndex - 1 : origIndex + 1;
      if (dst < 0 || dst >= STATE.demandes.length) return;
      e.preventDefault();
      if (window.BIAIFSession) window.BIAIFSession.mergeDemandes(origIndex, dst);
    });

    return card;
  }

  window.BIAIFRender.segmentCard = {
    build:      build,
    pageTag:    _buildPageTag,
    metaTags:   _buildMetaTags,
  };
})(window);
