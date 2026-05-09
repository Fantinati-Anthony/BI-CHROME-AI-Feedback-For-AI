/**
 * BIAIF Render — Segments orchestrator
 *
 * Top-level renderer: filters STATE.demandes against the active search +
 * filter chips, sorts, groups by conversation, and appends to REFS.segments.
 * Delegates the actual card / group / archive markup to the corresponding
 * modules — this file just wires them together.
 *
 * Public API:
 *   render()           — full re-render (debounced upstream when possible)
 *   setFilter(k, v)    — set a STATE filter slot and re-render
 *   filter()           — returns the currently filtered display list
 */
(function (window) {
  'use strict';
  window.BIAIFRender = window.BIAIFRender || {};
  var ctx   = window.BIAIFRender.ctx;
  var DOM   = (window.BIAIF && window.BIAIF.dom)   || {};
  var UTILS = (window.BIAIF && window.BIAIF.utils) || {};
  function _t(k, fb, vars) { return UTILS.t ? UTILS.t(k, fb, vars) : (fb || k); }

  function _matchesText(dem, q) {
    if (!q) return true;
    var refsStr = (dem.refs || []).map(function (r) {
      return [r.selector, r.msg, r.mode, r.tag, r.tabUrl, r.repoId].join(' ');
    }).join(' ').toLowerCase();
    return (dem.text || '').toLowerCase().includes(q)
        || refsStr.includes(q)
        || (dem.url || '').toLowerCase().includes(q)
        || (dem.repoId || '').toLowerCase().includes(q)
        || (dem.conversationUrl || '').toLowerCase().includes(q);
  }

  function filter() {
    var STATE = ctx.STATE;
    var q  = (STATE.searchQuery        || '').toLowerCase().trim();
    var cf = (STATE.conversationFilter || '').trim();
    var rf = (STATE.repoFilter         || '').trim();
    var df = (STATE.domainFilter       || '').trim();
    var pf = (STATE.pageFilter         || '').trim();
    var tf = (STATE.tagFilter          || '').trim().toLowerCase();
    var hostname = DOM.hostname || function (u) { try { return new URL(u).hostname; } catch (_) { return ''; } };

    return STATE.demandes
      .map(function (d, i) { return { dem: d, origIndex: i }; })
      .filter(function (item) {
        var dem  = item.dem;
        var refs = dem.refs || [];
        if (cf && dem.conversationUrl !== cf) return false;
        if (rf) {
          var hasRepo = dem.repoId === rf || refs.some(function (r) { return r.repoId === rf; });
          if (!hasRepo) return false;
        }
        if (df) {
          var hasDom = hostname(dem.conversationUrl || '') === df ||
            refs.some(function (r) { return hostname(r.tabUrl || '') === df; });
          if (!hasDom) return false;
        }
        if (pf && !refs.some(function (r) { return r.tabUrl === pf; })) return false;
        if (tf) {
          var tags = (dem.tags || []).map(function (t) { return String(t || '').toLowerCase(); });
          if (tags.indexOf(tf) === -1) return false;
        }
        return _matchesText(dem, q);
      });
  }

  function render() {
    var REFS = ctx.REFS, STATE = ctx.STATE;
    if (!REFS.segments) return;

    var R  = window.BIAIFRender;

    REFS.segments.innerHTML = '';
    if (REFS.segmentsCount) REFS.segmentsCount.textContent = String(STATE.demandes.length);

    R.filterChips.build(REFS.segments);

    var filtered = filter();

    if (!STATE.demandes.length) {
      REFS.segments.appendChild(DOM.makeEmpty(_t('segments.empty', 'Aucune demande pour le moment')));
      R.uiState.updateMasterBtnLabel();
      R.uiState.updateArmedUi();
      return;
    }
    if (!filtered.length) {
      REFS.segments.appendChild(DOM.makeEmpty(_t('segments.no_results', 'Aucun résultat pour cette recherche')));
      R.uiState.updateMasterBtnLabel();
      R.uiState.updateArmedUi();
      return;
    }

    var display = filtered.slice();
    if (STATE.sortOrder === 'desc') display.reverse();

    var groups     = R.convGroups.build(display);
    var orphanDone = [];
    groups.forEach(function (group) {
      if (group.isGroup) {
        REFS.segments.appendChild(R.convGroups.buildElement(group));
      } else {
        var item = group.items[0];
        if (item.dem.status === 'done') orphanDone.push(item);
        else REFS.segments.appendChild(R.segmentCard.build(item.dem, item.origIndex));
      }
    });

    if (orphanDone.length) {
      REFS.segments.appendChild(R.archiveZone.build(orphanDone));
    }

    R.uiState.updateMasterBtnLabel();
    R.uiState.updateArmedUi();
    // Overflow detection runs after browser has laid out the new cards
    requestAnimationFrame(_checkTextOverflow);
  }

  function _checkTextOverflow() {
    document.querySelectorAll('.demande-text:not(.demande-text-empty)').forEach(function (el) {
      var overflows = el.scrollHeight > el.clientHeight + 2;
      el.classList.toggle('has-overflow', overflows && !el.classList.contains('is-expanded'));
      var btn = el.nextElementSibling;
      if (btn && btn.classList.contains('demande-text-toggle')) {
        btn.classList.toggle('is-visible', overflows);
        btn.textContent = el.classList.contains('is-expanded') ? '▲ Réduire' : '▼ Voir plus';
      }
    });
  }

  function setFilter(key, val) {
    if (key in ctx.STATE) {
      ctx.STATE[key] = val || '';
      render();
    }
  }

  // Single delegated click handler for ALL segment cards (eliminates the
  // 12+ per-card listeners that used to be attached on each render).
  var _delegatedBound = false;
  function ensureDelegatedHandlers() {
    if (_delegatedBound) return;
    _delegatedBound = true;
    var wrap = document.querySelector('.biaif-segments') || document.body;
    var ALL = (window.BIAIF && window.BIAIF.ALL_BUTTONS) || [];
    var FN_BY_SLUG = ALL.reduce(function (acc, def) {
      if (def.exportFn) acc['seg-' + def.slug] = def.exportFn;
      return acc;
    }, {});

    wrap.addEventListener('click', function (e) {
      var actEl = e.target.closest && e.target.closest('[data-act]');
      if (!actEl) return;
      var card = actEl.closest('.biaif-segment');
      if (!card) return;
      var idx  = Number(card.dataset.i);
      if (Number.isNaN(idx)) return;
      var act  = actEl.dataset.act;

      if (act === 'seg-edit' || actEl.classList.contains('seg-edit-btn')) {
        e.stopPropagation();
        if (!window.BIAIFSession) return;
        if (ctx.STATE.editingDemandeIdx === idx) window.BIAIFSession.exitEditMode();
        else window.BIAIFSession.enterEditMode(idx);
        return;
      }
      if (actEl.classList.contains('seg-del')) {
        e.stopPropagation();
        var STATE = ctx.STATE;
        if (STATE.editingDemandeIdx === idx && window.BIAIFSession) window.BIAIFSession.exitEditMode({ silent: true });
        if (typeof STATE.editingDemandeIdx === 'number' && STATE.editingDemandeIdx > idx) STATE.editingDemandeIdx--;
        STATE.demandes.splice(idx, 1);
        render();
        if (window.BIAIFStorage) window.BIAIFStorage.persist(STATE);
        if (window.BIAIFToast && window.BIAIFToast.showAction) {
          window.BIAIFToast.showAction(
            _t('toast.demande_deleted', 'Demande #' + (idx + 1) + ' supprimée.', { n: idx + 1 }),
            _t('toast.undo_action', 'Annuler'),
            function () {
              if (window.BIAIFBindings && window.BIAIFBindings.helpers) {
                window.BIAIFBindings.helpers.performUndo();
              }
            },
            { duration: 6000 }
          );
        }
        return;
      }
      if (act === 'seg-expand-text' || act === 'seg-expand-text-btn') {
        e.stopPropagation();
        var textEl = card.querySelector('.demande-text');
        if (!textEl || textEl.classList.contains('demande-text-empty')) return;
        textEl.classList.toggle('is-expanded');
        var overflows = textEl.scrollHeight > textEl.clientHeight + 2;
        textEl.classList.toggle('has-overflow', overflows && !textEl.classList.contains('is-expanded'));
        var toggleBtn = textEl.nextElementSibling;
        if (toggleBtn && toggleBtn.classList.contains('demande-text-toggle')) {
          toggleBtn.textContent = textEl.classList.contains('is-expanded') ? '▲ Réduire' : '▼ Voir plus';
        }
        return;
      }

      if (act === 'seg-tag-add') {
        e.stopPropagation();
        var stT = ctx.STATE;
        if (!stT.demandes[idx]) return;
        if (window.BIAIFTagPicker) {
          window.BIAIFTagPicker.open(idx, stT);
        }
        return;
      }

      var exportFnName = FN_BY_SLUG[act];
      if (exportFnName) {
        e.stopPropagation();
        var fn = window.BIAIFExport && window.BIAIFExport[exportFnName];
        if (typeof fn === 'function') fn(idx);
      }
    });

    // ── Tag delete (per-tag ✕ inside chip) ─────────────────────────
    wrap.addEventListener('click', function (e) {
      var del = e.target.closest && e.target.closest('[data-tag-del]');
      if (!del) return;
      e.stopPropagation();
      var card = del.closest('.biaif-segment');
      if (!card) return;
      var idx = Number(card.dataset.i);
      if (Number.isNaN(idx)) return;
      var tag = del.dataset.tagDel;
      var st = ctx.STATE;
      var d  = st.demandes[idx];
      if (!d || !Array.isArray(d.tags)) return;
      d.tags = d.tags.filter(function (t) { return t !== tag; });
      // If we just removed the active filter target, clear the filter too.
      if (st.tagFilter === tag) st.tagFilter = '';
      render();
      if (window.BIAIFStorage) window.BIAIFStorage.persist(st);
    });

    // ── Drag-drop merge / reorder (delegated, was per-card before) ───
    function _idxFor(target) {
      var card = target.closest && target.closest('.biaif-segment');
      if (!card) return -1;
      var i = Number(card.dataset.i);
      return Number.isNaN(i) ? -1 : i;
    }
    function _dropMode(card, e) {
      var rect = card.getBoundingClientRect();
      var y    = e.clientY - rect.top;
      if (y < rect.height * 0.25) return 'before';
      if (y > rect.height * 0.75) return 'after';
      return 'merge';
    }
    function _clearAll() {
      document.querySelectorAll('.biaif-segment.is-drop-target, .biaif-segment.is-drop-before, .biaif-segment.is-drop-after')
        .forEach(function (c) { c.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after'); });
    }

    // dragstart MUST come from the handle element (HTML5 DnD requires it)
    wrap.addEventListener('dragstart', function (e) {
      var handle = e.target.closest && e.target.closest('.seg-drag-handle');
      if (!handle) return;
      var idx = _idxFor(handle);
      if (idx < 0) return;
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', '__biaif_segment__'); } catch (_) {}
      ctx.SEG_DRAG.sourceIdx = idx;
      var card = handle.closest('.biaif-segment');
      if (card) card.classList.add('is-dragging-seg');
    });
    wrap.addEventListener('dragend', function () {
      ctx.SEG_DRAG.sourceIdx = -1;
      document.querySelectorAll('.biaif-segment.is-dragging-seg').forEach(function (c) {
        c.classList.remove('is-dragging-seg');
      });
      _clearAll();
    });
    wrap.addEventListener('dragover', function (e) {
      var card = e.target.closest && e.target.closest('.biaif-segment');
      if (!card || ctx.SEG_DRAG.sourceIdx < 0) return;
      var idx = Number(card.dataset.i);
      if (idx === ctx.SEG_DRAG.sourceIdx) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      var mode = _dropMode(card, e);
      ctx.SEG_DRAG.dropMode = mode;
      _clearAll();
      card.classList.add(mode === 'merge' ? 'is-drop-target' : (mode === 'before' ? 'is-drop-before' : 'is-drop-after'));
    });
    wrap.addEventListener('dragleave', function (e) {
      var card = e.target.closest && e.target.closest('.biaif-segment');
      if (!card) return;
      if (e.relatedTarget && card.contains(e.relatedTarget)) return;
      card.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after');
    });
    wrap.addEventListener('drop', function (e) {
      var card = e.target.closest && e.target.closest('.biaif-segment');
      if (!card || ctx.SEG_DRAG.sourceIdx < 0) return;
      var idx = Number(card.dataset.i);
      if (idx === ctx.SEG_DRAG.sourceIdx) return;
      e.preventDefault(); _clearAll();
      var src  = ctx.SEG_DRAG.sourceIdx; ctx.SEG_DRAG.sourceIdx = -1;
      var mode = ctx.SEG_DRAG.dropMode || 'merge';
      ctx.SEG_DRAG.dropMode = null;
      if (!window.BIAIFSession) return;
      if (mode === 'merge') window.BIAIFSession.mergeDemandes(src, idx);
      else                  window.BIAIFSession.reorderDemande(src, mode === 'before' ? idx : idx + 1);
    });

    // Alt+↑/↓ on the focused drag handle merges with neighbours.
    wrap.addEventListener('keydown', function (e) {
      if (!e.altKey) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      var handle = e.target.closest && e.target.closest('.seg-drag-handle');
      if (!handle) return;
      var idx = _idxFor(handle);
      var dst = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
      if (idx < 0 || dst < 0 || dst >= ctx.STATE.demandes.length) return;
      e.preventDefault();
      if (window.BIAIFSession) window.BIAIFSession.mergeDemandes(idx, dst);
    });
  }

  // Auto-bind on the first render() so the wrapper exists in the DOM.
  var _origRender = render;
  render = function () { _origRender(); ensureDelegatedHandlers(); };

  window.BIAIFRender.segments = {
    render:    render,
    setFilter: setFilter,
    filter:    filter,
  };
})(window);
