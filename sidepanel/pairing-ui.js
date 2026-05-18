/**
 * My-Feedbacks Pairing UI (v1.16)
 *
 * Enriches the existing Settings → Liaisons panel with :
 *   - Admin side : "Mon code de pairing" — generated from MyFb.runtime.uuid
 *     via MyFb.core.pairing.generateCode(), with a 📋 copy button.
 *   - Client side : "Coller un code reçu" — text input + Validate;
 *     on success emits a `link.requested` event tagged with the
 *     peer's fingerprint so the admin's next sync pulls it.
 *
 * Both flows write through ctx.emit so the event stream is the only
 * source of truth — same channel as demandes, so tier 2 shared folder
 * carries pairing setups for free.
 */

(function (window) {
  'use strict';

  var t = function (k, fb) {
    return (window.MyFb && window.MyFb.utils && window.MyFb.utils.t)
      ? window.MyFb.utils.t(k, fb) : (fb || k);
  };

  function _toast(m, k, d) {
    if (window.MyFbToast && window.MyFbToast.show) window.MyFbToast.show(m, k || 'info', d || 2500);
  }

  function init() {
    // Defer to next tick so the legacy settings-ui mounts the
    // [data-myfb-links-panel] host first; then we decorate it.
    setTimeout(function () { _renderInto(); }, 200);
    document.addEventListener('click', _onClick, true);
    document.addEventListener('submit', _onSubmit, true);
  }

  function _renderInto() {
    var host = document.querySelector('[data-myfb-links-panel]');
    if (!host) return;
    var ctx     = window.MyFb && window.MyFb.runtime;
    var pairing = window.MyFb && window.MyFb.core && window.MyFb.core.pairing;
    if (!pairing) return;
    var uuid    = ctx && ctx.uuid;
    var profile = ctx && ctx.profile;
    var role    = (profile && profile.role) || 'admin';
    var code    = uuid ? pairing.generateCode({ uuid: uuid }) : null;

    var existing = host.querySelector('.myfb-pairing-block');
    if (existing) existing.remove();
    var block = document.createElement('div');
    block.className = 'myfb-pairing-block';

    var adminSection =
      '<div class="myfb-pairing-section">' +
        '<h4>' + t('pairing.admin_title', '🛠 Mon code de pairing') + '</h4>' +
        '<p class="sp-section-desc">' + t('pairing.admin_desc', 'Partagez ce code avec votre client pour qu\'il puisse vous lier comme partenaire.') + '</p>' +
        '<div class="myfb-pairing-code-row">' +
          '<code class="myfb-pairing-code">' + (code || '—') + '</code>' +
          '<button type="button" class="myfb-mini-btn" data-myfb-pairing-act="copy-code" title="' + t('pairing.copy_code', 'Copier') + '">📋</button>' +
        '</div>' +
        '<p class="myfb-pairing-hint">' + t('pairing.admin_hint', 'Le code est déterministe : il ne change pas tant que vous ne régénérez pas votre UUID.') + '</p>' +
      '</div>';

    var clientSection =
      '<div class="myfb-pairing-section">' +
        '<h4>' + t('pairing.client_title', '💬 Coller un code reçu') + '</h4>' +
        '<p class="sp-section-desc">' + t('pairing.client_desc', 'Saisissez le code de pairing fourni par votre dev/agence.') + '</p>' +
        '<form class="myfb-pairing-form" data-myfb-pairing-act="paste-form">' +
          '<input type="text" class="myfb-pairing-input" placeholder="MYFB-XXXXXX" maxlength="20" autocomplete="off" spellcheck="false" />' +
          '<button type="submit" class="sp-action-btn">' + t('pairing.validate', 'Valider') + '</button>' +
        '</form>' +
      '</div>';

    // Show admin section if user IS admin OR if no role is set; show client
    // section always (a same install could play both roles in P2P).
    block.innerHTML =
      (role !== 'client' ? adminSection : '') +
      clientSection;

    // Insert before the existing links list (empty-state or rows).
    host.insertBefore(block, host.firstChild);
  }

  function _onClick(e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-myfb-pairing-act="copy-code"]');
    if (!btn) return;
    e.stopPropagation();
    var codeEl = btn.parentNode.querySelector('.myfb-pairing-code');
    var code = codeEl && codeEl.textContent;
    if (!code || code === '—') return;
    try {
      navigator.clipboard.writeText(code).then(function () {
        _toast(t('pairing.code_copied', 'Code copié : ' + code), 'success', 2000);
      });
    } catch (_) {}
  }

  function _onSubmit(e) {
    var f = e.target;
    if (!f || !f.matches || !f.matches('[data-myfb-pairing-act="paste-form"]')) return;
    e.preventDefault();
    e.stopPropagation();
    var inp = f.querySelector('.myfb-pairing-input');
    if (!inp) return;
    _consumeCode(inp.value, function () { inp.value = ''; });
  }

  function _consumeCode(input, onSuccess) {
    var pairing = window.MyFb && window.MyFb.core && window.MyFb.core.pairing;
    var ctx     = window.MyFb && window.MyFb.runtime;
    var Tev     = window.MyFb && window.MyFb.core && window.MyFb.core.events && window.MyFb.core.events.TYPES;
    if (!pairing) { _toast(t('pairing.unavailable', 'Module pairing indisponible.'), 'error'); return; }

    var parsed = pairing.parseCode(input);
    if (!parsed.ok) {
      var reason = parsed.reason === 'checksum' ? t('pairing.bad_checksum', 'Code invalide (typo ?). Vérifiez la dernière lettre.')
                 : parsed.reason === 'format'   ? t('pairing.bad_format',   'Format invalide. Attendu : MYFB-XXXXXX.')
                 : t('pairing.empty', 'Saisissez un code.');
      _toast(reason, 'error', 3500);
      return;
    }

    // Self-pair guard : refuse if the fingerprint matches our own UUID
    if (ctx && ctx.uuid && pairing.fingerprintOf(ctx.uuid) === parsed.fingerprint) {
      _toast(t('pairing.self_pair', 'C\'est votre propre code — impossible de se lier à soi-même.'), 'warning', 4000);
      return;
    }

    // Emit link.requested through ctx.emit (rides the event stream =>
    // gets pushed to remote peers via the sync engine).
    if (!ctx || !ctx.emit || !Tev) {
      _toast(t('pairing.no_runtime', 'Runtime non disponible — les liaisons nécessitent l\'event store.'), 'warning', 4500);
      return;
    }
    ctx.emit(Tev.LINK_REQUESTED, {
      peerUuid:    'pending:' + parsed.fingerprint,  // placeholder until link.accepted carries the full UUID
      peerRole:    'admin',
      peerLabel:   parsed.fingerprint,
      fingerprint: parsed.fingerprint,
    }).then(function () {
      _toast(t('pairing.link_requested', 'Demande de liaison envoyée — en attente de l\'admin.'), 'success', 4000);
      onSuccess && onSuccess();
      _renderInto();  // refresh
    }).catch(function (err) {
      _toast(t('pairing.emit_failed', 'Échec : ' + (err && err.message)), 'error', 4000);
    });
  }

  window.MyFbPairingUi = {
    init:          init,
    _renderInto:   _renderInto,
    _consumeCode:  _consumeCode,
  };
})(window);
