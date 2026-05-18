/**
 * BIAIF Render — Conversation group
 *
 * Groups segments sharing a `conversationUrl` into a single card. Done
 * segments inside a group fold into a collapsible "N archivés" sub-section
 * that's expand/collapse-only (no inline edit) — protects archived
 * conversations from accidental modification.
 *
 * A "real" group requires either ≥2 segments on the same URL, or any
 * segment in `done` state. Single active segments stay as plain cards.
 */
(function (window) {
  'use strict';
  window.BIAIFRender = window.BIAIFRender || {};
  var DOM   = (window.BIAIF && window.BIAIF.dom)   || {};
  var UTILS = (window.BIAIF && window.BIAIF.utils) || {};
  var esc   = DOM.esc || function (s) { return String(s == null ? '' : s); };
  function _t(k, fb, vars) { return UTILS.t ? UTILS.t(k, fb, vars) : (fb || k); }

  // Collect every repoId referenced by a group of segments, looking at
  // both `dem.repoId` (segment-level) and `dem.refs[].repoId` (per-ref).
  // Preserves first-occurrence order so the layout is stable across
  // re-renders.
  function _collectRepoIds(items) {
    var seen = Object.create(null);
    var out  = [];
    items.forEach(function (it) {
      var dem = it.dem || {};
      var candidates = [dem.repoId];
      (dem.refs || []).forEach(function (r) { candidates.push(r && r.repoId); });
      candidates.forEach(function (rid) {
        if (!rid || seen[rid]) return;
        seen[rid] = true;
        out.push(rid);
      });
    });
    return out;
  }

  function _buildRepoBadges(items) {
    var ICONS = window.BIAIFRender.icons;
    var ctx   = window.BIAIFRender.ctx;
    var STATE = (ctx && ctx.STATE) || {};
    var ids   = _collectRepoIds(items);
    if (!ids.length) return '';
    var html = ids.map(function (rid) {
      var active = STATE.repoFilter === rid;
      return '<button class="seg-filter-badge seg-filter-badge--repo' +
        (active ? ' is-active' : '') +
        '" data-fk="repoFilter" data-fv="' + esc(rid) +
        '" title="' + esc(_t('seg.filter_repo_tip', 'Filtrer par repo : ' + rid, { repo: rid })) +
        '" type="button">' +
        ICONS.repo(9) + esc(rid) + '</button>';
    }).join('');
    return '<div class="biaif-conv-repos">' + html + '</div>';
  }

  // Group display items by conversationUrl (first occurrence preserves order).
  // Returns array of { conversationUrl, items, isGroup }.
  function build(display) {
    var urlGroups = Object.create(null);
    var result    = [];
    display.forEach(function (item) {
      var url = item.dem.conversationUrl || null;
      if (url) {
        if (!urlGroups[url]) {
          urlGroups[url] = { conversationUrl: url, items: [] };
          result.push(urlGroups[url]);
        }
        urlGroups[url].items.push(item);
      } else {
        result.push({ conversationUrl: null, items: [item], isGroup: false });
      }
    });
    result.forEach(function (g) {
      if (g.conversationUrl !== null) {
        var hasDone = g.items.some(function (i) { return i.dem.status === 'done'; });
        g.isGroup = g.items.length >= 2 || hasDone;
      }
    });
    return result;
  }

  function buildElement(group) {
    var Card  = window.BIAIFRender.segmentCard;
    var Arch  = window.BIAIFRender.archiveZone;
    var ICONS = window.BIAIFRender.icons;

    var wrap = document.createElement('div');
    wrap.className = 'biaif-conv-group';

    var convShort = group.conversationUrl;
    try { convShort = new URL(group.conversationUrl).hostname; } catch (_) {}

    var doneItems   = group.items.filter(function (i) { return i.dem.status === 'done'; });
    var activeItems = group.items.filter(function (i) { return i.dem.status !== 'done'; });
    var total       = group.items.length;

    var header = document.createElement('div');
    header.className = 'biaif-conv-header';
    header.innerHTML =
      ICONS.chat(10).replace('aria-hidden="true"', 'class="biaif-conv-icon" aria-hidden="true"') +
      '<a class="biaif-conv-url" href="' + esc(group.conversationUrl) + '" target="_blank" rel="noopener" title="' +
      esc(group.conversationUrl) + '">' + esc(convShort) + '</a>' +
      '<span class="biaif-conv-count">' + total + ' segment' + (total > 1 ? 's' : '') + '</span>' +
      _buildRepoBadges(group.items);
    wrap.appendChild(header);

    activeItems.forEach(function (item) { wrap.appendChild(Card.build(item.dem, item.origIndex)); });

    if (doneItems.length) {
      var subsegWrap = document.createElement('div');
      subsegWrap.className = 'biaif-conv-done-wrap';

      var ts        = Arch.latestTs(doneItems);
      var relT      = Arch.relTime(ts);
      var doneLabel = doneItems.length + ' archivé' + (doneItems.length > 1 ? 's' : '');
      var subsegToggle = document.createElement('button');
      subsegToggle.type      = 'button';
      subsegToggle.className = 'biaif-conv-done-toggle';
      subsegToggle.setAttribute('aria-expanded', 'false');
      subsegToggle.innerHTML =
        ICONS.chevronDn(10).replace('aria-hidden="true"', 'class="biaif-conv-done-chevron" aria-hidden="true"') +
        '<span class="biaif-conv-done-label">' + esc(doneLabel) + '</span>' +
        (relT ? '<span class="biaif-conv-done-ts">' + esc(_t('archive.updated', 'MAJ il y a ' + relT, { t: relT })) + '</span>' : '');

      var subsegBody = document.createElement('div');
      subsegBody.className = 'biaif-conv-done-body';
      doneItems.forEach(function (item) { subsegBody.appendChild(Card.build(item.dem, item.origIndex)); });

      subsegToggle.addEventListener('click', function () {
        var expanded = subsegWrap.classList.toggle('is-expanded');
        subsegToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      });

      subsegWrap.appendChild(subsegToggle);
      subsegWrap.appendChild(subsegBody);
      wrap.appendChild(subsegWrap);
    }
    return wrap;
  }

  window.BIAIFRender.convGroups = {
    build:        build,
    buildElement: buildElement,
  };
})(window);
