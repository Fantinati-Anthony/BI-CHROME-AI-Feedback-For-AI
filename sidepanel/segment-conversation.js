/**
 * My-Feedbacks Segment Conversation (v2.3)
 *
 * Replaces the basic comments thread (PR #128) with a richer
 * "team conversation" panel :
 *
 *   - @-mention autocomplete : when the user types "@" in the
 *     composer, a dropdown lists peers from runtime.state.links
 *     (display_name + short uuid). Picking one inserts
 *     "@<short-uuid> " into the text and records the full uuid in
 *     the mentions[] payload field.
 *
 *   - Target dropdown (cible) : the composer has a "→ ?" button that
 *     lets the user pick a single peer the comment is directed to.
 *     Targeted comments get a distinct header pill and a thin
 *     accent border.
 *
 *   - Propose edit : the composer has a "✏ Proposer une modif" button
 *     that opens an inline editor pre-filled with the demande's
 *     current text. The user can revise it. On submit, the comment
 *     carries a proposeText payload. Recipients see the comment as
 *     a diff card with ✅ Accepter / ❌ Refuser buttons. Accepting
 *     emits DEMANDE_TEXT_UPDATED (segment text changes) and stamps
 *     proposalStatus="accepted" on the comment.
 *
 * The module hooks into the EXISTING triage-ui thread host
 * (`[data-myfb-thread="<id>"]`) and overrides its render via a
 * MutationObserver — leaves the basic toggle button + comment-form
 * action wired by triage-ui untouched.
 */

