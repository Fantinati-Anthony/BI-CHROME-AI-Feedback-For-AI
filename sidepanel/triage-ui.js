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
    var tags     = T.getTags(id)     || [];
    var comments = T.listComments(id);
    var sLab = STATUS_LABELS[status];
    var pLab = PRIO_LABELS[priority];

    holder.innerHTML =
      '<button type="button" class="myfb-triage-status myfb-triage-status-' + sLab.cls + '" data-myfb-act="status-cycle" data-id="' + _escAttr(id) + '" title="' + t('triage.click_to_cycle', 'Cliquer pour changer') + '">' +
        '<span class="myfb-triage-dot"></span>' +
        '<span>' + _esc(t(sLab.i18n, sLab.label)) + '</span>' +
      '</button>' +
      '<button type="button" class="myfb-triage-priority myfb-triage-priority-' + pLab.cls + '" data-myfb-act="priority-cycle" data-id="' + _escAttr(id) + '" title="' + t(pLab.i18n, pLab.label) + '">' +
        '⬤' +
      '</button>' +
      '<div class="myfb-triage-tags">' +
        tags.map(function (tg) {
          return '<span class="myfb-triage-tag">#' + _esc(tg) +
                 '<button type="button" class="myfb-triage-tag-x" data-myfb-act="tag-remove" data-id="' + _escAttr(id) + '" data-tag="' + _escAttr(tg) + '" aria-label="' + t('triage.remove_tag', 'Retirer') + '">×</button>' +
                 '</span>';
        }).join('') +
        '<button type="button" class="myfb-triage-add-tag" data-myfb-act="tag-add" data-id="' + _escAttr(id) + '" title="' + t('triage.add_tag', 'Ajouter un tag') + '">+</button>' +
      '</div>' +
      '<button type="button" class="myfb-triage-comments" data-myfb-act="comments-toggle" data-id="' + _escAttr(id) + '" title="' + t('triage.comments', 'Commentaires') + '">' +
        '💬 ' + comments.length +
      '</button>' +
      '<div class="myfb-triage-comments-thread" data-myfb-thread="' + _escAttr(id) + '" hidden></div>';
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
    if (!btn) return;
    var act = btn.getAttribute('data-myfb-act');
    var id  = btn.getAttribute('data-id');
    var T   = window.MyFbTriage;
    if (!T || !id) return;

    if (act === 'status-cycle') {
      e.stopPropagation();
      _cycle(T.STATUSES, T.getStatus(id) || 'new', function (next) {
        T.setStatus(id, next).then(function () { _renderRow(id); }).catch(function () {});
      });
    } else if (act === 'priority-cycle') {
      e.stopPropagation();
      _cycle(T.PRIORITIES, T.getPriority(id) || 'medium', function (next) {
        T.setPriority(id, next).then(function () { _renderRow(id); }).catch(function () {});
      });
    } else if (act === 'tag-add') {
      e.stopPropagation();
      var tg = prompt(t('triage.tag_prompt', 'Nouveau tag :'));
      if (!tg) return;
      T.addTag(id, tg).then(function () { _renderRow(id); }).catch(function () {});
    } else if (act === 'tag-remove') {
      e.stopPropagation();
      var rm = btn.getAttribute('data-tag');
      T.removeTag(id, rm).then(function () { _renderRow(id); }).catch(function () {});
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
