/**
 * BIAIF Render — Archive zone
 *
 * Collapsible "X archivée(s) — MAJ il y a Yt" zone shown at the bottom of
 * the segments list for done segments that don't belong to a conversation
 * group. Carries a single shared interval timer that refreshes the
 * relative timestamp every BIAIF.config.ui.ARCHIVE_REFRESH_MS.
 */
(function (window) {
  'use strict';
  window.BIAIFRender = window.BIAIFRender || {};
  var ctx   = window.BIAIFRender.ctx;
  var CFG   = (window.BIAIF && window.BIAIF.config && window.BIAIF.config.ui) || {};
  var UTILS = (window.BIAIF && window.BIAIF.utils) || {};
  function _t(k, fb, vars) { return UTILS.t ? UTILS.t(k, fb, vars) : (fb || k); }

  function relTime(ts) {
    if (!ts) return '';
    var sec = Math.round((Date.now() - ts) / 1000);
    if (sec < 60) return _t('archive.sec', sec + ' s', { n: sec });
    var min = Math.round(sec / 60);
    return _t('archive.min', min + ' min', { n: min });
  }

  function latestTs(items) {
    var latest = 0;
    items.forEach(function (item) {
      var t = item.dem.responseReceivedAt || item.dem.submittedAt || item.dem.ts || 0;
      if (t > latest) latest = t;
    });
    return latest;
  }

  function build(archived) {
    var STATE = ctx.STATE;
    var Card  = window.BIAIFRender.segmentCard;
    var zone = document.createElement('div');
    zone.className = 'biaif-archive-zone' + (STATE.archiveExpanded ? ' is-expanded' : '');

    var ts   = latestTs(archived);
    var relT = relTime(ts);
    var updLabel = relT ? _t('archive.updated', 'MAJ il y a ' + relT, { t: relT }) : '';

    var ICONS = window.BIAIFRender.icons;
    var header = document.createElement('button');
    header.type = 'button';
    header.className = 'biaif-archive-header';
    header.setAttribute('aria-expanded', STATE.archiveExpanded ? 'true' : 'false');
    header.innerHTML =
      ICONS.chevronDn(12).replace('width="12" height="12"', 'class="biaif-archive-chevron" width="12" height="12"') +
      '<span class="biaif-archive-label">' + _t('archive.toggle', '{n} archivée(s)', { n: archived.length }) + '</span>' +
      (updLabel ? '<span class="biaif-archive-updated">' + updLabel + '</span>' : '');

    header.addEventListener('click', function () {
      STATE.archiveExpanded = !STATE.archiveExpanded;
      zone.classList.toggle('is-expanded', STATE.archiveExpanded);
      header.setAttribute('aria-expanded', STATE.archiveExpanded ? 'true' : 'false');
      if (window.BIAIFStorage) window.BIAIFStorage.persist(STATE);
    });

    var body = document.createElement('div');
    body.className = 'biaif-archive-body';

    archived.forEach(function (item) { body.appendChild(Card.build(item.dem, item.origIndex)); });

    zone.appendChild(header);
    zone.appendChild(body);

    // Refresh relative timestamps every ARCHIVE_REFRESH_MS — single shared
    // interval, started lazily and never torn down (cheap loop, tied to the
    // sidepanel lifetime).
    if (!ctx.archiveTimer) {
      ctx.archiveTimer = setInterval(function () {
        document.querySelectorAll('.biaif-archive-updated').forEach(function (el) {
          var zone2 = el.closest('.biaif-archive-zone');
          if (!zone2) return;
          var cards = zone2.querySelectorAll('.biaif-segment');
          var latest = 0;
          cards.forEach(function (card) {
            var idx = Number(card.dataset.i);
            var dem = STATE.demandes[idx];
            if (!dem) return;
            var t = dem.responseReceivedAt || dem.submittedAt || dem.ts || 0;
            if (t > latest) latest = t;
          });
          if (!latest) return;
          var rel = relTime(latest);
          if (rel) el.textContent = _t('archive.updated', 'MAJ il y a ' + rel, { t: rel });
        });
      }, CFG.ARCHIVE_REFRESH_MS || 30000);
    }

    return zone;
  }

  window.BIAIFRender.archiveZone = {
    build:    build,
    relTime:  relTime,
    latestTs: latestTs,
  };
})(window);
