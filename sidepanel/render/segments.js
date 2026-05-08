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
        return _matchesText(dem, q);
      });
  }

  // Tear down the current quick-tools / filter bar / segments before re-rendering.
  function _detachQuickTools() {
    var qt = document.querySelector('.biaif-quick-tools');
    if (qt && qt.parentNode) qt.parentNode.removeChild(qt);
    return qt;
  }

  function _reattachQuickTools(qt) {
    if (!qt) return;
    // Unified zone: quick-tools live as a sibling AFTER .topbar-row
    // (so the topbar's single-line layout stays intact).
    var anchor = document.querySelector('.topbar-row') || document.querySelector('.session-bar');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(qt, anchor.nextSibling);
    else { var r = document.querySelector('.biaif-root'); if (r) r.appendChild(qt); }
  }

  function render() {
    var REFS = ctx.REFS, STATE = ctx.STATE;
    if (!REFS.segments) return;

    var qt = _detachQuickTools();
    var R  = window.BIAIFRender;

    REFS.segments.innerHTML = '';
    if (REFS.segmentsCount) REFS.segmentsCount.textContent = String(STATE.demandes.length);

    R.filterChips.build(REFS.segments);

    var filtered = filter();

    if (!STATE.demandes.length) {
      REFS.segments.appendChild(DOM.makeEmpty(_t('segments.empty', 'Aucune demande pour le moment')));
      _reattachQuickTools(qt);
      R.uiState.updateMasterBtnLabel();
      R.uiState.updateArmedUi();
      return;
    }
    if (!filtered.length) {
      REFS.segments.appendChild(DOM.makeEmpty(_t('segments.no_results', 'Aucun résultat pour cette recherche')));
      _reattachQuickTools(qt);
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

    _reattachQuickTools(qt);
    R.uiState.updateMasterBtnLabel();
    R.uiState.updateArmedUi();
  }

  function setFilter(key, val) {
    if (key in ctx.STATE) {
      ctx.STATE[key] = val || '';
      render();
    }
  }

  window.BIAIFRender.segments = {
    render:    render,
    setFilter: setFilter,
    filter:    filter,
  };
})(window);
