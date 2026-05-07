/**
 * BIAIF Renderer
 * All DOM rendering: segments, demande editor, chips, UI state sync.
 * Also contains the history search filter.
 */
(function (window) {
  'use strict';

  var STATE, REFS;
  var DRAG     = { chip: null, sourceContainer: null };
  var SEG_DRAG = { sourceIdx: -1 };

  function init(state, refs) {
    STATE = state;
    REFS  = refs;
    _bindDragEvents();
  }

  // -----------------------------------------------------------------------
  // escapeHtml (shared util — safe for innerHTML contexts)
  // -----------------------------------------------------------------------
  function _t(key, fallback, vars) {
    if (window.BIAIFi18n && window.BIAIFi18n.t) {
      var v = window.BIAIFi18n.t(key, vars);
      if (v && v !== key) return v;
    }
    return fallback || key;
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // -----------------------------------------------------------------------
  // Segments
  // -----------------------------------------------------------------------
  function renderSegments() {
    if (!REFS.segments) return;
    var qt = document.querySelector('.biaif-quick-tools');
    if (qt && qt.parentNode) qt.parentNode.removeChild(qt);

    REFS.segments.innerHTML = '';
    if (REFS.segmentsCount) REFS.segmentsCount.textContent = String(STATE.demandes.length);

    var filtered = _filterDemandes();

    if (!STATE.demandes.length) {
      REFS.segments.appendChild(_makeEmpty(_t('segments.empty', 'Aucune demande pour le moment')));
      _reattach(qt); updateMasterBtnLabel(); updateArmedUi(); return;
    }
    if (!filtered.length) {
      REFS.segments.appendChild(_makeEmpty(_t('segments.no_results', 'Aucun résultat pour cette recherche')));
      _reattach(qt); updateMasterBtnLabel(); updateArmedUi(); return;
    }

    var display = filtered.slice();
    if (STATE.sortOrder === 'desc') display.reverse();

    display.forEach(function (item) {
      var card = _buildSegmentCard(item.dem, item.origIndex);
      REFS.segments.appendChild(card);
    });

    _reattach(qt);
    updateMasterBtnLabel();
    updateArmedUi();
  }

  function _filterDemandes() {
    var q = (STATE.searchQuery || '').toLowerCase().trim();
    return STATE.demandes.map(function (d, i) { return { dem: d, origIndex: i }; }).filter(function (item) {
      if (!q) return true;
      var text = (item.dem.text || '').toLowerCase();
      var refs = (item.dem.refs || []).map(function (r) {
        return (r.selector || r.msg || r.mode || r.tag || '');
      }).join(' ').toLowerCase();
      return text.includes(q) || refs.includes(q) || (item.dem.url || '').toLowerCase().includes(q);
    });
  }

  function _onlineButton(origIndex, slug, i18nKey, fallback) {
    var label = esc(_t(i18nKey, fallback));
    var aria  = esc(_t('aria.open_in_new_tab', 'Ouvrir ' + fallback + ' dans un nouvel onglet et copier le prompt', { name: fallback }));
    return (
      '<button class="seg-action-btn seg-action-btn--online seg-action-btn--' + slug + '" data-act="seg-' + slug + '" data-i="' + origIndex + '" aria-label="' + aria + '" title="' + label + '">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
        label +
      '</button>'
    );
  }

  function _makeEmpty(msg) {
    var el = document.createElement('div');
    el.className = 'biaif-empty';
    el.textContent = msg;
    return el;
  }

  function _buildSegmentCard(dem, origIndex) {
    var num       = origIndex + 1;
    var card      = document.createElement('article');
    card.className = 'biaif-segment';
    var dt        = new Date(dem.ts || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    var refsCount = (dem.refs || []).length;
    var refsLabel = _t(refsCount > 1 ? 'segments.ref_plural' : 'segments.ref_singular', refsCount + ' réf' + (refsCount > 1 ? 's' : ''), { n: refsCount });
    var isEditing = STATE.editingDemandeIdx === origIndex;
    if (isEditing) card.classList.add('is-editing');
    card.dataset.i = String(origIndex);

    // Page tag (favicon + host)
    var pageTag = _buildPageTag(dem.url || '');

    // Edit button
    var editBtnHtml = isEditing
      ? '<button class="seg-edit-btn is-active" data-i="' + origIndex + '" aria-label="Terminer l\'édition" title="Terminer l\'édition"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>Terminer</span></button>'
      : '<button class="seg-edit-btn" data-i="' + origIndex + '" aria-label="Éditer cette demande" title="Éditer (voix, picker, capture s\'y insèrent)"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>';

    card.innerHTML =
      '<header>' +
        '<button class="seg-drag-handle" data-i="' + origIndex + '" aria-label="Glisser pour fusionner" title="Glisser sur une autre demande pour fusionner">⋮⋮</button>' +
        '<span class="seg-num" aria-label="Demande ' + num + '">#' + num + '</span>' +
        '<span class="seg-meta">' + dt + ' · <span aria-label="' + refsCount + ' références">' + esc(refsLabel) + '</span></span>' +
        editBtnHtml +
        '<button class="seg-del" data-i="' + origIndex + '" aria-label="Supprimer la demande ' + num + '" title="Supprimer">×</button>' +
      '</header>' +
      pageTag +
      '<div class="demande-text ' + (dem.text ? '' : 'demande-text-empty') + '" contenteditable="true" spellcheck="true" data-i="' + origIndex + '" role="textbox" aria-multiline="true" aria-label="Texte de la demande ' + num + '" data-placeholder="(demande vide)"></div>' +
      '<div class="seg-actions">' +
        '<button class="seg-action-btn seg-action-btn--inject" data-act="seg-inject" data-i="' + origIndex + '" aria-label="Injecter dans Claude Code (texte + images)" title="Injecter texte + images dans l\'éditeur Claude Code">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 6-4 4-4-4"/><path d="M16 18a4 4 0 0 0-8 0"/></svg>' +
          'Injecter' +
        '</button>' +
        '<button class="seg-action-btn seg-action-btn--vscode" data-act="seg-vscode" data-i="' + origIndex + '" aria-label="' + esc(_t('btn.vscode','VS-Code Terminal')) + '" title="' + esc(_t('btn.vscode','VS-Code Terminal')) + '">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>' +
          esc(_t('btn.vscode','VS-Code Terminal')) +
        '</button>' +
        '<button class="seg-action-btn seg-action-btn--copilot" data-act="seg-copilot" data-i="' + origIndex + '" aria-label="' + esc(_t('btn.copilot','VS-Code GH for Copilot')) + '" title="' + esc(_t('btn.copilot','VS-Code GH for Copilot')) + '">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/><path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32"/></svg>' +
          esc(_t('btn.copilot','VS-Code GH for Copilot')) +
        '</button>' +
        _onlineButton(origIndex, 'claude-online',  'btn.claude_online', 'Claude.ai') +
        _onlineButton(origIndex, 'chatgpt',        'btn.chatgpt',       'ChatGPT') +
        _onlineButton(origIndex, 'gemini',         'btn.gemini',        'Gemini') +
        _onlineButton(origIndex, 'perplexity',     'btn.perplexity',    'Perplexity') +
        _onlineButton(origIndex, 'grok',           'btn.grok',          'Grok') +
        _onlineButton(origIndex, 'lechat',         'btn.lechat',        'Le Chat') +
        _onlineButton(origIndex, 'deepseek',       'btn.deepseek',      'DeepSeek') +
        '<button class="seg-action-btn" data-act="seg-copy" data-i="' + origIndex + '" aria-label="Copier le prompt de cette demande" title="Copier le prompt">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>' +
          'Copier' +
        '</button>' +
        '<button class="seg-action-btn" data-act="seg-download" data-i="' + origIndex + '" aria-label="Télécharger .MD de cette demande" title="Télécharger .MD + captures">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>' +
          '.MD' +
        '</button>' +
      '</div>';

    // Apply button visibility
    var VB = STATE.visibleButtons || {};
    var VB_MAP = {
      inject: 'seg-inject', vscode: 'seg-vscode', copilot: 'seg-copilot',
      copy: 'seg-copy', download: 'seg-download',
      claude_online: 'seg-claude-online', chatgpt: 'seg-chatgpt', gemini: 'seg-gemini',
      perplexity: 'seg-perplexity', grok: 'seg-grok', lechat: 'seg-lechat', deepseek: 'seg-deepseek',
    };
    var defaultsFalse = ['claude_online','chatgpt','gemini','perplexity','grok','lechat','deepseek'];
    Object.keys(VB_MAP).forEach(function (key) {
      var v = VB[key];
      var isVisible;
      if (v === undefined) isVisible = defaultsFalse.indexOf(key) === -1; // default true for legacy, false for new
      else isVisible = !!v;
      if (!isVisible) {
        var b = card.querySelector('[data-act="' + VB_MAP[key] + '"]');
        if (b) b.hidden = true;
      }
    });

    var textEl = card.querySelector('.demande-text');
    renderTextWithChips(dem.text || '', dem.refs || [], textEl, { readOnly: true, demKey: origIndex });

    textEl.addEventListener('blur', function () {
      var oldRefs = dem.refs || [], newRefs = [], txt = '';
      for (var node of textEl.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) txt += node.textContent;
        else if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.classList && node.classList.contains('ref-chip')) {
            var ref = oldRefs[Number(node.dataset.ref)];
            if (ref) { newRefs.push(ref); txt += '{{ref:' + (newRefs.length - 1) + '}}'; }
          } else if (node.tagName === 'BR') txt += '\n';
          else txt += node.textContent;
        }
      }
      dem.text = txt.replace(/\s+/g, ' ').trim();
      dem.refs = newRefs;
      if (window.BIAIFStorage) window.BIAIFStorage.persist(STATE);
    });
    textEl.addEventListener('keydown', function (e) { if (e.key === 'Escape') e.currentTarget.blur(); });
    textEl.addEventListener('focus', function () {
      if (STATE.editingDemandeIdx !== origIndex && window.BIAIFSession) window.BIAIFSession.enterEditMode(origIndex);
    });

    var _btnInject   = card.querySelector('[data-act="seg-inject"]');
    var _btnVscode   = card.querySelector('[data-act="seg-vscode"]');
    var _btnCopilot  = card.querySelector('[data-act="seg-copilot"]');
    var _btnCopy     = card.querySelector('[data-act="seg-copy"]');
    var _btnDownload = card.querySelector('[data-act="seg-download"]');
    if (_btnInject)   _btnInject.addEventListener('click',   function (e) { e.stopPropagation(); if (window.BIAIFExport) window.BIAIFExport.injectDemande(Number(e.currentTarget.dataset.i)); });
    if (_btnVscode)   _btnVscode.addEventListener('click',   function (e) { e.stopPropagation(); if (window.BIAIFExport) window.BIAIFExport.injectToVscode(Number(e.currentTarget.dataset.i)); });
    if (_btnCopilot)  _btnCopilot.addEventListener('click',  function (e) { e.stopPropagation(); if (window.BIAIFExport) window.BIAIFExport.injectToCopilot(Number(e.currentTarget.dataset.i)); });
    if (_btnCopy)     _btnCopy.addEventListener('click',     function (e) { e.stopPropagation(); if (window.BIAIFExport) window.BIAIFExport.copyPromptForDemande(Number(e.currentTarget.dataset.i)); });
    if (_btnDownload) _btnDownload.addEventListener('click', function (e) { e.stopPropagation(); if (window.BIAIFExport) window.BIAIFExport.downloadDemande(Number(e.currentTarget.dataset.i)); });

    var ONLINE_FN = {
      'seg-claude-online': 'openInClaudeOnline',
      'seg-chatgpt':       'openInChatgpt',
      'seg-gemini':        'openInGemini',
      'seg-perplexity':    'openInPerplexity',
      'seg-grok':          'openInGrok',
      'seg-lechat':        'openInLechat',
      'seg-deepseek':      'openInDeepseek',
    };
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
      if (!confirm(_t('confirm.delete_demande', 'Supprimer la demande #' + (i + 1) + ' ?\n\n' + prv, { n: i + 1, preview: prv }))) return;
      if (STATE.editingDemandeIdx === i && window.BIAIFSession) window.BIAIFSession.exitEditMode({ silent: true });
      if (typeof STATE.editingDemandeIdx === 'number' && STATE.editingDemandeIdx > i) STATE.editingDemandeIdx--;
      STATE.demandes.splice(i, 1);
      renderSegments();
      if (window.BIAIFStorage) window.BIAIFStorage.persist(STATE);
      if (window.BIAIFToast) window.BIAIFToast.show(_t('toast.demande_deleted', 'Demande #' + (i + 1) + ' supprimée.', { n: i + 1 }), 'info');
    });

    // Segment drag-drop for merge
    var dragHandle = card.querySelector('.seg-drag-handle');
    dragHandle.draggable = true;
    dragHandle.addEventListener('dragstart', function (e) {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', '__biaif_segment__'); } catch (_) {}
      SEG_DRAG.sourceIdx = origIndex;
      card.classList.add('is-dragging-seg');
    });
    dragHandle.addEventListener('dragend', function () {
      SEG_DRAG.sourceIdx = -1;
      document.querySelectorAll('.biaif-segment.is-dragging-seg, .biaif-segment.is-drop-target')
        .forEach(function (c) { c.classList.remove('is-dragging-seg', 'is-drop-target'); });
    });
    card.addEventListener('dragover', function (e) {
      if (SEG_DRAG.sourceIdx < 0 || SEG_DRAG.sourceIdx === origIndex) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      card.classList.add('is-drop-target');
    });
    card.addEventListener('dragleave', function (e) {
      if (e.relatedTarget && card.contains(e.relatedTarget)) return;
      card.classList.remove('is-drop-target');
    });
    card.addEventListener('drop', function (e) {
      if (SEG_DRAG.sourceIdx < 0 || SEG_DRAG.sourceIdx === origIndex) return;
      e.preventDefault(); card.classList.remove('is-drop-target');
      var src = SEG_DRAG.sourceIdx; SEG_DRAG.sourceIdx = -1;
      if (window.BIAIFSession) window.BIAIFSession.mergeDemandes(src, origIndex);
    });

    return card;
  }

  function _buildPageTag(url) {
    if (!url) return '<div class="seg-urlbar"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg><span class="seg-url seg-url-empty">URL inconnue</span></div>';
    var short = _formatUrl(url);
    return '<div class="seg-urlbar"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg><a class="seg-url" href="' + esc(url) + '" target="_blank" rel="noopener" title="' + esc(url) + '">' + esc(short) + '</a></div>';
  }

  function _formatUrl(url) {
    try {
      var u = new URL(url);
      var s = u.host + u.pathname + (u.search.length > 30 ? u.search.slice(0, 30) + '…' : u.search);
      return s.length > 60 ? s.slice(0, 60) + '…' : s;
    } catch (_) { return url.length > 60 ? url.slice(0, 60) + '…' : url; }
  }

  // -----------------------------------------------------------------------
  // Demande editor
  // -----------------------------------------------------------------------
  function renderDemandeEditor() {
    var ed = REFS.demandeEditor;
    if (!ed) return;
    ed.innerHTML = '';
    var text = STATE.currentDemande.text, refs = STATE.currentDemande.refs;
    if (!text) { renderDemandeRefsStrip(); return; }
    var re = /\{\{ref:(\d+)\}\}/g, last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) ed.appendChild(document.createTextNode(text.slice(last, m.index)));
      var ref = refs[Number(m[1])];
      if (ref) ed.appendChild(makeChipElement(Number(m[1]), ref, { demKey: 'current' }));
      last = m.index + m[0].length;
    }
    if (last < text.length) ed.appendChild(document.createTextNode(text.slice(last)));
    renderDemandeRefsStrip();
  }

  function renderDemandeRefsStrip() {
    if (REFS.demandeRefsCount) {
      var n = STATE.currentDemande.refs.length;
      REFS.demandeRefsCount.textContent = _t(n > 1 ? 'segments.ref_plural' : 'segments.ref_singular', n + ' réf' + (n > 1 ? 's' : ''), { n: n });
    }
    var strip = REFS.demandeRefsStrip;
    if (!strip) return;
    strip.innerHTML = '';
    STATE.currentDemande.refs.forEach(function (ref, i) {
      var mini = document.createElement('div');
      mini.className = 'ref-mini ref-mini--' + (ref.type || 'element');
      var num = document.createElement('span');
      num.className = 'ref-mini-num'; num.textContent = '#' + (i + 1);
      mini.appendChild(num);
      if (ref.type === 'screenshot' && ref.dataUrl) {
        var img = document.createElement('img');
        img.className = 'ref-mini-thumb';
        img.src = ref.dataUrl; img.alt = 'capture #' + (i + 1);
        mini.appendChild(img);
      }
      var lbl = document.createElement('span');
      lbl.className = 'ref-mini-label';
      lbl.textContent = ref.type === 'screenshot' ? (ref.mode || 'capture') : (ref.selector || ref.tag || '?');
      mini.appendChild(lbl);
      strip.appendChild(mini);
    });
  }

  function appendChipToEditor(absIdx, ref) {
    var ed = REFS.demandeEditor;
    if (!ed) return;
    var last = ed.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE && !/\s$/.test(last.textContent))
      last.textContent += ' ';
    else if (last && last.nodeType === Node.ELEMENT_NODE)
      ed.appendChild(document.createTextNode(' '));
    ed.appendChild(makeChipElement(absIdx, ref, { demKey: 'current' }));
    ed.appendChild(document.createTextNode(' '));
    if (window.BIAIFSession) { window.BIAIFSession.syncCurrentDemandeFromEditor(); }
    renderDemandeRefsStrip();
    if (window.BIAIFStorage) window.BIAIFStorage.persist(STATE);
  }

  // -----------------------------------------------------------------------
  // Chip factory
  // -----------------------------------------------------------------------
  function makeChipElement(absIdx, ref, opts) {
    opts = opts || {};
    var span = document.createElement('span');
    span.className = 'ref-chip ref-chip--' + (ref && ref.type || 'element');
    if (opts.readOnly) span.classList.add('ref-chip-readonly');
    span.contentEditable = 'false';
    span.dataset.ref = String(absIdx);
    if (opts.demKey !== undefined) span.dataset.demKey = String(opts.demKey);

    var isShot = ref && ref.type === 'screenshot';
    var isErr  = ref && ref.type === 'error';
    if (isErr) span.classList.add('ref-chip--error');

    var icon = isShot
      ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="3"/></svg>'
      : isErr
      ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>';

    var labelKind = isShot ? 'capture' : isErr ? 'erreur' : 'élément';
    var num       = opts.displayNum || (absIdx + 1);

    var header = document.createElement('span');
    header.className = 'ref-chip-header';
    header.innerHTML = icon + '<span class="ref-chip-label">' + labelKind + ' #' + num + '</span><span class="ref-chip-toggle" aria-hidden="true">▾</span>';

    var details = document.createElement('span');
    details.className = 'ref-details';

    if (isShot) {
      if (ref.dataUrl) {
        var img = document.createElement('img');
        img.className = 'ref-details-img'; img.src = ref.dataUrl; img.alt = 'capture #' + num;
        details.appendChild(img);
      }
      var meta = document.createElement('span');
      meta.className = 'ref-details-meta';
      meta.textContent = 'Mode : ' + (ref.mode || 'visible');
      details.appendChild(meta);
      var btn = document.createElement('button');
      btn.className = 'ref-details-btn'; btn.type = 'button'; btn.dataset.editType = 'screenshot';
      btn.textContent = '✏ Re-annoter';
      details.appendChild(btn);
    } else if (isErr) {
      var lines = [];
      if (ref.msg)  lines.push('<span class="t-key">message</span> ' + esc(ref.msg));
      if (ref.file) lines.push('<span class="t-key">fichier</span> ' + esc(ref.file) + ':' + (ref.line || '?') + (ref.col ? ':' + ref.col : ''));
      if (ref.url)  lines.push('<span class="t-key">page</span> ' + esc(ref.url));
      var m2 = document.createElement('span'); m2.className = 'ref-details-meta'; m2.innerHTML = lines.join('<br>');
      details.appendChild(m2);
      if (ref.stack) {
        var s2 = document.createElement('span'); s2.className = 'ref-details-selector';
        s2.innerHTML = '<code>' + esc(ref.stack.slice(0, 800)) + (ref.stack.length > 800 ? '\n…(tronqué)' : '') + '</code>';
        details.appendChild(s2);
      }
    } else {
      var eLines = [];
      if (ref && ref.tag)            eLines.push('<span class="t-key">tag</span> &lt;' + esc(ref.tag) + '&gt;');
      if (ref && ref.id)             eLines.push('<span class="t-key">id</span> #' + esc(ref.id));
      if (ref && ref.classes && ref.classes.length) eLines.push('<span class="t-key">classes</span> ' + esc(ref.classes.join(' ')));
      if (ref && ref.text)           eLines.push('<span class="t-key">texte</span> « ' + esc(ref.text.slice(0, 120)) + (ref.text.length > 120 ? '…' : '') + ' »');
      var em = document.createElement('span'); em.className = 'ref-details-meta';
      em.innerHTML = eLines.join('<br>') || '<em>Pas de détails</em>';
      details.appendChild(em);
      if (ref && ref.selector) {
        var sel = document.createElement('span'); sel.className = 'ref-details-selector';
        sel.innerHTML = '<code>' + esc(ref.selector) + '</code>';
        details.appendChild(sel);
      }
      var ebtn = document.createElement('button');
      ebtn.className = 'ref-details-btn'; ebtn.type = 'button'; ebtn.dataset.editType = 'element';
      ebtn.textContent = '⌖ Re-piquer';
      details.appendChild(ebtn);
    }

    span.appendChild(header);
    span.appendChild(details);

    span.draggable = true;
    span.addEventListener('dragstart', function (e) {
      if (span.classList.contains('expanded')) { e.preventDefault(); return; }
      DRAG.chip = span;
      DRAG.sourceContainer = span.closest('.demande-editor, .demande-text');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', '__biaif_chip__'); } catch (_) {}
      span.classList.add('is-dragging');
    });
    span.addEventListener('dragend', function () {
      span.classList.remove('is-dragging');
      DRAG.chip = null; DRAG.sourceContainer = null;
    });

    return span;
  }

  function renderTextWithChips(text, refs, root, opts) {
    root.innerHTML = '';
    var re = /\{\{ref:(\d+)\}\}/g, last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) root.appendChild(document.createTextNode(text.slice(last, m.index)));
      var ref = refs[Number(m[1])];
      if (ref) root.appendChild(makeChipElement(Number(m[1]), ref, {
        readOnly: true, displayNum: Number(m[1]) + 1, demKey: opts && opts.demKey,
      }));
      last = m.index + m[0].length;
    }
    if (last < text.length) root.appendChild(document.createTextNode(text.slice(last)));
  }

  // -----------------------------------------------------------------------
  // UI state sync
  // -----------------------------------------------------------------------
  function updateMasterBtnLabel() {
    if (!REFS.masterBtn) return;
    var lbl = REFS.masterBtn.querySelector('.master-label');
    if (!lbl) return;
    if (typeof STATE.editingDemandeIdx === 'number') { lbl.textContent = _t('session.finish', 'Terminer'); return; }
    if (!STATE.armed) { lbl.textContent = _t('session.start', 'Démarrer'); return; }
    var hasContent = !!((STATE.currentDemande.text || '').trim() || STATE.currentDemande.refs.length);
    lbl.textContent = hasContent ? _t('session.next', 'Suivant →') : _t('session.new_segment', 'Nouveau segment');
  }

  function updateArmedUi() {
    var root    = document.querySelector('.biaif-root');
    var editing = typeof STATE.editingDemandeIdx === 'number';
    var hasContent = !!((STATE.currentDemande.text || '').trim() || STATE.currentDemande.refs.length);
    var empty   = !STATE.armed && !editing && !STATE.demandes.length && !hasContent;
    if (root) {
      root.classList.toggle('is-armed', !!STATE.armed);
      root.classList.toggle('is-editing-segment', editing);
      root.classList.toggle('is-empty-state', empty);
    }
    var qt = document.querySelector('.biaif-quick-tools');
    if (qt) qt.classList.toggle('is-hidden', !STATE.armed && !editing);
    var dz = document.querySelector('.demande-zone');
    if (dz) dz.classList.toggle('is-locked', editing || (!STATE.armed && !hasContent));
  }

  function updateErrorsBadges() {
    var n = STATE.consoleErrors.length;
    var tip = document.querySelector('[data-act="open-errors"] .tool-badge');
    if (tip) { tip.textContent = String(n); }
    var btn = document.querySelector('[data-act="open-errors"]');
    if (btn) {
      btn.classList.toggle('has-errors', n > 0);
      btn.setAttribute('aria-label', _t('aria.errors_count', 'Erreurs console (' + n + ')', { n: n }));
    }
  }

  function updateSortToggleLabel() {
    if (!REFS.sortToggle) return;
    var lbl = REFS.sortToggle.querySelector('.sort-label');
    if (lbl) lbl.textContent = STATE.sortOrder === 'desc' ? 'Z→A' : 'A→Z';
  }

  function applySegFontSize() {
    var wrap = document.querySelector('.biaif-segments-wrap');
    if (wrap) wrap.style.setProperty('--seg-text-size', (STATE.segFontSize || 13) + 'px');
    var fontDown = document.querySelector('[data-act="seg-font-down"]');
    var fontUp   = document.querySelector('[data-act="seg-font-up"]');
    if (fontDown) fontDown.disabled = STATE.segFontSize <= 8;
    if (fontUp)   fontUp.disabled   = STATE.segFontSize >= 16;
  }

  function bumpSegFontSize(delta) {
    var next = Math.max(8, Math.min(16, (STATE.segFontSize || 13) + delta));
    if (next === STATE.segFontSize) return;
    STATE.segFontSize = next;
    applySegFontSize();
    if (window.BIAIFStorage) window.BIAIFStorage.persist(STATE);
  }

  // -----------------------------------------------------------------------
  // Quick-tools relocation (edit mode)
  // -----------------------------------------------------------------------
  function _reattach(qt) {
    if (!qt) return;
    if (typeof STATE.editingDemandeIdx === 'number') {
      var card = document.querySelector('.biaif-segment[data-i="' + STATE.editingDemandeIdx + '"]');
      if (card) {
        var hdr = card.querySelector('header');
        if (hdr && hdr.nextSibling) hdr.parentNode.insertBefore(qt, hdr.nextSibling);
        else card.appendChild(qt);
        return;
      }
    }
    var sessionBar = document.querySelector('.session-bar');
    if (sessionBar && sessionBar.parentNode) sessionBar.parentNode.insertBefore(qt, sessionBar.nextSibling);
    else { var r = document.querySelector('.biaif-root'); if (r) r.appendChild(qt); }
  }

  // -----------------------------------------------------------------------
  // Chip drag-and-drop within editor
  // -----------------------------------------------------------------------
  function _bindDragEvents() {
    document.addEventListener('dragover', function (e) {
      if (!DRAG.chip) return;
      var ed = e.target.closest && e.target.closest('.demande-editor, .demande-text');
      if (!ed || ed !== DRAG.sourceContainer) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    });
    document.addEventListener('drop', function (e) {
      if (!DRAG.chip) return;
      var ed = e.target.closest && e.target.closest('.demande-editor, .demande-text');
      if (!ed || ed !== DRAG.sourceContainer) return;
      e.preventDefault();
      var range = null;
      if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(e.clientX, e.clientY);
      else if (document.caretPositionFromPoint) {
        var pos = document.caretPositionFromPoint(e.clientX, e.clientY);
        if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); range.collapse(true); }
      }
      if (!range || !ed.contains(range.startContainer)) ed.appendChild(DRAG.chip);
      else { DRAG.chip.remove(); range.insertNode(DRAG.chip); }
      if (ed === REFS.demandeEditor) {
        if (window.BIAIFSession) window.BIAIFSession.syncCurrentDemandeFromEditor();
        renderDemandeRefsStrip();
      } else {
        var idx = Number(ed.dataset.i), dem = STATE.demandes[idx];
        if (dem && window.BIAIFSession) window.BIAIFSession.syncDemandeFromTextEl(ed, dem);
      }
      if (window.BIAIFStorage) window.BIAIFStorage.persist(STATE);
      DRAG.chip.classList.remove('is-dragging');
      DRAG.chip = null; DRAG.sourceContainer = null;
    });
    // Chip toggle expand
    document.addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('.ref-chip');
      if (chip) {
        if (e.target.closest('.ref-details-btn') || e.target.closest('.ref-details')) return;
        e.stopPropagation();
        var wasExpanded = chip.classList.contains('expanded');
        document.querySelectorAll('.ref-chip.expanded').forEach(function (c) {
          c.classList.remove('expanded'); c.draggable = true;
        });
        if (!wasExpanded) { chip.classList.add('expanded'); chip.draggable = false; }
        return;
      }
      document.querySelectorAll('.ref-chip.expanded').forEach(function (c) {
        c.classList.remove('expanded'); c.draggable = true;
      });
    });
  }

  window.BIAIFRenderer = {
    init:                   init,
    esc:                    esc,
    renderSegments:         renderSegments,
    renderDemandeEditor:    renderDemandeEditor,
    renderDemandeRefsStrip: renderDemandeRefsStrip,
    appendChipToEditor:     appendChipToEditor,
    makeChipElement:        makeChipElement,
    renderTextWithChips:    renderTextWithChips,
    updateMasterBtnLabel:   updateMasterBtnLabel,
    updateArmedUi:          updateArmedUi,
    updateErrorsBadges:     updateErrorsBadges,
    updateSortToggleLabel:  updateSortToggleLabel,
    applySegFontSize:       applySegFontSize,
    bumpSegFontSize:        bumpSegFontSize,
  };

})(window);
