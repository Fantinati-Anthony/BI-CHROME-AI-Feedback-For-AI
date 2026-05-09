/**
 * BIAIF Filter Panel — popover triggered by the topbar 🔍 (loupe).
 *
 * Replaces the old expandable text input with a compact but complete
 * filter panel covering every facet a vibe-coder needs:
 *   - text   (full-text search across demande text + ref text)
 *   - tag    (user-defined labels, see segment-card tag chips)
 *   - domain (host of any ref's tabUrl)
 *   - page   (full URL of a specific ref)
 *   - conv   (conversationUrl of a demande)
 *   - repo   (GitHub repoId)
 *
 * Each <select> is populated dynamically by scanning STATE.demandes,
 * so users only see facets that actually exist. Active filters are
 * also exposed via the existing filter-chips bar (above the segments
 * list) so they stay visible after closing the popover.
 *
 *   BIAIFFilterPanel.toggle()  → open/close
 *   BIAIFFilterPanel.close()
 */
(function (window) {
  'use strict';

  /** @type {HTMLElement|null} */ var _overlay = null;
  var _trigger = null;

  function _t(k, fb) {
    var U = window.BIAIF && window.BIAIF.utils;
    return (U && U.t) ? U.t(k, fb) : (fb || k);
  }

  function _STATE() {
    var ctx = window.BIAIFRender && window.BIAIFRender.ctx;
    return ctx && ctx.STATE;
  }

  // ── Aggregate unique facet values across the demande list ────────
  function _facets(STATE) {
    var tags = new Set(), domains = new Set(), pages = new Set();
    var convs = new Set(), repos = new Set();
    var DOM = (window.BIAIF && window.BIAIF.dom) || {};
    var hostname = DOM.hostname || function (u) { try { return new URL(u).hostname; } catch (_) { return ''; } };
    (STATE.demandes || []).forEach(function (d) {
      (d.tags || []).forEach(function (t) { if (t) tags.add(t); });
      if (d.conversationUrl) convs.add(d.conversationUrl);
      if (d.repoId) repos.add(d.repoId);
      (d.refs || []).forEach(function (r) {
        if (r.tabUrl) {
          pages.add(r.tabUrl);
          var h = hostname(r.tabUrl);
          if (h) domains.add(h);
        }
        if (r.repoId) repos.add(r.repoId);
      });
    });
    return {
      tags:    Array.from(tags).sort(),
      domains: Array.from(domains).sort(),
      pages:   Array.from(pages).sort(),
      convs:   Array.from(convs).sort(),
      repos:   Array.from(repos).sort(),
    };
  }

  function _option(value, label, current) {
    var safe = String(value || '').replace(/"/g, '&quot;');
    var lbl  = String(label || value || '').replace(/</g, '&lt;');
    var sel  = current === value ? ' selected' : '';
    return '<option value="' + safe + '"' + sel + '>' + lbl + '</option>';
  }

  function _selectField(stateKey, options, currentValue, placeholder) {
    if (!options.length) {
      return '<select disabled><option>— ' + _t('filter.none_yet', 'aucun pour le moment') + ' —</option></select>';
    }
    var opts = '<option value="">' + (placeholder || _t('filter.any', 'tous')) + '</option>';
    options.forEach(function (v) {
      var lbl = v;
      // For URLs, show host + first path segment for compactness.
      if (stateKey === 'pageFilter' || stateKey === 'conversationFilter') {
        try { var u = new URL(v); lbl = u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 30) + (u.pathname.length > 30 ? '…' : '') : ''); } catch (_) {}
      }
      opts += _option(v, lbl, currentValue);
    });
    return '<select data-filter-key="' + stateKey + '">' + opts + '</select>';
  }

  function _build() {
    var STATE = _STATE();
    if (!STATE) return null;
    var f = _facets(STATE);
    var query = STATE.searchQuery || '';

    var ov = document.createElement('div');
    ov.className = 'biaif-filter-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', _t('filter.aria', "Filtrer l'historique"));
    ov.innerHTML =
      '<div class="biaif-filter-panel" role="group">' +
        '<div class="biaif-filter-header">' +
          '<button class="sp-back biaif-filter-back" data-act="filter-close" type="button" aria-label="' +
            _t('filter.close', 'Fermer') + '">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>' +
          '</button>' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/></svg>' +
          '<span>' + _t('filter.title', "Filtrer l'historique") + '</span>' +
          '<button class="biaif-filter-clear" data-act="filter-clear-all" type="button">' +
            _t('filter.clear_all', 'Tout effacer') + '</button>' +
        '</div>' +
        '<input type="search" class="biaif-filter-search" data-filter-search ' +
          'placeholder="' + _t('filter.text_placeholder', 'Recherche plein-texte…') +
          '" value="' + String(query).replace(/"/g, '&quot;') + '">' +
        '<div class="biaif-filter-row"><label>' + _t('filter.tag', 'Tag') + '</label>' +
          _selectField('tagFilter', f.tags, STATE.tagFilter || '') + '</div>' +
        '<div class="biaif-filter-row"><label>' + _t('filter.domain', 'Domaine') + '</label>' +
          _selectField('domainFilter', f.domains, STATE.domainFilter || '') + '</div>' +
        '<div class="biaif-filter-row"><label>' + _t('filter.page', 'Page') + '</label>' +
          _selectField('pageFilter', f.pages, STATE.pageFilter || '') + '</div>' +
        '<div class="biaif-filter-row"><label>' + _t('filter.conv', 'Conversation') + '</label>' +
          _selectField('conversationFilter', f.convs, STATE.conversationFilter || '') + '</div>' +
        '<div class="biaif-filter-row"><label>' + _t('filter.repo', 'Repo') + '</label>' +
          _selectField('repoFilter', f.repos, STATE.repoFilter || '') + '</div>' +
        '<div class="biaif-filter-stats">' +
          (STATE.demandes || []).length + ' ' + _t('filter.total', 'demandes') +
        '</div>' +
      '</div>';
    return ov;
  }

  function _applyChange(key, value) {
    var STATE = _STATE();
    if (!STATE) return;
    STATE[key] = value || '';
    if (key === 'conversationFilter' && !value) STATE.pendingConversationUrl = null;
    if (key === 'repoFilter'         && !value) STATE.pendingRepoId          = null;
    if (window.BIAIFRenderer && window.BIAIFRenderer.renderSegments) window.BIAIFRenderer.renderSegments();
  }

  function _bindOverlay() {
    if (!_overlay) return;
    var backBtn = _overlay.querySelector('[data-act="filter-close"]');
    if (backBtn) backBtn.addEventListener('click', close);
    var input = _overlay.querySelector('[data-filter-search]');
    if (input) {
      input.addEventListener('input', function () {
        var STATE = _STATE();
        if (!STATE) return;
        STATE.searchQuery = input.value || '';
        if (window.BIAIFRenderer) window.BIAIFRenderer.renderSegments();
      });
      setTimeout(function () { input.focus(); }, 30);
    }
    _overlay.querySelectorAll('select[data-filter-key]').forEach(function (sel) {
      sel.addEventListener('change', function () { _applyChange(sel.dataset.filterKey, sel.value); });
    });
    var clear = _overlay.querySelector('[data-act="filter-clear-all"]');
    if (clear) clear.addEventListener('click', function () {
      var STATE = _STATE();
      if (!STATE) return;
      ['searchQuery','tagFilter','domainFilter','pageFilter','conversationFilter','repoFilter']
        .forEach(function (k) { STATE[k] = ''; });
      STATE.pendingConversationUrl = null;
      STATE.pendingRepoId          = null;
      if (window.BIAIFRenderer) window.BIAIFRenderer.renderSegments();
      close();
    });
    document.addEventListener('keydown', _onKey, true);
  }

  function _onKey(e) {
    if (e.key === 'Escape' && _overlay) { e.preventDefault(); close(); }
  }

  function open() {
    if (_overlay) return;
    // Defensive: a previous overlay may still be in DOM mid-slide-out.
    // Remove it synchronously so we don't briefly stack two panels.
    var stale = document.querySelector('.biaif-filter-overlay');
    if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
    _overlay = _build();
    if (!_overlay) return;
    document.body.appendChild(_overlay);
    _bindOverlay();
    // Force a reflow so the browser registers the initial offscreen state
    // before the .is-open class triggers the slide-in transition.
    // eslint-disable-next-line no-unused-expressions
    _overlay.offsetWidth;
    _overlay.classList.add('is-open');
    _trigger = document.querySelector('[data-act="filter-toggle"], [data-act="search-toggle"]');
    if (_trigger) _trigger.setAttribute('aria-expanded', 'true');
  }

  function close() {
    if (!_overlay) return;
    document.removeEventListener('keydown', _onKey, true);
    var ov = _overlay;
    _overlay = null;
    if (_trigger) _trigger.setAttribute('aria-expanded', 'false');
    _trigger = null;
    // Trigger slide-out, then remove from DOM after the transition completes.
    ov.classList.remove('is-open');
    var done = false;
    var finish = function () {
      if (done) return;
      done = true;
      if (ov.parentNode) ov.parentNode.removeChild(ov);
    };
    ov.addEventListener('transitionend', finish, { once: true });
    // Fallback in case transitionend doesn't fire (e.g. reduced motion).
    setTimeout(finish, 320);
  }

  function toggle() { _overlay ? close() : open(); }

  window.BIAIFFilterPanel = { open: open, close: close, toggle: toggle };
})(window);
