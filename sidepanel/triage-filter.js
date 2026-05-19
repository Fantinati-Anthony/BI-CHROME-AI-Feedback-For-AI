/**
 * My-Feedbacks Triage Filter Bar (v1.13)
 *
 * A horizontal pill bar above the segments list that lets the user
 * filter the displayed cards by triage status (and shows a count per
 * status from MyFbTriage.statusCounts()).
 *
 * State :
 *   - Active filter persisted in chrome.storage.local
 *     `myfb:triage:filter` — one of: 'all' | 'new' | 'accepted' |
 *     'rejected' | 'shipped'
 *   - When non-'all', adds `data-myfb-triage-filter` to #segments and
 *     CSS hides cards whose data-status doesn't match.
 *   - Each card gets a `data-status` attribute (re-synced via small
 *     MutationObserver tick whenever triage-ui re-renders).
 *
 * Counts are recomputed on every render() and visible inside each pill.
 */

(function (window) {
  'use strict';

  var t = function (k, fb) {
    return (window.MyFb && window.MyFb.utils && window.MyFb.utils.t)
      ? window.MyFb.utils.t(k, fb) : (fb || k);
  };

  var STORAGE_KEY = 'myfb:triage:filter';
  var STATUSES = ['new', 'accepted', 'rejected', 'shipped'];
  var _activeFilter = 'all';
  var _bar = null;
  var _segmentsHost = null;

  function init() {
    // Try to load persisted filter
    try {
      chrome.storage.local.get([STORAGE_KEY], function (out) {
        _activeFilter = (out && out[STORAGE_KEY]) || 'all';
        _mount();
        _apply();
      });
    } catch (_) { _mount(); _apply(); }
  }

  function _mount() {
    _segmentsHost = document.querySelector('#segments-host') || document.querySelector('#segments');
    if (!_segmentsHost) return;
    if (document.querySelector('[data-myfb-triage-filterbar]')) return;
    _bar = document.createElement('div');
    _bar.className = 'myfb-triage-filterbar';
    _bar.setAttribute('data-myfb-triage-filterbar', '');
    _bar.setAttribute('role', 'tablist');
    _bar.setAttribute('aria-label', t('filter.aria', 'Filtre par statut'));
    _segmentsHost.parentNode.insertBefore(_bar, _segmentsHost);
    _render();
    _bar.addEventListener('click', function (e) {
      var pill = e.target.closest('[data-status]');
      if (!pill) return;
      var s = pill.getAttribute('data-status');
      _setFilter(s);
    });

    // Update counts when triage events happen — quick MutationObserver
    // on segments host to detect re-renders.
    new MutationObserver(_render).observe(_segmentsHost, { childList: true, subtree: true });
  }

  function _render() {
    if (!_bar) return;
    var counts = (window.MyFbTriage && window.MyFbTriage.statusCounts && window.MyFbTriage.statusCounts()) ||
                 { new: 0, accepted: 0, rejected: 0, shipped: 0 };
    var total = counts.new + counts.accepted + counts.rejected + counts.shipped;
    var statusLabels = {
      'new':      t('triage.status.new',      'Nouveau'),
      'accepted': t('triage.status.accepted', 'Accepté'),
      'rejected': t('triage.status.rejected', 'Rejeté'),
      'shipped':  t('triage.status.shipped',  'Livré'),
    };
    var pills = [{ id: 'all', label: t('filter.all', 'Tous'), count: total, cls: 'all' }].concat(
      STATUSES.map(function (s) {
        return { id: s, label: statusLabels[s], count: counts[s] || 0, cls: s };
      })
    );
    _bar.innerHTML = pills.map(function (p) {
      var active = (p.id === _activeFilter) ? ' is-active' : '';
      return '<button type="button" class="myfb-filter-pill myfb-filter-pill-' + p.cls + active +
             '" data-status="' + p.id + '" role="tab" aria-selected="' + (p.id === _activeFilter) + '">' +
        '<span class="myfb-filter-pill-label">' + _esc(p.label) + '</span>' +
        '<span class="myfb-filter-pill-count">' + p.count + '</span>' +
      '</button>';
    }).join('');
  }

  function _setFilter(status) {
    if (status === _activeFilter) {
      // Click on already-active filter resets to "all"
      _activeFilter = 'all';
    } else {
      _activeFilter = status;
    }
    try {
      var toSet = {}; toSet[STORAGE_KEY] = _activeFilter;
      chrome.storage.local.set(toSet);
    } catch (_) {}
    _render();
    _apply();
  }

  function _apply() {
    var host = document.querySelector('#segments') || _segmentsHost;
    if (!host) return;
    // Mark each card with its data-status (from MyFbTriage)
    var cards = host.querySelectorAll('.myfb-segment');
    cards.forEach(function (card) {
      var id = card.getAttribute('data-id') || card.dataset.id;
      if (!id) return;
      var s = (window.MyFbTriage && window.MyFbTriage.getStatus(id)) || 'new';
      card.setAttribute('data-status', s);
    });
    host.setAttribute('data-myfb-triage-filter', _activeFilter);
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.MyFbTriageFilter = {
    init:       init,
    _render:    _render,
    _setFilter: _setFilter,
    _apply:     _apply,
    get filter() { return _activeFilter; },
  };
})(window);
