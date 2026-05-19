/**
 * MyFb Segment Conversation (v2.5)
 *
 * Enriches the basic triage-ui comment thread with :
 *   - @-mentions    : "@ Mentionner" picker, pill cyan in rendered text
 *   - → Cibler      : address a comment to one peer, amber border + pill
 *   - ✏ Propose-edit: send a revised segment text, ✅ accept fires
 *                     DEMANDE_TEXT_UPDATED (segment really changes), the
 *                     audit lives in the event log forever
 *
 * Decorator pattern via MutationObserver — the base triage-ui owns the
 * `[data-myfb-thread]` container ; this module observes new nodes and
 * re-renders the comment list with the rich features. Submit is wrapped
 * to attach the draft metadata (mentions / target / proposeText) before
 * forwarding to MyFbTriage.addComment().
 *
 * No DOM is created until a thread exists, so the cost when the user
 * never opens a comments section is zero observer callbacks.
 *
 * Public API : MyFbSegmentConversation.init() — wires the MutationObserver.
 */
(function (window) {
  'use strict';

  var UTILS = (window.MyFb && window.MyFb.utils) || {};
  var DOM   = (window.MyFb && window.MyFb.dom)   || {};
  function _t(k, fb, vars) { return UTILS.t ? UTILS.t(k, fb, vars) : (fb || k); }
  function esc(s) { return DOM.esc ? DOM.esc(s) : String(s == null ? '' : s); }

  // Per-thread drafts so a switch tab and back doesn't lose what the user
  // was typing or the peer they had just picked. Keyed by demandeId.
  var _drafts = Object.create(null);

  function _draft(id) {
    if (!_drafts[id]) _drafts[id] = { mentions: [], target: null, proposeText: '' };
    return _drafts[id];
  }
  function _resetDraft(id) {
    _drafts[id] = { mentions: [], target: null, proposeText: '' };
  }

  // ── Peer list (linked admins/clients accepted via pairing) ───────────
  function _peers() {
    var rt = window.MyFb && window.MyFb.runtime;
    if (!rt || !rt.state || !rt.state.links) return [];
    return Object.keys(rt.state.links).reduce(function (out, uuid) {
      var l = rt.state.links[uuid];
      if (l && l.status === 'accepted') {
        out.push({
          uuid:  uuid,
          label: l.peerLabel || uuid.slice(0, 8),
          role:  l.peerRole  || 'peer',
        });
      }
      return out;
    }, []);
  }

  function _peerLabel(uuid) {
    var p = _peers().find(function (x) { return x.uuid === uuid; });
    return p ? p.label : uuid.slice(0, 8);
  }

  // Render `@uuid` and `@label` occurrences as cyan pills.
  function _renderMentions(text, mentions) {
    var out = esc(text);
    (mentions || []).forEach(function (uuid) {
      var label = _peerLabel(uuid);
      // Match either @uuid (full or 8-char slice) or @label
      var safeUuid  = uuid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var safeLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var pill = '<span class="myfb-conv-mention">@' + esc(label) + '</span>';
      out = out
        .replace(new RegExp('@' + safeUuid,   'g'), pill)
        .replace(new RegExp('@' + safeLabel, 'g'), pill);
    });
    return out;
  }

  function _currentUserUuid() {
    var rt = window.MyFb && window.MyFb.runtime;
    return (rt && rt.state && rt.state.device && rt.state.device.uuid) || null;
  }

  // ── Comment list — replace triage-ui's vanilla render ────────────────
  function _renderList(threadEl, demandeId) {
    var T = window.MyFbTriage;
    if (!T) return;
    var comments = T.listComments(demandeId) || [];
    var listEl   = threadEl.querySelector('.myfb-triage-thread-list');
    if (!listEl) return;
    if (comments.length === 0) {
      listEl.innerHTML = '<p class="myfb-triage-thread-empty">' +
        esc(_t('triage.no_comments', 'Aucun commentaire.')) + '</p>';
      return;
    }
    var me = _currentUserUuid();
    listEl.innerHTML = comments.map(function (c) {
      var targetClass = c.target ? ' is-targeted' : '';
      var targetPill  = c.target
        ? ' <span class="myfb-conv-target-pill" title="' +
            esc(_t('conv.target_tip', 'Adressé à')) + '">→ ' + esc(_peerLabel(c.target)) + '</span>'
        : '';
      var proposeCard = '';
      if (c.proposeText) {
        var status   = c.proposalStatus || 'open';
        var canDecide = status === 'open' && c.authorUuid !== me;
        proposeCard =
          '<div class="myfb-conv-propose myfb-conv-propose--' + esc(status) + '">' +
            '<div class="myfb-conv-propose-label">' +
              esc(_t('conv.propose_label', '✏ Modification proposée')) +
              (status !== 'open'
                ? ' <span class="myfb-conv-propose-status">' +
                    (status === 'accepted'
                      ? esc(_t('conv.proposal_accepted', '✅ acceptée'))
                      : esc(_t('conv.proposal_refused',  '❌ refusée'))) +
                  '</span>'
                : '') +
            '</div>' +
            '<pre class="myfb-conv-propose-text">' + esc(c.proposeText) + '</pre>' +
            (canDecide
              ? '<div class="myfb-conv-propose-actions">' +
                  '<button type="button" class="myfb-conv-btn myfb-conv-btn--accept" data-myfb-conv-act="accept" data-cid="' + esc(c.id) + '">' +
                    esc(_t('conv.accept', '✅ Accepter')) + '</button>' +
                  '<button type="button" class="myfb-conv-btn myfb-conv-btn--refuse" data-myfb-conv-act="refuse" data-cid="' + esc(c.id) + '">' +
                    esc(_t('conv.refuse', '❌ Refuser')) + '</button>' +
                '</div>'
              : '') +
          '</div>';
      }
      return '<div class="myfb-triage-comment myfb-conv-comment' + targetClass + '">' +
        '<div class="myfb-triage-comment-meta">' +
          '<span class="myfb-triage-comment-author">' + esc(c.authorUuid.slice(0, 8)) + '</span>' +
          targetPill +
          '<span class="myfb-triage-comment-ts">' + esc(new Date(c.ts).toLocaleString()) + '</span>' +
          (c.edited ? '<span class="myfb-triage-comment-edited">' + esc(_t('triage.edited', '(modifié)')) + '</span>' : '') +
          '<button type="button" class="myfb-triage-comment-del" data-myfb-act="comment-delete" data-id="' + esc(demandeId) + '" data-cid="' + esc(c.id) + '" aria-label="' + esc(_t('triage.delete', 'Supprimer')) + '">×</button>' +
        '</div>' +
        '<div class="myfb-triage-comment-text">' + _renderMentions(c.text || '', c.mentions) + '</div>' +
        proposeCard +
      '</div>';
    }).join('');
  }

  // ── Composer toolbar (@ / → / ✏) ─────────────────────────────────────
  function _renderToolbar(threadEl, demandeId) {
    if (threadEl.querySelector('.myfb-conv-toolbar')) return;   // already injected
    var formEl = threadEl.querySelector('.myfb-triage-comment-form');
    if (!formEl) return;
    var bar = document.createElement('div');
    bar.className = 'myfb-conv-toolbar';
    bar.innerHTML =
      '<button type="button" class="myfb-conv-btn"        data-myfb-conv-act="mention">@ ' + esc(_t('conv.mention', 'Mentionner')) + '</button>' +
      '<button type="button" class="myfb-conv-btn"        data-myfb-conv-act="target">→ '  + esc(_t('conv.target',  'Cibler'))      + '</button>' +
      '<button type="button" class="myfb-conv-btn"        data-myfb-conv-act="propose">✏ ' + esc(_t('conv.propose', 'Proposer une modif')) + '</button>' +
      '<span   class="myfb-conv-draft" data-myfb-conv-draft></span>';
    formEl.insertBefore(bar, formEl.firstChild);
    _updateDraftPills(threadEl, demandeId);
  }

  function _updateDraftPills(threadEl, demandeId) {
    var draft = _draft(demandeId);
    var pillsEl = threadEl.querySelector('[data-myfb-conv-draft]');
    if (!pillsEl) return;
    var parts = [];
    (draft.mentions || []).forEach(function (uuid) {
      parts.push('<span class="myfb-conv-pill myfb-conv-pill--mention" data-myfb-conv-act="drop-mention" data-uuid="' + esc(uuid) + '">@' + esc(_peerLabel(uuid)) + ' ×</span>');
    });
    if (draft.target) {
      parts.push('<span class="myfb-conv-pill myfb-conv-pill--target" data-myfb-conv-act="drop-target">→ ' + esc(_peerLabel(draft.target)) + ' ×</span>');
    }
    if (draft.proposeText) {
      parts.push('<span class="myfb-conv-pill myfb-conv-pill--propose" data-myfb-conv-act="drop-propose">✏ ' + esc(_t('conv.propose_attached', 'modif jointe')) + ' ×</span>');
    }
    pillsEl.innerHTML = parts.join(' ');
  }

  // ── Pickers ──────────────────────────────────────────────────────────
  function _openPeerPicker(threadEl, demandeId, mode) {
    var existing = threadEl.querySelector('.myfb-conv-picker');
    if (existing) { existing.remove(); return; }
    var peers = _peers();
    var picker = document.createElement('div');
    picker.className = 'myfb-conv-picker';
    if (peers.length === 0) {
      picker.innerHTML = '<p class="myfb-conv-picker-empty">' +
        esc(_t('conv.no_peers', 'Aucun pair lié. Va dans Réglages → Liaisons pour en ajouter.')) + '</p>';
    } else {
      picker.innerHTML = peers.map(function (p) {
        return '<button type="button" class="myfb-conv-peer-btn" data-uuid="' + esc(p.uuid) + '">' +
          '<strong>' + esc(p.label) + '</strong> <span class="myfb-conv-peer-role">' + esc(p.role) + '</span>' +
        '</button>';
      }).join('');
    }
    picker.dataset.mode = mode;
    threadEl.querySelector('.myfb-conv-toolbar').appendChild(picker);
  }
  function _closePeerPicker(threadEl) {
    var p = threadEl.querySelector('.myfb-conv-picker'); if (p) p.remove();
  }

  function _openProposeEditor(threadEl, demandeId) {
    var existing = threadEl.querySelector('.myfb-conv-propose-editor');
    if (existing) { existing.remove(); return; }
    var ctx = window.MyFb && window.MyFb.runtime;
    var current = (ctx && ctx.state && ctx.state.demandes[demandeId] && ctx.state.demandes[demandeId].text) || '';
    var draft = _draft(demandeId);
    var ed = document.createElement('div');
    ed.className = 'myfb-conv-propose-editor';
    ed.innerHTML =
      '<label class="myfb-conv-propose-label">' + esc(_t('conv.propose_label', '✏ Modification proposée')) + '</label>' +
      '<textarea class="myfb-conv-propose-textarea" rows="6" data-myfb-conv-propose-input>' + esc(draft.proposeText || current) + '</textarea>' +
      '<div class="myfb-conv-propose-actions">' +
        '<button type="button" class="myfb-conv-btn myfb-conv-btn--primary" data-myfb-conv-act="attach-propose">' +
          esc(_t('conv.attach', 'Joindre au commentaire')) + '</button>' +
        '<button type="button" class="myfb-conv-btn" data-myfb-conv-act="cancel-propose">' +
          esc(_t('conv.cancel', 'Annuler')) + '</button>' +
      '</div>';
    threadEl.querySelector('.myfb-conv-toolbar').appendChild(ed);
  }

  // ── Wrap submit to attach draft metadata ─────────────────────────────
  function _wrapSubmit(threadEl, demandeId) {
    if (threadEl.dataset.myfbConvWrapped === '1') return;
    threadEl.dataset.myfbConvWrapped = '1';
    threadEl.addEventListener('submit', async function (e) {
      var form = e.target;
      if (!form.classList || !form.classList.contains('myfb-triage-comment-form')) return;
      var input = form.querySelector('input[name="text"], textarea[name="text"]');
      if (!input) return;
      var text = (input.value || '').trim();
      if (!text) return;
      var draft = _draft(demandeId);
      var hasExtras = (draft.mentions && draft.mentions.length) || draft.target || draft.proposeText;
      if (!hasExtras) return;            // let triage-ui's vanilla handler win
      e.preventDefault();
      e.stopImmediatePropagation();
      try {
        await window.MyFbTriage.addComment(demandeId, text, {
          mentions:    draft.mentions,
          target:      draft.target,
          proposeText: draft.proposeText,
        });
        input.value = '';
        _resetDraft(demandeId);
        _updateDraftPills(threadEl, demandeId);
        _renderList(threadEl, demandeId);
      } catch (err) {
        if (UTILS.toast) UTILS.toast(String(err && err.message || err), 'error', 3000);
      }
    }, true);
  }

  // ── Wire a single thread ─────────────────────────────────────────────
  function _wireThread(threadEl) {
    var demandeId = threadEl.dataset.myfbThread;
    if (!demandeId) return;
    _renderToolbar(threadEl, demandeId);
    _renderList(threadEl, demandeId);
    _wrapSubmit(threadEl, demandeId);
  }

  // ── Global click delegation ──────────────────────────────────────────
  function _bindClicks() {
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-myfb-conv-act]');
      if (!btn) return;
      var thread = btn.closest('.myfb-triage-comments-thread');
      if (!thread) return;
      var demandeId = thread.dataset.myfbThread;
      var draft = _draft(demandeId);
      var act = btn.dataset.myfbConvAct;

      if (act === 'mention') { e.preventDefault(); _openPeerPicker(thread, demandeId, 'mention'); return; }
      if (act === 'target')  { e.preventDefault(); _openPeerPicker(thread, demandeId, 'target');  return; }
      if (act === 'propose') { e.preventDefault(); _openProposeEditor(thread, demandeId);         return; }
      if (act === 'drop-mention') {
        e.preventDefault();
        var u = btn.dataset.uuid;
        draft.mentions = (draft.mentions || []).filter(function (x) { return x !== u; });
        _updateDraftPills(thread, demandeId); return;
      }
      if (act === 'drop-target')  { e.preventDefault(); draft.target = null;      _updateDraftPills(thread, demandeId); return; }
      if (act === 'drop-propose') { e.preventDefault(); draft.proposeText = '';   _updateDraftPills(thread, demandeId); return; }
      if (act === 'cancel-propose') {
        e.preventDefault();
        var ed = thread.querySelector('.myfb-conv-propose-editor'); if (ed) ed.remove();
        return;
      }
      if (act === 'attach-propose') {
        e.preventDefault();
        var ta = thread.querySelector('[data-myfb-conv-propose-input]');
        draft.proposeText = ta && ta.value ? ta.value.trim() : '';
        var edEl = thread.querySelector('.myfb-conv-propose-editor'); if (edEl) edEl.remove();
        _updateDraftPills(thread, demandeId);
        return;
      }
      if (act === 'accept' || act === 'refuse') {
        e.preventDefault();
        var cid = btn.dataset.cid;
        var fn  = act === 'accept' ? window.MyFbTriage.acceptProposal : window.MyFbTriage.refuseProposal;
        if (!fn) return;
        fn(demandeId, cid).then(function () { _renderList(thread, demandeId); })
          .catch(function (err) { if (UTILS.toast) UTILS.toast(String(err && err.message || err), 'error', 3000); });
        return;
      }
    });

    // Peer picker click → resolve mode (mention adds to mentions[], target sets single uuid)
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('.myfb-conv-peer-btn');
      if (!btn) return;
      e.preventDefault();
      var picker = btn.closest('.myfb-conv-picker');
      var thread = btn.closest('.myfb-triage-comments-thread');
      if (!picker || !thread) return;
      var demandeId = thread.dataset.myfbThread;
      var draft = _draft(demandeId);
      var uuid  = btn.dataset.uuid;
      var mode  = picker.dataset.mode;
      if (mode === 'mention') {
        if ((draft.mentions || []).indexOf(uuid) < 0) {
          draft.mentions = (draft.mentions || []).concat([uuid]);
        }
        // Inject @label in the input text too, so the user sees it
        var input = thread.querySelector('input[name="text"], textarea[name="text"]');
        if (input) { input.value = (input.value + ' @' + _peerLabel(uuid) + ' ').replace(/\s+/g, ' '); input.focus(); }
      } else if (mode === 'target') {
        draft.target = uuid;
      }
      _closePeerPicker(thread);
      _updateDraftPills(thread, demandeId);
    });
  }

  // ── MutationObserver — pick up threads as they're created ────────────
  function init() {
    if (window.__MYFB_CONV_INIT__) return;
    window.__MYFB_CONV_INIT__ = true;
    _bindClicks();
    // Wire any threads that were already in the DOM
    document.querySelectorAll('[data-myfb-thread]').forEach(_wireThread);
    var mo = new MutationObserver(function (records) {
      records.forEach(function (r) {
        r.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches('[data-myfb-thread]')) _wireThread(n);
          (n.querySelectorAll ? n.querySelectorAll('[data-myfb-thread]') : []).forEach(_wireThread);
        });
        // Re-render lists when triage-ui toggles a thread visible
        if (r.target && r.target.matches && r.target.matches('[data-myfb-thread]')) {
          _wireThread(r.target);
        }
      });
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }

  window.MyFbSegmentConversation = {
    init:                 init,
    _renderMentions:      _renderMentions,   // for tests
    _peers:               _peers,
    _drafts:              _drafts,           // for tests
  };
})(window);
