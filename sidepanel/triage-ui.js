/**
 * My-Feedbacks Triage UI Decorator (v1.12)
 *
 * Injects on each segment card :
 *   - Status chip       (new / accepted / rejected / shipped)
 *   - Priority dot      (low / medium / high / critical)
 *   - Tags pills + "+" to add
 *   - "💬 N" button → expandable comments thread
 *
 * Reads from MyFb.runtime.state.demandes[id] (if available) or falls
 * back to the legacy STATE.demandes shape so the decorator stays
 * resilient. Writes through MyFbTriage (PR #120).
 *
 * Re-renders the affected card after every mutation by re-reading
 * runtime.state.
 */

(function (window) {
  'use strict';

  var t = function (k, fb) {
    return (window.MyFb && window.MyFb.utils && window.MyFb.utils.t)
      ? window.MyFb.utils.t(k, fb) : (fb || k);
  };

  var STATUS_LABELS = {
    'new':      { label: 'Nouveau',  i18n: 'triage.status.new',      cls: 'new' },
    'accepted': { label: 'Accepté',  i18n: 'triage.status.accepted', cls: 'accepted' },
    'rejected': { label: 'Rejeté',   i18n: 'triage.status.rejected', cls: 'rejected' },
    'shipped':  { label: 'Livré',    i18n: 'triage.status.shipped',  cls: 'shipped' },
  };
  var PRIO_LABELS = {
    'low':      { label: 'Faible',   i18n: 'triage.priority.low',      cls: 'low'      },
    'medium':   { label: 'Moyenne',  i18n: 'triage.priority.medium',   cls: 'medium'   },
    'high':     { label: 'Haute',    i18n: 'triage.priority.high',     cls: 'high'     },
    'critical': { label: 'Critique', i18n: 'triage.priority.critical', cls: 'critical' },
  };

  function init() {
    var wrap = document.querySelector('#segments') || document.body;
    if (!wrap) return;
    _decorateAll(wrap);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) { if (n && n.nodeType === 1) _decorateAll(n); });
      });
    }).observe(wrap, { childList: true, subtree: true });
    document.addEventListener('click', _onDocClick, true);
  }

  function _decorateAll(root) {
    var cards = (root.querySelectorAll && root.querySelectorAll('.myfb-segment')) || [];
    cards.forEach(_decorateCard);
    if (root.classList && root.classList.contains('myfb-segment')) _decorateCard(root);
  }

  function _decorateCard(card) {
    if (!card || card.__myfbTriageDecorated) return;
    card.__myfbTriageDecorated = true;
    var id = card.getAttribute('data-id') || card.dataset.id;
    if (!id) return;
    var holder = document.createElement('div');
    holder.className = 'myfb-triage-row';
    holder.setAttribute('data-myfb-triage', id);
    // Best position : before the .demande-text or as last child if not found.
    var anchor = card.querySelector('.demande-text') || null;
    if (anchor) card.insertBefore(holder, anchor);
    else        card.appendChild(holder);
    _renderRow(id);
  }

  function _renderRow(id) {
    var holder = document.querySelector('[data-myfb-triage="' + _escAttr(id) + '"]');
    if (!holder) return;
    var T = window.MyFbTriage;
    if (!T) { holder.textContent = ''; return; }
    var status   = T.getStatus(id)   || 'new';
    var priority = T.getPriority(id) || 'medium';
    var comments = T.listComments(id);
    var sLab = STATUS_LABELS[status];
    var pLab = PRIO_LABELS[priority];

    // v2.6 — status/priority are now dropdowns (click → popover with the
    // 4 options). Tags moved out of this row since they're already shown
    // in the .seg-meta-tags row above with a proper color-coded picker.
    holder.innerHTML =
      '<button type="button" class="myfb-triage-status myfb-triage-status-' + sLab.cls +
        '" data-myfb-act="status-open" data-id="' + _escAttr(id) +
        '" title="' + t('triage.click_to_pick', 'Choisir un statut') + '" aria-haspopup="true">' +
        '<span class="myfb-triage-dot"></span>' +
        '<span>' + _esc(t(sLab.i18n, sLab.label)) + '</span>' +
        '<span class="myfb-triage-caret" aria-hidden="true">▾</span>' +
      '</button>' +
      '<button type="button" class="myfb-triage-priority myfb-triage-priority-' + pLab.cls +
        '" data-myfb-act="priority-open" data-id="' + _escAttr(id) +
        '" title="' + t('triage.click_to_pick_prio', 'Choisir une priorité') + '" aria-haspopup="true">' +
        '⬤<span class="myfb-triage-priority-label">' + _esc(t(pLab.i18n, pLab.label)) + '</span>' +
        '<span class="myfb-triage-caret" aria-hidden="true">▾</span>' +
      '</button>' +
      '<button type="button" class="myfb-triage-comments" data-myfb-act="comments-toggle" data-id="' + _escAttr(id) + '" title="' + t('triage.comments', 'Commentaires') + '">' +
        '💬 ' + comments.length +
      '</button>' +
      '<div class="myfb-triage-comments-thread" data-myfb-thread="' + _escAttr(id) + '" hidden></div>';
  }

  // ── Dropdown popover (status / priority) ─────────────────────────────
  //
  // The popover is portalled into document.body — not nested inside the
  // anchor button — to escape three failure modes :
  //   1. Segment cards have overflow:hidden for their rounded corners,
  //      which would clip an absolutely-positioned child popover.
  //   2. Lower segment cards can create their own stacking context
  //      (border-radius + transform etc.), making a z-index:100 on a
  //      higher card's popover useless against them.
  //   3. Long lists of segments push the anchor off-screen on scroll ;
  //      portalling lets us recompute position cheaply.
  //
  // Position is calculated from the anchor's getBoundingClientRect() and
  // page scroll offsets. We close on scroll / resize / click-outside /
  // Escape to avoid the popover drifting away from its anchor.
  var _openPickerEl = null;
  var _openAnchor   = null;

  function _openPicker(anchor, kind, id) {
    _closePicker();
    var T = window.MyFbTriage;
    if (!T) return;
    var values = kind === 'status' ? T.STATUSES : T.PRIORITIES;
    var labels = kind === 'status' ? STATUS_LABELS : PRIO_LABELS;
    var current = kind === 'status' ? (T.getStatus(id) || 'new') : (T.getPriority(id) || 'medium');
    var pop = document.createElement('div');
    pop.className = 'myfb-triage-picker myfb-triage-picker--' + kind;
    pop.setAttribute('role', 'menu');
    pop.dataset.anchorId = id;
    pop.dataset.kind     = kind;
    pop.innerHTML = values.map(function (v) {
      var lab = labels[v];
      return '<button type="button" class="myfb-triage-picker-item myfb-triage-' + kind + '-' + lab.cls +
        (v === current ? ' is-current' : '') +
        '" data-myfb-act="' + kind + '-pick" data-id="' + _escAttr(id) + '" data-value="' + _escAttr(v) + '" role="menuitem">' +
        (kind === 'status' ? '<span class="myfb-triage-dot"></span>' : '<span class="myfb-triage-prio-dot">⬤</span>') +
        '<span>' + _esc(t(lab.i18n, lab.label)) + '</span>' +
        (v === current ? '<span class="myfb-triage-check" aria-hidden="true">✓</span>' : '') +
      '</button>';
    }).join('');
    document.body.appendChild(pop);
    _openPickerEl = pop;
    _openAnchor   = anchor;
    _positionPicker();
    document.addEventListener('keydown',  _onPickerKey);
    document.addEventListener('scroll',   _closePicker, true);
    window.addEventListener('resize',     _closePicker);
  }

  function _positionPicker() {
    if (!_openPickerEl || !_openAnchor) return;
    var r = _openAnchor.getBoundingClientRect();
    var top  = r.bottom + window.scrollY + 4;
    var left = r.left   + window.scrollX;
    // Keep it inside the viewport horizontally — flip-right if it would
    // overflow the window.
    var maxLeft = window.innerWidth - 180 + window.scrollX;
    if (left > maxLeft) left = Math.max(window.scrollX + 4, maxLeft);
    _openPickerEl.style.top  = top  + 'px';
    _openPickerEl.style.left = left + 'px';
  }

  function _closePicker() {
    if (_openPickerEl && _openPickerEl.parentNode) _openPickerEl.parentNode.removeChild(_openPickerEl);
    _openPickerEl = null;
    _openAnchor   = null;
    document.removeEventListener('keydown', _onPickerKey);
    document.removeEventListener('scroll',  _closePicker, true);
    window.removeEventListener('resize',    _closePicker);
  }
  function _onPickerKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); _closePicker(); }
  }

  function _renderThread(id) {
    var thread = document.querySelector('[data-myfb-thread="' + _escAttr(id) + '"]');
    if (!thread) return;
    var T = window.MyFbTriage;
    var comments = (T && T.listComments(id)) || [];
    thread.innerHTML =
      '<div class="myfb-triage-thread-list">' +
        (comments.length === 0
          ? '<p class="myfb-triage-thread-empty">' + t('triage.no_comments', 'Aucun commentaire.') + '</p>'
          : comments.map(function (c) {
              return '<div class="myfb-triage-comment">' +
                '<div class="myfb-triage-comment-meta">' +
                  '<span class="myfb-triage-comment-author">' + _esc(c.authorUuid.slice(0, 8)) + '</span>' +
                  '<span class="myfb-triage-comment-ts">' + _fmtDate(c.ts) + '</span>' +
                  (c.edited ? '<span class="myfb-triage-comment-edited">' + t('triage.edited', '(modifié)') + '</span>' : '') +
                  '<button type="button" class="myfb-triage-comment-del" data-myfb-act="comment-delete" data-id="' + _escAttr(id) + '" data-cid="' + _escAttr(c.id) + '" aria-label="' + t('triage.delete', 'Supprimer') + '">×</button>' +
                '</div>' +
                '<div class="myfb-triage-comment-text">' + _esc(c.text) + '</div>' +
              '</div>';
            }).join('')) +
      '</div>' +
      '<form class="myfb-triage-thread-form" data-myfb-act="comment-form" data-id="' + _escAttr(id) + '">' +
        '<input type="text" class="myfb-triage-thread-input" placeholder="' + t('triage.comment_placeholder', 'Ajouter un commentaire…') + '" maxlength="2000" />' +
        '<button type="submit" class="myfb-triage-thread-send">' + t('triage.send', 'Envoyer') + '</button>' +
      '</form>';
  }

  // ── Click router ────────────────────────────────────────────────────

  function _onDocClick(e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-myfb-act]');
    if (!btn) {
      // Click hors d'un bouton triage : ferme le popover ouvert si on a
      // cliqué en dehors de lui.
      if (e.target && e.target.closest && !e.target.closest('.myfb-triage-picker')) _closePicker();
      return;
    }
    var act = btn.getAttribute('data-myfb-act');
    var id  = btn.getAttribute('data-id');
    var T   = window.MyFbTriage;
    if (!T || !id) return;

    if (act === 'status-open') {
      e.stopPropagation();
      // Toggle if the picker is already open for this anchor.
      if (_openAnchor === btn) { _closePicker(); return; }
      _openPicker(btn, 'status', id);
    } else if (act === 'priority-open') {
      e.stopPropagation();
      if (_openAnchor === btn) { _closePicker(); return; }
      _openPicker(btn, 'priority', id);
    } else if (act === 'status-pick') {
      e.stopPropagation();
      var sVal = btn.getAttribute('data-value');
      T.setStatus(id, sVal).then(function () { _renderRow(id); _closePicker(); }).catch(function () { _closePicker(); });
    } else if (act === 'priority-pick') {
      e.stopPropagation();
      var pVal = btn.getAttribute('data-value');
      T.setPriority(id, pVal).then(function () { _renderRow(id); _closePicker(); }).catch(function () { _closePicker(); });
    } else if (act === 'comments-toggle') {
      e.stopPropagation();
      var thr = document.querySelector('[data-myfb-thread="' + _escAttr(id) + '"]');
      if (!thr) return;
      var willShow = thr.hasAttribute('hidden');
      if (willShow) { thr.removeAttribute('hidden'); _renderThread(id); }
      else          thr.setAttribute('hidden', '');
    } else if (act === 'comment-delete') {
      e.stopPropagation();
      var cid = btn.getAttribute('data-cid');
      if (confirm(t('triage.delete_confirm', 'Supprimer ce commentaire ?'))) {
        T.deleteComment(id, cid).then(function () { _renderThread(id); _renderRow(id); }).catch(function () {});
      }
    }
  }

  // Listen to form submit separately because click router doesn't see submit
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || !f.matches || !f.matches('[data-myfb-act="comment-form"]')) return;
    e.preventDefault();
    var id  = f.getAttribute('data-id');
    var inp = f.querySelector('.myfb-triage-thread-input');
    var txt = inp && inp.value.trim();
    var T   = window.MyFbTriage;
    if (!T || !id || !txt) return;
    T.addComment(id, txt).then(function () {
      inp.value = '';
      _renderThread(id);
      _renderRow(id);
    }).catch(function () {});
  }, true);

  // ── helpers ─────────────────────────────────────────────────────────

  function _cycle(arr, current, set) {
    var i = Math.max(0, arr.indexOf(current));
    var next = arr[(i + 1) % arr.length];
    set(next);
  }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function _escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _fmtDate(ts) {
    if (!ts) return '';
    try {
      var d = new Date(ts);
      return d.toLocaleString();
    } catch (_) { return ''; }
  }

  window.MyFbTriageUi = {
    init:          init,
    _renderRow:    _renderRow,
    _renderThread: _renderThread,
    STATUS_LABELS: STATUS_LABELS,
    PRIO_LABELS:   PRIO_LABELS,
  };
})(window);
