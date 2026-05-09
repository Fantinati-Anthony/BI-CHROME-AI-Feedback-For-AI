/**
 * BIAIFTagPicker — tag management popover.
 *
 * Opens from any "+ tag" button on a segment card.
 * Features:
 *   - Lists all tags across all segments (global discovery)
 *   - Toggle a tag on/off on the current segment in one click
 *   - Search filters the list; typing a non-existent tag shows "Create #foo"
 *   - Enter key on search creates + adds the tag immediately
 *   - Chip color auto-generated from tag name hash (consistent across sessions)
 *
 * Public API:
 *   BIAIFTagPicker.open(segIdx, STATE)
 *   BIAIFTagPicker.close()
 */
(function (window) {
  'use strict';

  var _overlay = null;
  var _segIdx  = -1;
  var _STATE   = null;

  function _t(k, fb) {
    var U = window.BIAIF && window.BIAIF.utils;
    return (U && U.t) ? U.t(k, fb) : (fb || k);
  }

  /* Deterministic hue 0-359 from tag string */
  function _hue(name) {
    var h = 5381;
    for (var i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) & 0xffff;
    return Math.abs(h) % 360;
  }

  function _chipVars(name, active) {
    var hue = _hue(name);
    return active
      ? { bg: 'hsl(' + hue + ',60%,18%)', border: 'hsl(' + hue + ',70%,48%)', text: 'hsl(' + hue + ',90%,78%)' }
      : { bg: 'hsl(' + hue + ',50%,11%)', border: 'hsl(' + hue + ',45%,28%)', text: 'hsl(' + hue + ',75%,62%)' };
  }

  /* Normalize: lowercase, letters/digits/-/_, strip rest, max 24 chars */
  function _norm(raw) {
    return String(raw || '').trim().toLowerCase()
      .replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '').replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 24);
  }

  /* Collect all known tags from every segment (sorted) */
  function _allTags(STATE) {
    var seen = Object.create(null);
    (STATE.demandes || []).forEach(function (d) {
      (d.tags || []).forEach(function (t) { if (t) seen[t] = true; });
    });
    return Object.keys(seen).sort();
  }

  /* ── DOM helpers ─────────────────────────────────────────────── */

  function _chip(tag, active, onClick) {
    var c   = _chipVars(tag, active);
    var btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'biaif-tp-chip' + (active ? ' is-active' : '');
    btn.style.cssText =
      '--tp-bg:' + c.bg + ';--tp-bd:' + c.border + ';--tp-tx:' + c.text;
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.setAttribute('title', active ? _t('tagpicker.remove', 'Retirer ce tag') : _t('tagpicker.add', 'Ajouter ce tag'));

    var hash = document.createElement('span');
    hash.className   = 'biaif-tp-hash';
    hash.textContent = '#';
    var lbl = document.createElement('span');
    lbl.textContent  = tag;
    var chk = document.createElement('span');
    chk.className    = 'biaif-tp-chk';
    chk.setAttribute('aria-hidden', 'true');

    btn.appendChild(hash);
    btn.appendChild(lbl);
    btn.appendChild(chk);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function _createBtn(tag, onClick) {
    var btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'biaif-tp-create';
    btn.innerHTML =
      '<span class="biaif-tp-create-icon" aria-hidden="true">+</span>' +
      '<span>' + _t('tagpicker.create', 'Créer') + ' </span>' +
      '<span class="biaif-tp-create-tag">#' + tag + '</span>';
    btn.addEventListener('click', onClick);
    return btn;
  }

  function _section(label) {
    var wrap = document.createElement('div');
    wrap.className = 'biaif-tp-section';
    var lbl = document.createElement('div');
    lbl.className   = 'biaif-tp-section-lbl';
    lbl.textContent = label;
    var chips = document.createElement('div');
    chips.className = 'biaif-tp-chips';
    wrap.appendChild(lbl);
    wrap.appendChild(chips);
    return { wrap: wrap, chips: chips };
  }

  /* ── Render body ─────────────────────────────────────────────── */

  function _render(body, searchEl) {
    body.innerHTML = '';
    var STATE   = _STATE;
    var segIdx  = _segIdx;
    var query   = _norm(searchEl ? searchEl.value : '');
    var dem     = (STATE.demandes || [])[segIdx];
    var active  = dem ? (dem.tags || []).slice() : [];
    var all     = _allTags(STATE);

    /* Filter by query */
    var filtered = query ? all.filter(function (t) { return t.indexOf(query) !== -1; }) : all;
    var isNew    = query && filtered.indexOf(query) === -1;

    /* ── Active chips ── */
    var shownActive = query ? active.filter(function (t) { return t.indexOf(query) !== -1; }) : active;
    if (shownActive.length) {
      var sec = _section(_t('tagpicker.active_label', 'Actifs sur ce segment'));
      shownActive.forEach(function (tag) {
        sec.chips.appendChild(_chip(tag, true, function () {
          _toggle(tag); _render(body, searchEl);
        }));
      });
      body.appendChild(sec.wrap);
    }

    /* ── Other available tags ── */
    var others = filtered.filter(function (t) { return active.indexOf(t) === -1; });
    if (others.length || isNew) {
      var sec2 = _section(_t('tagpicker.all_label', 'Tous les tags'));
      others.forEach(function (tag) {
        sec2.chips.appendChild(_chip(tag, false, function () {
          _toggle(tag); _render(body, searchEl);
        }));
      });
      if (isNew) {
        sec2.chips.appendChild(_createBtn(query, function () {
          _createAndAdd(query, body, searchEl);
        }));
      }
      body.appendChild(sec2.wrap);
    }

    /* ── Empty state ── */
    if (!shownActive.length && !others.length && !isNew) {
      var empty = document.createElement('div');
      empty.className   = 'biaif-tp-empty';
      empty.textContent = query
        ? _t('tagpicker.no_match', 'Aucun tag correspondant')
        : _t('tagpicker.hint', 'Tapez pour créer votre premier tag');
      body.appendChild(empty);
    }

    /* ── Stats footer ── */
    var stats = document.createElement('div');
    stats.className   = 'biaif-tp-stats';
    var nActive = active.length;
    var nTotal  = all.length;
    stats.textContent =
      nActive + ' ' + _t('tagpicker.active_count', 'actif' + (nActive > 1 ? 's' : '')) +
      ' · ' + nTotal + ' ' + _t('tagpicker.total_count', 'au total');
    body.appendChild(stats);
  }

  /* ── Actions ─────────────────────────────────────────────────── */

  function _toggle(tag) {
    var dem = (_STATE.demandes || [])[_segIdx];
    if (!dem) return;
    if (!dem.tags) dem.tags = [];
    var i = dem.tags.indexOf(tag);
    if (i !== -1) {
      dem.tags.splice(i, 1);
      if (_STATE.tagFilter === tag) _STATE.tagFilter = '';
    } else {
      if (dem.tags.length >= 10) return;
      dem.tags.push(tag);
    }
    _persist();
  }

  function _createAndAdd(tag, body, searchEl) {
    var n = _norm(tag);
    if (!n) return;
    var dem = (_STATE.demandes || [])[_segIdx];
    if (dem) {
      if (!dem.tags) dem.tags = [];
      if (dem.tags.indexOf(n) === -1 && dem.tags.length < 10) dem.tags.push(n);
    }
    _persist();
    if (searchEl) searchEl.value = '';
    _render(body, searchEl);
  }

  function _persist() {
    if (window.BIAIFStorage)  window.BIAIFStorage.persist(_STATE);
    if (window.BIAIFRenderer) window.BIAIFRenderer.renderSegments();
  }

  /* ── Public open/close ───────────────────────────────────────── */

  function open(segIdx, STATE) {
    if (_overlay) close();
    _segIdx = segIdx;
    _STATE  = STATE;

    /* Backdrop */
    _overlay = document.createElement('div');
    _overlay.className = 'biaif-tp-overlay';
    _overlay.setAttribute('role', 'dialog');
    _overlay.setAttribute('aria-modal', 'true');
    _overlay.setAttribute('aria-label', _t('tagpicker.aria', 'Gestionnaire de tags'));
    _overlay.addEventListener('click', function (e) { if (e.target === _overlay) close(); });

    /* Panel */
    var panel = document.createElement('div');
    panel.className = 'biaif-tp-panel';

    /* Header */
    var header = document.createElement('div');
    header.className = 'biaif-tp-header';
    header.innerHTML =
      '<svg class="biaif-tp-header-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>' +
      '<line x1="7" y1="7" x2="7.01" y2="7"/></svg>' +
      '<span class="biaif-tp-title">' + _t('tagpicker.title', 'Tags') + '</span>';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'biaif-tp-close';
    closeBtn.type      = 'button';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', _t('tagpicker.close', 'Fermer'));
    closeBtn.addEventListener('click', close);
    header.appendChild(closeBtn);

    /* Search */
    var searchWrap = document.createElement('div');
    searchWrap.className = 'biaif-tp-search-wrap';
    var searchSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="biaif-tp-search-icon">' +
      '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    searchWrap.innerHTML = searchSvg;
    var searchEl = document.createElement('input');
    searchEl.className   = 'biaif-tp-search';
    searchEl.type        = 'search';
    searchEl.placeholder = _t('tagpicker.placeholder', 'Rechercher ou créer un tag…');
    searchEl.setAttribute('autocomplete', 'off');
    searchEl.setAttribute('spellcheck', 'false');
    searchWrap.appendChild(searchEl);

    /* Body */
    var body = document.createElement('div');
    body.className = 'biaif-tp-body';

    panel.appendChild(header);
    panel.appendChild(searchWrap);
    panel.appendChild(body);
    _overlay.appendChild(panel);
    document.body.appendChild(_overlay);

    /* Events */
    searchEl.addEventListener('input', function () { _render(body, searchEl); });
    searchEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Enter') {
        var n = _norm(searchEl.value);
        if (n) { e.preventDefault(); _createAndAdd(n, body, searchEl); }
      }
    });

    _render(body, searchEl);
    setTimeout(function () { searchEl.focus(); }, 30);
  }

  function close() {
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;
  }

  window.BIAIFTagPicker = { open: open, close: close };
})(window);
