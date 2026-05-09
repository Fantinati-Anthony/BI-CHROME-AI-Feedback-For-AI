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

  // Single source of truth: shared/ai-adapters.js. Build local lookup maps lazily.
  function _allButtons() { return (window.BIAIF && window.BIAIF.ALL_BUTTONS) || []; }
  function _aiTargets()  { return (window.BIAIF && window.BIAIF.AI_TARGETS)  || []; }

  function _onlineButton(origIndex, target) {
    var ICONS = window.BIAIFRender.icons;
    var label = esc(_t(target.i18nKey, target.label));
    var aria  = esc(_t('aria.open_in_new_tab', 'Ouvrir ' + target.label + ' dans un nouvel onglet et copier le prompt', { name: target.label }));
    return (
      '<button class="seg-action-btn seg-action-btn--online seg-action-btn--' + target.slug +
        '" data-act="seg-' + target.slug + '" data-i="' + origIndex + '" aria-label="' + aria +
        '" title="' + label + '">' +
        ICONS.chat(11) + label +
      '</button>'
    );
  }
  function _onlineButtonsHtml(origIndex) {
    return _aiTargets().map(function (t) { return _onlineButton(origIndex, t); }).join('');
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
    // User-defined tags — clickable to filter, ✕ to remove on hover.
    var origIndexAttr = STATE.demandes.indexOf(dem);
    (dem.tags || []).forEach(function (tg) {
      var safe = String(tg || '').slice(0, 24);
      var activeTag = STATE.tagFilter === safe;
      // Class includes seg-filter-badge so the existing delegated handler
      // in bindings/events.js picks it up (sets STATE.tagFilter on click).
      parts.push('<button class="seg-filter-badge seg-tag-chip' + (activeTag ? ' is-active' : '') +
        '" data-fk="tagFilter" data-fv="' + esc(safe) +
        '" data-i="' + origIndexAttr +
        '" title="Filtrer par tag : ' + esc(safe) + '" type="button">' +
        '<span class="seg-tag-hash">#</span>' + esc(safe) +
        '<span class="seg-tag-del" data-tag-del="' + esc(safe) + '" data-i="' + origIndexAttr + '" aria-label="Retirer ce tag">×</span>' +
        '</button>');
    });
    // "+" button to add a tag (visible on every card)
    parts.push('<button class="seg-tag-add" data-i="' + origIndexAttr +
      '" data-act="seg-tag-add" title="Ajouter un tag" type="button">+ tag</button>');

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

  // Per-card token estimate badge — uses the same heuristic + colour
  // thresholds as the live editor counter (sidepanel/render/token-counter.js).
  function _tokenBadgeHtml(dem) {
    var TC = window.BIAIFRender.tokenCounter;
    if (!TC || !TC._estimate || !TC._kindFor) return '';
    var stripped = String(dem.text || '').replace(/\{\{ref:\d+\}\}/g, '');
    var n   = TC._estimate(stripped);
    if (!n) return '';
    var kind  = TC._kindFor(n);
    var label = (n < 1000 ? n : (n < 10000 ? (n / 1000).toFixed(1) + 'k' : Math.round(n / 1000) + 'k'));
    var unit  = _t('tokens.unit', 'tok');
    var tip   = esc(_t('tokens.tooltip', 'Estimation des tokens (heuristique BPE)'));
    return '<span class="token-counter token-counter--seg" data-kind="' + kind + '" title="' + tip + '">~' + label + ' ' + esc(unit) + '</span>';
  }

  function _editBtnHtml(origIndex, isEditing) {
    var ICONS = window.BIAIFRender.icons;
    if (isEditing) {
      return '<button class="seg-edit-btn is-active" data-act="seg-edit" data-i="' + origIndex +
        '" aria-label="Terminer l\'édition" title="Terminer l\'édition">' +
        ICONS.checkmark(12).replace('stroke-width="2"', 'stroke-width="2.5"') +
        '<span>Terminer</span></button>';
    }
    return '<button class="seg-edit-btn" data-act="seg-edit" data-i="' + origIndex +
      '" aria-label="Éditer cette demande" title="Éditer (voix, picker, capture s\'y insèrent)">' +
      ICONS.pencil(12) + '</button>';
  }

  function _applyButtonVisibility(card, STATE) {
    var VB = STATE.visibleButtons || {};
    _allButtons().forEach(function (def) {
      var v = VB[def.key];
      var visible = (v === undefined) ? def.defaultVisible : !!v;
      if (!visible) {
        var b = card.querySelector('[data-act="seg-' + def.slug + '"]');
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
    var tn = (window.BIAIF && window.BIAIF.utils && window.BIAIF.utils.tn) || _t;
    var refsLabel = tn('segments.ref', refsCount,
      refsCount + ' réf' + (refsCount > 1 ? 's' : ''), { n: refsCount });
    var isEditing = STATE.editingDemandeIdx === origIndex;
    if (isEditing) card.classList.add('is-editing');
    card.dataset.i = String(origIndex);

    var ariaMerge = esc(_t('aria.merge_handle',
      'Glisser ou Alt+↑/↓ pour fusionner avec une demande voisine'));
    var titleMerge = esc(_t('seg.merge_handle_tip',
      'Glisser pour fusionner — ou Alt+↑/↓ au clavier'));

    card.innerHTML =
      '<header>' +
        '<button class="seg-drag-handle" data-i="' + origIndex +
          '" aria-label="' + ariaMerge + '" title="' + titleMerge + '">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<circle cx="9" cy="6" r="0.8"/><circle cx="15" cy="6" r="0.8"/>' +
            '<circle cx="9" cy="12" r="0.8"/><circle cx="15" cy="12" r="0.8"/>' +
            '<circle cx="9" cy="18" r="0.8"/><circle cx="15" cy="18" r="0.8"/>' +
          '</svg>' +
        '</button>' +
        '<span class="seg-num" aria-label="Demande ' + num + '">#' + num + '</span>' +
        '<span class="seg-meta">' + dt + ' · <span aria-label="' + refsCount + ' références">' +
          esc(refsLabel) + '</span></span>' +
        _tokenBadgeHtml(dem) +
        _statusHtml(dem) +
        _editBtnHtml(origIndex, isEditing) +
        '<button class="seg-del" data-act="seg-del" data-i="' + origIndex +
          '" aria-label="Supprimer la demande ' + num + '" title="Supprimer">×</button>' +
      '</header>' +
      _buildMetaTags(dem) +
      '<div class="demande-text ' + (dem.text ? '' : 'demande-text-empty') +
        '" data-i="' + origIndex + '" data-act="seg-expand-text"' +
        ' aria-label="Texte de la demande ' + num +
        '" data-placeholder="(demande vide)"></div>' +
      '<button class="demande-text-toggle" data-act="seg-expand-text-btn" data-i="' + origIndex +
        '" type="button" aria-label="Déplier le texte de la demande"></button>' +
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
        _onlineButtonsHtml(origIndex) +
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
    var sq = ctx.STATE.searchQuery || '';
    if (sq) _highlightSearch(textEl, sq);

    // Click + drag handlers live on the .biaif-segments wrapper as a
    // single delegated set — see segments.js → ensureDelegatedHandlers().
    // We just mark the drag handle as draggable + tabbable here.
    var dragHandle = card.querySelector('.seg-drag-handle');
    if (dragHandle) {
      dragHandle.draggable = true;
      dragHandle.setAttribute('tabindex', '0');
    }
    return card;
  }

  function _highlightSearch(el, query) {
    var q = query.toLowerCase();
    var re = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [];
    var node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(function (tn) {
      if (!tn.nodeValue || tn.nodeValue.toLowerCase().indexOf(q) < 0) return;
      var parts = tn.nodeValue.split(re);
      if (parts.length <= 1) return;
      var frag = document.createDocumentFragment();
      parts.forEach(function (p) {
        if (!p) return;
        if (p.toLowerCase() === q) {
          var mark = document.createElement('mark');
          mark.className = 'biaif-hl';
          mark.textContent = p;
          frag.appendChild(mark);
        } else {
          frag.appendChild(document.createTextNode(p));
        }
      });
      tn.parentNode.replaceChild(frag, tn);
    });
  }

  window.BIAIFRender.segmentCard = {
    build:      build,
    pageTag:    _buildPageTag,
    metaTags:   _buildMetaTags,
  };
})(window);
