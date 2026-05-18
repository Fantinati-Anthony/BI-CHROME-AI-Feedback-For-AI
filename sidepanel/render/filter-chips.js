/**
 * MyFb Render — Filter chips
 *
 * Builds (and removes) the "active filters" chips bar shown above the
 * segments list. Each chip represents a STATE filter slot
 * (conversation / repo / domain / page) that, when set, narrows the
 * visible segments. Click on a chip's ✕ clears that filter.
 */
(function (window) {
  'use strict';
  window.MyFbRender = window.MyFbRender || {};
  var ctx   = window.MyFbRender.ctx;
  var DOM   = (window.MyFb && window.MyFb.dom)   || {};
  var esc   = DOM.esc || function (s) { return String(s == null ? '' : s); };

  var FILTER_DEFS = [
    { key: 'conversationFilter', icon: '⊛', label: 'Conv' },
    { key: 'repoFilter',         icon: '⎇', label: 'Repo' },
    { key: 'domainFilter',       icon: '⊙', label: 'Domaine' },
    { key: 'pageFilter',         icon: '⤢', label: 'Page' },
    { key: 'tagFilter',          icon: '#', label: 'Tag' },
  ];

  function build(parentNode) {
    // Remove previous filter chips bar
    var prev = document.getElementById('filter-chips-bar');
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);

    var STATE = ctx.STATE;
    var active = FILTER_DEFS.filter(function (d) { return !!(STATE[d.key] || '').trim(); });
    if (!active.length || !parentNode) return null;

    var bar = document.createElement('div');
    bar.id = 'filter-chips-bar';
    bar.className = 'filter-chips-bar';
    active.forEach(function (d) {
      var val = STATE[d.key] || '';
      var short = val;
      try { short = new URL(val).hostname + new URL(val).pathname; } catch (_) {}
      if (short.length > 35) short = short.slice(0, 33) + '…';
      var chip = document.createElement('button');
      chip.className = 'filter-chip';
      chip.dataset.fk = d.key;
      chip.type = 'button';
      chip.title = val;
      chip.innerHTML = '<span class="filter-chip-icon">' + d.icon + '</span>' +
        '<span class="filter-chip-label">' + esc(d.label) + ': ' + esc(short) + '</span>' +
        '<span class="filter-chip-x" aria-hidden="true">✕</span>';
      bar.appendChild(chip);
    });
    parentNode.parentNode.insertBefore(bar, parentNode);
    return bar;
  }

  window.MyFbRender.filterChips = {
    build: build,
    DEFS:  FILTER_DEFS,
  };
})(window);
