/**
 * My-Feedbacks Onboarding Wizard
 *
 * First-launch identity flow — 4 screens that capture WHO the user is
 * (admin vs client), their display name, an optional pairing code, and
 * their RGPD consent choices. Runs BEFORE the existing feature tour
 * (sidepanel/wizard.js) so the profile is persisted before any other
 * UI shows.
 *
 * Lifecycle :
 *   - hydrate.js calls bootstrap.init() which loads the profile.
 *   - If profile is missing OR consent.acceptedAt is null, this wizard
 *     overlays the side panel.
 *   - On done, persists the profile and removes the overlay.
 *   - Skippable at every screen (we still write a minimal "admin" profile
 *     with conservative consent defaults so the extension is usable).
 */

(function (window) {
  'use strict';

  var t = function (k, fb) {
    return (window.MyFb && window.MyFb.utils && window.MyFb.utils.t)
      ? window.MyFb.utils.t(k, fb) : (fb || k);
  };

  var _overlay = null;
  var _onDone  = null;
  var _ctx     = null;
  var _draft   = null;  // in-flight profile being built across screens

  // ── Screen catalog (rendered in order) ──────────────────────────────
  var SCREENS = [
    { id: 'role',     render: _renderRole     },
    { id: 'identity', render: _renderIdentity },
    { id: 'pairing',  render: _renderPairing  },
    { id: 'consent',  render: _renderConsent  },
  ];
  var _cur = 0;

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Open the onboarding overlay.
   * @param {object} ctx — result of MyFb.core.bootstrap.init()
   * @param {() => void} onDone — called when user finishes (or skips entirely)
   */
  function open(ctx, onDone) {
    if (_overlay) return;
    _ctx = ctx;
    _onDone = onDone || function () {};
    _cur = 0;
    _draft = _initialDraft(ctx.uuid);
    _build();
    _show(SCREENS[_cur]);
  }

  /**
   * Should onboarding run? Pure read of the loaded profile.
   * @param {object|null} profile
   * @returns {boolean}
   */
  function shouldOpen(profile) {
    var P = window.MyFb && window.MyFb.core && window.MyFb.core.profile;
    if (!P) return false;
    return !P.hasOnboarded(profile);
  }

  function close() {
    if (!_overlay) return;
    _overlay.remove();
    _overlay = null;
    _ctx = null;
    _draft = null;
    if (_onDone) _onDone();
    _onDone = null;
  }

  // ── Build skeleton + navigation ─────────────────────────────────────

  function _build() {
    _overlay = document.createElement('div');
    _overlay.id = 'myfb-onb';
    _overlay.className = 'myfb-onb';
    _overlay.setAttribute('role', 'dialog');
    _overlay.setAttribute('aria-modal', 'true');
    _overlay.setAttribute('aria-label', t('onb.aria', 'Onboarding My-Feedbacks'));
    _overlay.innerHTML =
      '<div class="myfb-onb-modal">' +
        '<div class="myfb-onb-progress" aria-hidden="true">' +
          SCREENS.map(function (_, i) { return '<span data-i="' + i + '"></span>'; }).join('') +
        '</div>' +
        '<div class="myfb-onb-body" aria-live="polite"></div>' +
        '<div class="myfb-onb-nav">' +
          '<button type="button" class="myfb-onb-back"  data-act="onb-back">' + t('onb.nav.back', '← Retour') + '</button>' +
          '<button type="button" class="myfb-onb-skip"  data-act="onb-skip">' + t('onb.nav.skip', 'Passer')   + '</button>' +
          '<button type="button" class="myfb-onb-next"  data-act="onb-next">' + t('onb.nav.next', 'Continuer →') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(_overlay);

    _overlay.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'onb-next') _next();
      else if (act === 'onb-back') _back();
      else if (act === 'onb-skip') _skip();
    });
  }

  function _show(screen) {
    var body = _overlay.querySelector('.myfb-onb-body');
    body.innerHTML = '';
    body.appendChild(screen.render());
    _updateProgress();
    _updateNav();
  }

  function _updateProgress() {
    var dots = _overlay.querySelectorAll('.myfb-onb-progress span');
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('is-active', i === _cur);
      dots[i].classList.toggle('is-done',   i <  _cur);
    }
  }

  function _updateNav() {
    var nav = _overlay.querySelector('.myfb-onb-nav');
    var back = nav.querySelector('[data-act=onb-back]');
    var next = nav.querySelector('[data-act=onb-next]');
    back.style.visibility = _cur === 0 ? 'hidden' : 'visible';
    next.textContent = _cur === SCREENS.length - 1
      ? t('onb.nav.done', '✓ Démarrer My-Feedbacks')
      : t('onb.nav.next', 'Continuer →');
  }

  function _next() {
    if (_cur >= SCREENS.length - 1) return _finish(/* skipped */ false);
    if (!_validateCurrent()) return;
    _cur++;
    _show(SCREENS[_cur]);
  }

  function _back() {
    if (_cur === 0) return;
    _cur--;
    _show(SCREENS[_cur]);
  }

  function _skip() {
    if (!confirm(t('onb.confirm_skip', 'Passer la configuration ? Vous pourrez revenir dans Réglages à tout moment.'))) return;
    _finish(/* skipped */ true);
  }

  function _validateCurrent() {
    var id = SCREENS[_cur].id;
    if (id === 'role'     && !_draft.role) {
      _shakeRoleScreen();
      return false;
    }
    return true;
  }

  function _shakeRoleScreen() {
    var card = _overlay.querySelector('.myfb-onb-role-grid');
    if (!card) return;
    card.classList.add('is-shake');
    setTimeout(function () { card.classList.remove('is-shake'); }, 600);
  }

  // ── Finish: persist profile, close ──────────────────────────────────

  function _finish(skipped) {
    var profileMod = window.MyFb && window.MyFb.core && window.MyFb.core.profile;
    var eventsMod  = window.MyFb && window.MyFb.core && window.MyFb.core.events;
    if (!profileMod) { close(); return; }

    // If user skipped without choosing role, default to admin with
    // restrictive consent (we'd rather be conservative).
    if (skipped && !_draft.role) {
      _draft.role = 'admin';
      _draft.consent = profileMod.defaultConsent('admin');
      _draft.consent.includeBreadcrumbs = false;   // extra-conservative
    }

    var profile = profileMod.create({
      uuid:        _ctx ? _ctx.uuid : _draft.uuid,
      role:        _draft.role,
      displayName: _draft.displayName,
      email:       _draft.email,
    });
    profile = profileMod.acceptConsent(profile, _draft.consent);

    profileMod.save(profile).then(function () {
      // Emit a profile.updated-like event via the runtime, if available.
      if (_ctx && _ctx.emit && eventsMod) {
        // The current event catalog doesn't have a "profile.updated" type
        // (it's stored separately in chrome.storage.sync, not in the event
        // log), so no event to emit. The DEVICE_CONNECTED event was
        // already emitted by bootstrap.init().
      }
      close();
    }).catch(function () {
      // Even on persist failure, dismiss so the user isn't trapped.
      close();
    });
  }

  function _initialDraft(uuid) {
    return {
      uuid:        uuid || '',
      role:        null,
      displayName: '',
      email:       '',
      consent:     {
        includeDeviceUuid:  true,
        includeDeviceMeta:  true,
        includeErrors:      true,
        includeBreadcrumbs: false, // safe default; admin will see it pre-checked
      },
    };
  }

  // ── Screen renderers ────────────────────────────────────────────────

  function _renderRole() {
    var d = document.createElement('div');
    d.className = 'myfb-onb-screen myfb-onb-screen-role';
    d.innerHTML =
      '<h1 class="myfb-onb-title">' + t('onb.welcome.title', 'Bienvenue dans My-Feedbacks') + '</h1>' +
      '<p  class="myfb-onb-desc">'  + t('onb.welcome.desc',  'Le pont de feedback local-first entre développeurs et leurs clients.') + '</p>' +
      '<h2 class="myfb-onb-q">'     + t('onb.role.question', 'Vous êtes…') + '</h2>' +
      '<div class="myfb-onb-role-grid">' +
        '<button type="button" class="myfb-onb-role" data-role="admin">' +
          '<span class="myfb-onb-role-icon" aria-hidden="true">🛠</span>' +
          '<span class="myfb-onb-role-label">' + t('onb.role.admin_label', 'Admin') + '</span>' +
          '<span class="myfb-onb-role-hint">'  + t('onb.role.admin_hint',  'Je code, j\'envoie mes feedbacks à mon IA et je récupère les feedbacks d\'utilisateurs') + '</span>' +
        '</button>' +
        '<button type="button" class="myfb-onb-role" data-role="client">' +
          '<span class="myfb-onb-role-icon" aria-hidden="true">💬</span>' +
          '<span class="myfb-onb-role-label">' + t('onb.role.client_label', 'User') + '</span>' +
          '<span class="myfb-onb-role-hint">'  + t('onb.role.client_hint',  'Je remonte des bugs / besoins à mon dev') + '</span>' +
        '</button>' +
      '</div>';
    d.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('.myfb-onb-role');
      if (!btn) return;
      _draft.role = btn.getAttribute('data-role');
      // Update consent defaults based on role choice
      var P = window.MyFb && window.MyFb.core && window.MyFb.core.profile;
      if (P) _draft.consent = P.defaultConsent(_draft.role);
      d.querySelectorAll('.myfb-onb-role').forEach(function (b) { b.classList.toggle('is-selected', b === btn); });
    });
    return d;
  }

  function _renderIdentity() {
    var d = document.createElement('div');
    d.className = 'myfb-onb-screen myfb-onb-screen-identity';
    d.innerHTML =
      '<h1 class="myfb-onb-title">' + t('onb.identity.title', 'Comment vous nommer ?') + '</h1>' +
      '<p  class="myfb-onb-desc">'  + t('onb.identity.desc',  'Affiché à vos partenaires liés. Modifiable dans Réglages.') + '</p>' +
      '<label class="myfb-onb-field">' +
        '<span class="myfb-onb-field-label">' + t('onb.identity.name_label', 'Nom ou pseudo') + '</span>' +
        '<input type="text" class="myfb-onb-input" id="onb-name" autocomplete="off" maxlength="60" placeholder="' + t('onb.identity.name_placeholder', 'Ex. Alice ou Agence X') + '" />' +
      '</label>' +
      '<label class="myfb-onb-field">' +
        '<span class="myfb-onb-field-label">' + t('onb.identity.email_label', 'Email') + ' <span class="myfb-onb-opt">(' + t('onb.optional', 'optionnel') + ')</span></span>' +
        '<input type="email" class="myfb-onb-input" id="onb-email" autocomplete="off" maxlength="120" placeholder="alice@example.com" />' +
      '</label>' +
      '<p class="myfb-onb-hint">' + t('onb.identity.email_hint', 'Utilisé uniquement pour les fallback mailto: (envoi de feedbacks). Jamais publié.') + '</p>';

    var name  = d.querySelector('#onb-name');
    var email = d.querySelector('#onb-email');
    if (name)  name.value  = _draft.displayName || '';
    if (email) email.value = _draft.email       || '';
    if (name)  name.addEventListener('input',  function () { _draft.displayName = name.value.trim().slice(0, 60); });
    if (email) email.addEventListener('input', function () { _draft.email       = email.value.trim().slice(0, 120) || null; });
    // Auto-focus on name
    setTimeout(function () { if (name) name.focus(); }, 100);
    return d;
  }

  function _renderPairing() {
    var d = document.createElement('div');
    d.className = 'myfb-onb-screen myfb-onb-screen-pairing';
    d.innerHTML =
      '<h1 class="myfb-onb-title">' + t('onb.pairing.title', 'Lier un partenaire') + '</h1>' +
      '<p  class="myfb-onb-desc">'  + t('onb.pairing.desc',  'Optionnel — vous pouvez aussi le faire plus tard dans Réglages → Liaisons.') + '</p>' +
      '<div class="myfb-onb-pairing-card">' +
        '<div class="myfb-onb-pairing-soon" aria-hidden="true">🔗</div>' +
        '<p>' + t('onb.pairing.coming_soon', 'Le système de pairing direct (code court à partager) arrive dans une prochaine version.') + '</p>' +
        '<p class="myfb-onb-hint">' + t('onb.pairing.skip_hint', 'En attendant, vous pouvez exporter vos feedbacks via les boutons IA et le bridge VS Code existants.') + '</p>' +
      '</div>';
    return d;
  }

  function _renderConsent() {
    var d = document.createElement('div');
    d.className = 'myfb-onb-screen myfb-onb-screen-consent';
    var c = _draft.consent;
    d.innerHTML =
      '<h1 class="myfb-onb-title">' + t('onb.consent.title', 'Confidentialité') + '</h1>' +
      '<div class="myfb-onb-consent-banner">' +
        '<p><strong>' + t('onb.consent.always_local_t', 'Toujours local.') + '</strong> ' + t('onb.consent.always_local', 'Vos feedbacks sont stockés UNIQUEMENT sur cet appareil. Aucun serveur tiers, aucun cloud, aucune analytique.') + '</p>' +
      '</div>' +
      '<p class="myfb-onb-desc">' + t('onb.consent.desc', 'Quand vous cliquez « Envoyer à mon dev/client », ces éléments sont inclus :') + '</p>' +
      '<div class="myfb-onb-consent-list">' +
        _consentToggle('includeDeviceUuid',  c.includeDeviceUuid,  'onb.consent.toggle_uuid',  'Mon identifiant appareil (UUID)',         'onb.consent.detail_uuid',  'Permet à votre partenaire d\'identifier votre setup unique.') +
        _consentToggle('includeDeviceMeta',  c.includeDeviceMeta,  'onb.consent.toggle_meta',  'Métadonnées techniques (browser, OS, écran)', 'onb.consent.detail_meta', 'Crucial pour la reproduction d\'un bug.') +
        _consentToggle('includeErrors',      c.includeErrors,      'onb.consent.toggle_errors', 'Erreurs JS récentes de la page',          'onb.consent.detail_errors', 'Les 20 dernières erreurs console au moment de l\'envoi.') +
        _consentToggle('includeBreadcrumbs', c.includeBreadcrumbs, 'onb.consent.toggle_breadcrumbs', 'Mes 20 dernières actions',         'onb.consent.detail_breadcrumbs', 'Type d\'élément cliqué et sélecteur uniquement — JAMAIS le contenu des champs.') +
      '</div>' +
      '<p class="myfb-onb-hint">' + t('onb.consent.footer', 'Aucune donnée n\'est transmise sans votre action explicite. Modifiable à tout moment dans Réglages → Confidentialité.') + '</p>';

    d.addEventListener('change', function (e) {
      var inp = e.target;
      if (!inp || inp.type !== 'checkbox') return;
      var key = inp.getAttribute('data-consent');
      if (!key) return;
      _draft.consent[key] = inp.checked;
    });
    return d;
  }

  function _consentToggle(key, checked, labelKey, labelDefault, detailKey, detailDefault) {
    return '<label class="myfb-onb-toggle">' +
      '<input type="checkbox" data-consent="' + key + '"' + (checked ? ' checked' : '') + ' />' +
      '<span class="myfb-onb-toggle-text">' +
        '<span class="myfb-onb-toggle-label">' + t(labelKey, labelDefault) + '</span>' +
        '<span class="myfb-onb-toggle-detail">' + t(detailKey, detailDefault) + '</span>' +
      '</span>' +
    '</label>';
  }

  // ── Public surface ──────────────────────────────────────────────────
  window.MyFbOnboarding = {
    open:       open,
    close:      close,
    shouldOpen: shouldOpen,
  };
})(window);
