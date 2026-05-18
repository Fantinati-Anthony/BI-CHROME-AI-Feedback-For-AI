/**
 * MyFbTagPicker — tag management popover.
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
 *   MyFbTagPicker.open(segIdx, STATE)
 *   MyFbTagPicker.close()
 */
(function (window) {
  'use strict';

  var _overlay = null;
  var _segIdx  = -1;
  var _STATE   = null;

  function _t(k, fb) {
    var U = window.MyFb && window.MyFb.utils;
    return (U && U.t) ? U.t(k, fb) : (fb || k);
  }

  /* Deterministic hue 0-359 from tag string, or user-chosen override
     from STATE.tagColors[name] (set via the edit popover). */
  function _hue(name) {
    if (_STATE && _STATE.tagColors && typeof _STATE.tagColors[name] === 'number') {
      return _STATE.tagColors[name];
    }
    var h = 5381;
    for (var i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) & 0xffff;
    return Math.abs(h) % 360;
  }

  /* 10 preset hues offered in the edit popover (rainbow-ordered). */
  var PRESET_HUES = [0, 30, 50, 90, 120, 180, 220, 250, 290, 320];

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

  function _chip(tag, active, onClick, opts) {
    var c   = _chipVars(tag, active);
    var btn = document.createElement('div');
    btn.className = 'myfb-tp-chip' + (active ? ' is-active' : '');
    btn.style.cssText =
      '--tp-bg:' + c.bg + ';--tp-bd:' + c.border + ';--tp-tx:' + c.text;
    btn.setAttribute('role', 'group');

    var body = document.createElement('button');
    body.type      = 'button';
    body.className = 'myfb-tp-chip-body';
    body.setAttribute('aria-pressed', active ? 'true' : 'false');
    body.setAttribute('title', active ? _t('tagpicker.remove', 'Retirer ce tag') : _t('tagpicker.add', 'Ajouter ce tag'));

    var hash = document.createElement('span');
    hash.className   = 'myfb-tp-hash';
    hash.textContent = '#';
    var lbl = document.createElement('span');
    lbl.textContent  = tag;
    var chk = document.createElement('span');
    chk.className    = 'myfb-tp-chk';
    chk.setAttribute('aria-hidden', 'true');
    body.appendChild(hash);
    body.appendChild(lbl);
    body.appendChild(chk);
    body.addEventListener('click', onClick);
    btn.appendChild(body);

    /* Edit + delete affordances on every chip (opts.actions !== false) */
    if (!opts || opts.actions !== false) {
      var edit = document.createElement('button');
      edit.type        = 'button';
      edit.className   = 'myfb-tp-action myfb-tp-edit';
      edit.title       = _t('tagpicker.edit_tag', 'Modifier ce tag');
      edit.setAttribute('aria-label', edit.title);
      edit.textContent = '✏';
      edit.addEventListener('click', function (e) {
        e.stopPropagation();
        _openEdit(tag, btn);
      });
      btn.appendChild(edit);

      var del = document.createElement('button');
      del.type        = 'button';
      del.className   = 'myfb-tp-action myfb-tp-del';
      del.title       = _t('tagpicker.delete_tag', 'Supprimer ce tag globalement');
      del.setAttribute('aria-label', del.title);
      del.textContent = '×';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        _deleteEverywhere(tag);
      });
      btn.appendChild(del);
    }

    return btn;
  }

  function _createBtn(tag, onClick) {
    var btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'myfb-tp-create';
    btn.innerHTML =
      '<span class="myfb-tp-create-icon" aria-hidden="true">+</span>' +
      '<span>' + _t('tagpicker.create', 'Créer') + ' </span>' +
      '<span class="myfb-tp-create-tag">#' + tag + '</span>';
    btn.addEventListener('click', onClick);
    return btn;
  }

  function _section(label) {
    var wrap = document.createElement('div');
    wrap.className = 'myfb-tp-section';
    var lbl = document.createElement('div');
    lbl.className   = 'myfb-tp-section-lbl';
    lbl.textContent = label;
    var chips = document.createElement('div');
    chips.className = 'myfb-tp-chips';
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
      empty.className   = 'myfb-tp-empty';
      empty.textContent = query
        ? _t('tagpicker.no_match', 'Aucun tag correspondant')
        : _t('tagpicker.hint', 'Tapez pour créer votre premier tag');
      body.appendChild(empty);
    }

    /* ── Stats footer ── */
    var stats = document.createElement('div');
    stats.className   = 'myfb-tp-stats';
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
    if (window.MyFbStorage)  window.MyFbStorage.persist(_STATE);
    if (window.MyFbRenderer) window.MyFbRenderer.renderSegments();
  }

  /* ── Tag management (rename / recolor / delete-everywhere) ──────── */

  function _ensureColors() {
    if (!_STATE.tagColors || typeof _STATE.tagColors !== 'object') _STATE.tagColors = {};
    return _STATE.tagColors;
  }

  function _renameEverywhere(oldName, newRaw) {
    var newName = _norm(newRaw);
    if (!newName || newName === oldName) return false;
    // 1. swap in every demande.tags
    (_STATE.demandes || []).forEach(function (d) {
      if (!d || !Array.isArray(d.tags)) return;
      var idx = d.tags.indexOf(oldName);
      if (idx === -1) return;
      d.tags.splice(idx, 1);
      if (d.tags.indexOf(newName) === -1) d.tags.push(newName);
    });
    // 2. carry over the color override (if any)
    var colors = _ensureColors();
    if (Object.prototype.hasOwnProperty.call(colors, oldName)) {
      if (!Object.prototype.hasOwnProperty.call(colors, newName)) colors[newName] = colors[oldName];
      delete colors[oldName];
    }
    // 3. tagFilter
    if (_STATE.tagFilter === oldName) _STATE.tagFilter = newName;
    return true;
  }

  function _deleteEverywhere(tag) {
    if (!confirm(_t('tagpicker.delete_confirm', 'Supprimer le tag « ' + tag + ' » de toutes les demandes ?'))) return;
    (_STATE.demandes || []).forEach(function (d) {
      if (!d || !Array.isArray(d.tags)) return;
      var i = d.tags.indexOf(tag);
      if (i !== -1) d.tags.splice(i, 1);
    });
    var colors = _ensureColors();
    delete colors[tag];
    if (_STATE.tagFilter === tag) _STATE.tagFilter = '';
    _persist();
    // re-render the open panel
    var body = _overlay && _overlay.querySelector('.myfb-tp-body');
    var search = _overlay && _overlay.querySelector('.myfb-tp-search');
    if (body) _render(body, search);
  }

  function _openEdit(tag, anchor) {
    // Close any open editor first
    var prev = document.querySelector('.myfb-tp-editor');
    if (prev) prev.remove();

    var editor = document.createElement('div');
    editor.className = 'myfb-tp-editor';
    editor.innerHTML =
      '<div class="myfb-tp-editor-row">' +
        '<label class="myfb-tp-editor-label">' + _t('tagpicker.edit_name', 'Nom') + '</label>' +
        '<input type="text" class="myfb-tp-editor-name" maxlength="24" />' +
      '</div>' +
      '<div class="myfb-tp-editor-row">' +
        '<label class="myfb-tp-editor-label">' + _t('tagpicker.edit_color', 'Couleur') + '</label>' +
        '<div class="myfb-tp-swatches"></div>' +
      '</div>' +
      '<div class="myfb-tp-editor-actions">' +
        '<button type="button" class="myfb-tp-editor-cancel">' + _t('tagpicker.cancel', 'Annuler') + '</button>' +
        '<button type="button" class="myfb-tp-editor-save">'   + _t('tagpicker.save',   'Enregistrer') + '</button>' +
      '</div>';

    // Build swatches via DOM API so the inline style.background isn't
    // blocked by the strict `style-src 'self'` CSP (which rejects
    // inline `style="…"` attributes, even though .style.X = … works).
    var swatchesHost = editor.querySelector('.myfb-tp-swatches');
    PRESET_HUES.forEach(function (h) {
      var sw = document.createElement('button');
      sw.type      = 'button';
      sw.className = 'myfb-tp-swatch';
      sw.setAttribute('data-hue', String(h));
      sw.setAttribute('aria-label', 'Hue ' + h);
      sw.style.background = 'hsl(' + h + ',60%,50%)';
      swatchesHost.appendChild(sw);
    });

    var nameInp = editor.querySelector('.myfb-tp-editor-name');
    nameInp.value = tag;
    var currentHue = _hue(tag);
    editor.querySelectorAll('.myfb-tp-swatch').forEach(function (sw) {
      if (parseInt(sw.getAttribute('data-hue'), 10) === currentHue) sw.classList.add('is-active');
      sw.addEventListener('click', function () {
        editor.querySelectorAll('.myfb-tp-swatch').forEach(function (s) { s.classList.remove('is-active'); });
        sw.classList.add('is-active');
      });
    });

    editor.querySelector('.myfb-tp-editor-cancel').addEventListener('click', function () {
      editor.remove();
    });
    editor.querySelector('.myfb-tp-editor-save').addEventListener('click', function () {
      var nameVal = nameInp.value;
      var picked  = editor.querySelector('.myfb-tp-swatch.is-active');
      var hueVal  = picked ? parseInt(picked.getAttribute('data-hue'), 10) : currentHue;
      // Apply rename + recolor
      var newName = _norm(nameVal);
      if (newName && newName !== tag) {
        _renameEverywhere(tag, newName);
        tag = newName;
      }
      _ensureColors()[tag] = hueVal;
      _persist();
      editor.remove();
      var body = _overlay && _overlay.querySelector('.myfb-tp-body');
      var search = _overlay && _overlay.querySelector('.myfb-tp-search');
      if (body) _render(body, search);
    });

    // Insert editor right below the chip
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(editor, anchor.nextSibling);
      nameInp.focus();
      nameInp.select();
    }
  }

  /* ── Public open/close ───────────────────────────────────────── */

  function open(segIdx, STATE) {
    if (_overlay) close();
    _segIdx = segIdx;
    _STATE  = STATE;

    /* Backdrop */
    _overlay = document.createElement('div');
    _overlay.className = 'myfb-tp-overlay';
    _overlay.setAttribute('role', 'dialog');
    _overlay.setAttribute('aria-modal', 'true');
    _overlay.setAttribute('aria-label', _t('tagpicker.aria', 'Gestionnaire de tags'));
    _overlay.addEventListener('click', function (e) { if (e.target === _overlay) close(); });

    /* Panel */
    var panel = document.createElement('div');
    panel.className = 'myfb-tp-panel';

    /* Header */
    var header = document.createElement('div');
    header.className = 'myfb-tp-header';
    header.innerHTML =
      '<svg class="myfb-tp-header-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>' +
      '<line x1="7" y1="7" x2="7.01" y2="7"/></svg>' +
      '<span class="myfb-tp-title">' + _t('tagpicker.title', 'Tags') + '</span>';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'myfb-tp-close';
    closeBtn.type      = 'button';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', _t('tagpicker.close', 'Fermer'));
    closeBtn.addEventListener('click', close);
    header.appendChild(closeBtn);

    /* Search */
    var searchWrap = document.createElement('div');
    searchWrap.className = 'myfb-tp-search-wrap';
    var searchSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="myfb-tp-search-icon">' +
      '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    searchWrap.innerHTML = searchSvg;
    var searchEl = document.createElement('input');
    searchEl.className   = 'myfb-tp-search';
    searchEl.type        = 'search';
    searchEl.placeholder = _t('tagpicker.placeholder', 'Rechercher ou créer un tag…');
    searchEl.setAttribute('autocomplete', 'off');
    searchEl.setAttribute('spellcheck', 'false');
    searchWrap.appendChild(searchEl);

    /* Body */
    var body = document.createElement('div');
    body.className = 'myfb-tp-body';

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
        // If a chip is focused, toggle it
        var focused = body.querySelector('.myfb-tp-chip:focus, .myfb-tp-create:focus');
        if (focused) { focused.click(); return; }
        var n = _norm(searchEl.value);
        if (n) { e.preventDefault(); _createAndAdd(n, body, searchEl); }
        return;
      }
      // Arrow keys navigate chips
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        var chips = Array.from(body.querySelectorAll('.myfb-tp-chip, .myfb-tp-create'));
        if (!chips.length) return;
        e.preventDefault();
        var focusedIdx = chips.indexOf(document.activeElement);
        var next = e.key === 'ArrowDown' || e.key === 'ArrowRight'
          ? (focusedIdx < 0 ? 0 : Math.min(chips.length - 1, focusedIdx + 1))
          : (focusedIdx < 0 ? chips.length - 1 : Math.max(0, focusedIdx - 1));
        chips[next].focus();
      }
    });

    _render(body, searchEl);
    setTimeout(function () { searchEl.focus(); }, 30);
  }

  function close() {
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;
  }

  window.MyFbTagPicker = { open: open, close: close };
})(window);