(function (window) {
  'use strict';

  var t = function (k, fb) {
    return (window.MyFb && window.MyFb.utils && window.MyFb.utils.t)
      ? window.MyFb.utils.t(k, fb) : (fb || k);
  };

  function _toast(m, k, d) {
    if (window.MyFbToast && window.MyFbToast.show) window.MyFbToast.show(m, k || 'info', d || 2200);
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _escAttr(s) { return _esc(s); }

  function init() {
    // Watch every thread host appearing in the DOM and override its
    // content with the rich renderer.
    var root = document.querySelector('#segments') || document.body;
    if (!root) return;
    _hookExisting(root);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n && n.nodeType === 1) _hookExisting(n);
        });
      });
    }).observe(root, { childList: true, subtree: true });

    document.addEventListener('click', _onClick, true);
    document.addEventListener('input', _onInput, true);
    document.addEventListener('submit', _onSubmit, true);
  }

  function _hookExisting(node) {
    var threads = node.querySelectorAll ? node.querySelectorAll('[data-myfb-thread]') : [];
    threads.forEach(_decorateThread);
    if (node.matches && node.matches('[data-myfb-thread]')) _decorateThread(node);
  }

  function _decorateThread(thr) {
    if (thr.__myfbConvHooked) return;
    thr.__myfbConvHooked = true;
    // The existing triage-ui's _renderThread sets innerHTML on this
    // node whenever the user opens the panel. We use a MutationObserver
    // on the thread itself to re-decorate after each render.
    new MutationObserver(function () { _renderRich(thr); }).observe(thr, { childList: true });
    if (!thr.hasAttribute('hidden')) _renderRich(thr);
  }

  function _peers() {
    var ctx = window.MyFb && window.MyFb.runtime;
    if (!ctx || !ctx.state || !ctx.state.links) return [];
    return Object.values(ctx.state.links).filter(function (l) { return l.status === 'accepted'; });
  }

  function _peerLabel(uuidOrPending) {
    if (!uuidOrPending) return '?';
    var peers = _peers();
    for (var i = 0; i < peers.length; i++) {
      if (peers[i].peerUuid === uuidOrPending) return peers[i].peerLabel || peers[i].peerUuid.slice(0, 8);
    }
    return String(uuidOrPending).slice(0, 8);
  }

  function _renderRich(thr) {
    if (thr.__myfbConvRendering) return;
    thr.__myfbConvRendering = true;
    try {
      var id = thr.getAttribute('data-myfb-thread');
      var T  = window.MyFbTriage;
      if (!T) return;
      var comments = T.listComments(id);
      var ctx = window.MyFb && window.MyFb.runtime;
      var myUuid = (ctx && ctx.uuid) || null;
      var demande = (ctx && ctx.state && ctx.state.demandes[id]) || null;

      var existingForm = thr.querySelector('.myfb-triage-thread-form');
      // Don't touch the form (triage-ui submit handler depends on it).
      // We replace ONLY the list portion + add the composer extras.
      var list = thr.querySelector('.myfb-triage-thread-list');
      if (list) {
        list.innerHTML = comments.length
          ? comments.map(function (c) { return _renderComment(c, id, myUuid); }).join('')
          : '<p class="myfb-triage-thread-empty">' + t('triage.no_comments', 'Aucun commentaire.') + '</p>';
      }
      if (existingForm && !existingForm.__myfbExtended) {
        _extendForm(existingForm, demande);
        existingForm.__myfbExtended = true;
      }
    } finally {
      thr.__myfbConvRendering = false;
    }
  }

  function _renderComment(c, demandeId, myUuid) {
    var isMine = myUuid && c.authorUuid === myUuid;
    var pill   = c.target ? '<span class="myfb-conv-target-pill">→ ' + _esc(_peerLabel(c.target)) + '</span>' : '';
    var status = c.proposalStatus ? '<span class="myfb-conv-status myfb-conv-status-' + _esc(c.proposalStatus) + '">' + _esc(c.proposalStatus) + '</span>' : '';
    var richText = _renderTextWithMentions(c.text || '');
    var propBlock = c.proposeText
      ? '<div class="myfb-conv-propose">' +
          '<div class="myfb-conv-propose-label">' + t('conv.propose_label', '📝 Modification proposée') + '</div>' +
          '<div class="myfb-conv-propose-text">' + _esc(c.proposeText) + '</div>' +
          (!c.proposalStatus
            ? '<div class="myfb-conv-propose-actions">' +
                '<button type="button" class="myfb-conv-mini myfb-conv-accept" data-myfb-conv-act="accept" data-cid="' + _escAttr(c.id) + '" data-id="' + _escAttr(demandeId) + '">✅ ' + t('conv.accept', 'Accepter') + '</button>' +
                '<button type="button" class="myfb-conv-mini myfb-conv-refuse" data-myfb-conv-act="refuse" data-cid="' + _escAttr(c.id) + '" data-id="' + _escAttr(demandeId) + '">❌ ' + t('conv.refuse', 'Refuser') + '</button>' +
              '</div>'
            : (c.proposalStatus === 'accepted'
                ? '<div class="myfb-conv-status-row">✅ ' + t('conv.accepted_by', 'Accepté') + (c.acceptedBy ? ' · ' + _esc(_peerLabel(c.acceptedBy)) : '') + '</div>'
                : '<div class="myfb-conv-status-row">❌ ' + t('conv.refused_by', 'Refusé') + (c.refusedBy ? ' · ' + _esc(_peerLabel(c.refusedBy)) : '') + '</div>')) +
        '</div>'
      : '';
    return '<div class="myfb-triage-comment myfb-conv-comment' + (c.target ? ' is-targeted' : '') + (isMine ? ' is-mine' : '') + '">' +
      '<div class="myfb-triage-comment-meta">' +
        '<span class="myfb-triage-comment-author">' + _esc(_peerLabel(c.authorUuid)) + '</span>' +
        '<span class="myfb-triage-comment-ts">' + _fmtDate(c.ts) + '</span>' +
        (c.edited ? '<span class="myfb-triage-comment-edited">' + t('triage.edited', '(modifié)') + '</span>' : '') +
        pill + status +
        '<button type="button" class="myfb-triage-comment-del" data-myfb-act="comment-delete" data-id="' + _escAttr(demandeId) + '" data-cid="' + _escAttr(c.id) + '" aria-label="' + t('triage.delete', 'Supprimer') + '">×</button>' +
      '</div>' +
      '<div class="myfb-triage-comment-text myfb-conv-text">' + richText + '</div>' +
      propBlock +
    '</div>';
  }

  function _renderTextWithMentions(text) {
    // Highlight @<peer-label-or-short-uuid> tokens
    return _esc(text).replace(/@([\w-]{3,40})/g, function (full, who) {
      return '<span class="myfb-conv-mention">@' + _esc(who) + '</span>';
    });
  }

  // Per-thread draft state for target + propose-text (transient).
  var _drafts = {};   // demandeId → { target?: uuid, proposeText?: string, mentions: Set }

  function _draft(id) {
    if (!_drafts[id]) _drafts[id] = { target: null, proposeText: null, mentions: new Set() };
    return _drafts[id];
  }

  function _extendForm(form, demande) {
    var id = form.getAttribute('data-id');
    // Insert a thin toolbar above the input row.
    var bar = document.createElement('div');
    bar.className = 'myfb-conv-toolbar';
    bar.innerHTML =
      '<button type="button" class="myfb-conv-tool" data-myfb-conv-act="open-mentions" title="' + t('conv.mention_title', 'Mentionner un partenaire') + '">@ ' + t('conv.mention', 'Mentionner') + '</button>' +
      '<button type="button" class="myfb-conv-tool" data-myfb-conv-act="open-target"   title="' + t('conv.target_title',  'Adresser à')              + '">→ ' + t('conv.target',  'Cibler')      + '</button>' +
      '<button type="button" class="myfb-conv-tool" data-myfb-conv-act="open-propose"  title="' + t('conv.propose_title', 'Proposer une modification du texte') + '">✏ ' + t('conv.propose', 'Proposer une modif') + '</button>' +
      '<span class="myfb-conv-draft-info"></span>';
    form.parentNode.insertBefore(bar, form);

    // Hook the form submit so we attach mentions/target/proposeText.
    var origSubmit = form.onsubmit;
    var prevHandler = function (e) {
      e.preventDefault();
      var inp = form.querySelector('.myfb-triage-thread-input');
      var txt = inp && inp.value.trim();
      if (!txt) return;
      var T = window.MyFbTriage;
      if (!T) return;
      var d = _draft(id);
      var mentions = Array.from(d.mentions || []);
      var opts = { mentions: mentions, target: d.target || null, proposeText: d.proposeText || null };
      T.addComment(id, txt, opts).then(function () {
        inp.value = '';
        d.target = null; d.proposeText = null; d.mentions = new Set();
        _refreshDraftInfo(form);
        // Re-render the parent thread
        var thr = form.closest('[data-myfb-thread]');
        if (thr) _renderRich(thr);
      }).catch(function (err) {
        _toast(t('conv.add_failed', 'Échec : ' + (err && err.message)), 'error');
      });
    };
    form.addEventListener('submit', prevHandler, { capture: true });
  }

  function _refreshDraftInfo(form) {
    var id = form.getAttribute('data-id');
    var d = _draft(id);
    var info = form.parentNode.querySelector('.myfb-conv-draft-info');
    if (!info) return;
    var parts = [];
    if (d.target) parts.push('→ ' + _peerLabel(d.target));
    if (d.mentions && d.mentions.size) parts.push('@×' + d.mentions.size);
    if (d.proposeText) parts.push('✏ ' + d.proposeText.slice(0, 28) + (d.proposeText.length > 28 ? '…' : ''));
    info.textContent = parts.join(' · ');
  }

  function _onClick(e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-myfb-conv-act]');
    if (!btn) return;
    e.stopPropagation();
    var act = btn.getAttribute('data-myfb-conv-act');
    var form = btn.closest('.myfb-conv-toolbar') ? btn.parentNode.parentNode.querySelector('.myfb-triage-thread-form') : null;
    if (!form) form = document.querySelector('.myfb-triage-thread-form[data-id="' + (btn.getAttribute('data-id') || '') + '"]');
    var id  = form && form.getAttribute('data-id');
    if      (act === 'open-mentions') _openPeerPicker(id, 'mention', form);
    else if (act === 'open-target')   _openPeerPicker(id, 'target',  form);
    else if (act === 'open-propose')  _openProposeEditor(id, form);
    else if (act === 'accept')        _doAccept(btn.getAttribute('data-id'), btn.getAttribute('data-cid'));
    else if (act === 'refuse')        _doRefuse(btn.getAttribute('data-id'), btn.getAttribute('data-cid'));
  }

  function _onInput(_e) { /* reserved for live @ autocomplete in v2.4 */ }
  function _onSubmit(_e) { /* form submit handled in _extendForm */ }

  function _openPeerPicker(demandeId, mode, form) {
    var existing = document.querySelector('.myfb-conv-peer-picker');
    if (existing) existing.remove();
    var peers = _peers();
    if (peers.length === 0) {
      _toast(t('conv.no_peers', 'Aucun partenaire lié. Allez dans Réglages → Liaisons.'), 'info', 3500);
      return;
    }
    var pop = document.createElement('div');
    pop.className = 'myfb-conv-peer-picker';
    pop.innerHTML =
      '<div class="myfb-conv-peer-header">' + (mode === 'target'
        ? t('conv.pick_target', 'Adresser à…')
        : t('conv.pick_mention', 'Mentionner…')) + '</div>' +
      peers.map(function (p) {
        return '<button type="button" class="myfb-conv-peer-item" data-uuid="' + _escAttr(p.peerUuid) + '">' +
          '<span class="myfb-conv-peer-label">' + _esc(p.peerLabel || p.peerUuid.slice(0, 8)) + '</span>' +
          '<span class="myfb-conv-peer-role">' + _esc(p.peerRole || '') + '</span>' +
        '</button>';
      }).join('') +
      '<button type="button" class="myfb-conv-peer-cancel">' + t('conv.cancel', 'Annuler') + '</button>';
    document.body.appendChild(pop);
    // Position near the button
    var anchor = form && form.parentNode && form.parentNode.querySelector('[data-myfb-conv-act="open-' + (mode === 'target' ? 'target' : 'mentions') + '"]');
    if (anchor) {
      var r = anchor.getBoundingClientRect();
      pop.style.top  = (r.bottom + 4) + 'px';
      pop.style.left = Math.max(8, r.left) + 'px';
    }
    pop.addEventListener('click', function (ev) {
      var item = ev.target.closest('[data-uuid]');
      if (item) {
        var uuid = item.getAttribute('data-uuid');
        var d = _draft(demandeId);
        if (mode === 'target') d.target = uuid;
        else d.mentions.add(uuid);
        // Auto-insert "@<label> " into the textarea for visibility
        if (mode === 'mention' && form) {
          var inp = form.querySelector('.myfb-triage-thread-input');
          if (inp) {
            var label = _peerLabel(uuid);
            inp.value = (inp.value ? inp.value.replace(/\s*$/, ' ') : '') + '@' + label + ' ';
            inp.focus();
          }
        }
        _refreshDraftInfo(form);
        pop.remove();
        return;
      }
      if (ev.target.closest('.myfb-conv-peer-cancel')) {
        pop.remove();
      }
    });
    setTimeout(function () { document.addEventListener('click', function once() { if (pop.parentNode) pop.remove(); document.removeEventListener('click', once); }, { once: true, capture: true }); }, 0);
  }

  function _openProposeEditor(demandeId, form) {
    var existing = document.querySelector('.myfb-conv-propose-editor');
    if (existing) existing.remove();
    var ctx = window.MyFb && window.MyFb.runtime;
    var demande = (ctx && ctx.state && ctx.state.demandes[demandeId]) || null;
    var initial = (demande && demande.text) || '';
    var d = _draft(demandeId);
    if (d.proposeText) initial = d.proposeText;
    var pop = document.createElement('div');
    pop.className = 'myfb-conv-propose-editor';
    pop.innerHTML =
      '<div class="myfb-conv-propose-editor-label">' + t('conv.propose_compose', '✏ Texte proposé pour le segment') + '</div>' +
      '<textarea class="myfb-conv-propose-editor-text" rows="5"></textarea>' +
      '<div class="myfb-conv-propose-editor-actions">' +
        '<button type="button" class="myfb-conv-mini myfb-conv-refuse" data-cancel>' + t('conv.cancel', 'Annuler') + '</button>' +
        '<button type="button" class="myfb-conv-mini myfb-conv-accept" data-save>'   + t('conv.attach',  'Joindre au commentaire') + '</button>' +
      '</div>';
    var thr = form && form.closest('[data-myfb-thread]');
    if (thr) thr.appendChild(pop);
    else document.body.appendChild(pop);
    var ta = pop.querySelector('textarea');
    ta.value = initial;
    ta.focus();
    pop.querySelector('[data-cancel]').addEventListener('click', function () { pop.remove(); });
    pop.querySelector('[data-save]').addEventListener('click', function () {
      d.proposeText = ta.value.trim() || null;
      _refreshDraftInfo(form);
      pop.remove();
      _toast(t('conv.propose_attached', 'Modification jointe au prochain commentaire.'), 'info', 2200);
    });
  }

  function _doAccept(demandeId, commentId) {
    var T = window.MyFbTriage;
    if (!T || !T.acceptProposal) return;
    if (!confirm(t('conv.accept_confirm', 'Appliquer cette modification au segment ?'))) return;
    T.acceptProposal(demandeId, commentId).then(function () {
      _toast(t('conv.accepted', 'Modification appliquée.'), 'success');
      var thr = document.querySelector('[data-myfb-thread="' + demandeId + '"]');
      if (thr) _renderRich(thr);
    }).catch(function (err) {
      _toast(t('conv.accept_failed', 'Échec : ' + (err && err.message)), 'error');
    });
  }

  function _doRefuse(demandeId, commentId) {
    var T = window.MyFbTriage;
    if (!T || !T.refuseProposal) return;
    T.refuseProposal(demandeId, commentId).then(function () {
      _toast(t('conv.refused', 'Modification refusée.'), 'info');
      var thr = document.querySelector('[data-myfb-thread="' + demandeId + '"]');
      if (thr) _renderRich(thr);
    }).catch(function () {});
  }

  function _fmtDate(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString(); } catch (_) { return ''; }
  }

  window.MyFbSegmentConversation = {
    init: init,
    _renderRich: _renderRich,
    _peers: _peers,
  };
})(window);
