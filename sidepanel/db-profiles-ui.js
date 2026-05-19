/**
 * MyFb DB Profiles UI
 *
 * Renders the "Bases de données" settings section: list of profiles,
 * CRUD form, and the actions :
 *   - 🔄 Rafraîchir le schéma   (calls bridge if mode=bridge)
 *   - 📋 Coller dans le segment (drops schemaMd into the current demande)
 *   - ✏ Éditer le schéma manuellement
 *
 * Persists through window.MyFbStorage.persist using the same STATE
 * object as the rest of the app. Auto-injection on segment start is
 * stubbed for now — the user pastes manually via the 📋 button.
 *
 * Public API: MyFbDbProfilesUi.init() — wires the panel after DOM ready.
 */
(function (window) {
  'use strict';

  var STATE = null;
  var UTILS = (window.MyFb && window.MyFb.utils) || {};
  var DOM   = (window.MyFb && window.MyFb.dom)   || {};
  function _t(k, fb, vars) { return UTILS.t ? UTILS.t(k, fb, vars) : (fb || k); }
  function esc(s) { return DOM.esc ? DOM.esc(s) : String(s == null ? '' : s); }
  function toast(msg, kind, ms) {
    if (UTILS.toast) UTILS.toast(msg, kind || 'info', ms || 2200);
  }

  var ENGINES = [
    { v: 'mysql',    l: 'MySQL / MariaDB' },
    { v: 'postgres', l: 'PostgreSQL' },
    { v: 'sqlite',   l: 'SQLite' },
    { v: 'mongo',    l: 'MongoDB' },
    { v: 'other',    l: 'Autre' },
  ];

  function _uuid() {
    if (crypto.randomUUID) return 'db-' + crypto.randomUUID();
    var a = new Uint8Array(16); crypto.getRandomValues(a);
    return 'db-' + Array.from(a).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function _findProfile(id) {
    return (STATE.dbProfiles || []).find(function (p) { return p.id === id; }) || null;
  }

  function _persist() {
    if (window.MyFbStorage) window.MyFbStorage.persist(STATE);
  }

  // ── Secret encryption helpers ────────────────────────────────────────
  //
  // A profile's HMAC secret never lives in plain text inside chrome.storage.
  // It's wrapped in AES-GCM via a non-extractable key kept in IndexedDB
  // (see sidepanel/db-secret-crypto.js). The form exposes the plaintext
  // only when the user clicks "Éditer" — round-tripping through decrypt().
  function _crypto() { return window.MyFbDbSecretCrypto; }

  async function _readSecret(p) {
    if (!p) return '';
    if (p.bridgeSecret && !p.bridgeSecretEnc) return p.bridgeSecret; // pre-migration
    if (!_crypto() || !p.bridgeSecretEnc) return '';
    try { return await _crypto().decrypt(p.bridgeSecretEnc); }
    catch (e) { return ''; }
  }

  async function _writeSecret(p, plaintext) {
    if (!p) return;
    var c = _crypto();
    if (!c) { p.bridgeSecret = plaintext; return; } // graceful fallback
    if (!plaintext) { delete p.bridgeSecret; delete p.bridgeSecretEnc; return; }
    p.bridgeSecretEnc = await c.encrypt(plaintext);
    delete p.bridgeSecret;
  }

  /**
   * One-shot migration on init: encrypt any profile that still has a
   * plaintext `bridgeSecret` from before this module existed.
   */
  async function _migrateLegacySecrets() {
    var c = _crypto(); if (!c) return;
    var dirty = false;
    var profiles = STATE.dbProfiles || [];
    for (var i = 0; i < profiles.length; i++) {
      var p = profiles[i];
      if (p && p.bridgeSecret && !p.bridgeSecretEnc) {
        try { await _writeSecret(p, p.bridgeSecret); dirty = true; } catch (_) {}
      }
    }
    if (dirty) _persist();
  }

  // -----------------------------------------------------------------------
  // List rendering
  // -----------------------------------------------------------------------
  function _render() {
    var host = document.getElementById('db-profiles-list');
    if (!host) return;
    var profiles = STATE.dbProfiles || [];
    if (!profiles.length) {
      host.innerHTML = '<p class="dbp-empty">' +
        esc(_t('db.empty', 'Aucune fiche. Ajoute une BDD pour fournir son schéma à l\'IA.')) +
        '</p>';
      return;
    }
    host.innerHTML = profiles.map(_renderCard).join('');
  }

  function _renderCard(p) {
    var schemaLen = (p.schemaMd || '').length;
    var modeBadge = p.mode === 'bridge'
      ? '<span class="dbp-mode dbp-mode--bridge">' + esc(_t('db.mode_bridge', 'Bridge')) + '</span>'
      : '<span class="dbp-mode dbp-mode--paste">' + esc(_t('db.mode_paste', 'Collé')) + '</span>';
    var lastRefresh = p.lastRefreshTs
      ? esc(new Date(p.lastRefreshTs).toLocaleString())
      : esc(_t('db.never_refreshed', 'jamais rafraîchi'));
    var refreshBtn = p.mode === 'bridge'
      ? '<button type="button" class="dbp-btn" data-act="db-refresh" data-id="' + esc(p.id) + '" title="' +
        esc(_t('db.refresh_tip', 'Rafraîchir le schéma depuis le bridge')) + '">🔄</button>'
      : '';
    return '<div class="dbp-card" data-id="' + esc(p.id) + '">' +
      '<div class="dbp-card-head">' +
        '<strong class="dbp-label">' + esc(p.label || _t('db.unnamed', 'Sans nom')) + '</strong>' +
        modeBadge +
      '</div>' +
      '<div class="dbp-card-meta">' +
        '<span class="dbp-engine">' + esc(_engineLabel(p.engine)) + '</span>' +
        (p.host ? ' • <span>' + esc(p.host) + (p.port ? ':' + esc(String(p.port)) : '') + '</span>' : '') +
        (p.database ? ' • <span>' + esc(p.database) + '</span>' : '') +
      '</div>' +
      '<div class="dbp-card-stat">' +
        esc(_t('db.schema_len', schemaLen + ' car. de schéma', { n: schemaLen })) +
        ' • ' + lastRefresh +
      '</div>' +
      '<div class="dbp-card-actions">' +
        '<button type="button" class="dbp-btn dbp-btn--primary" data-act="db-paste" data-id="' + esc(p.id) +
          '" title="' + esc(_t('db.paste_tip', 'Coller le schéma dans le segment courant')) + '">📋 ' +
          esc(_t('db.paste', 'Insérer')) + '</button>' +
        refreshBtn +
        '<button type="button" class="dbp-btn" data-act="db-edit"   data-id="' + esc(p.id) + '">✎</button>' +
        '<button type="button" class="dbp-btn dbp-btn--danger" data-act="db-delete" data-id="' + esc(p.id) + '">🗑</button>' +
      '</div>' +
    '</div>';
  }

  function _engineLabel(v) {
    var match = ENGINES.find(function (e) { return e.v === v; });
    return match ? match.l : (v || _t('db.engine_unknown', 'Moteur ?'));
  }

  // -----------------------------------------------------------------------
  // Form (create / edit)
  // -----------------------------------------------------------------------
  async function _openForm(profile) {
    var form = document.getElementById('db-profile-form');
    var holder = document.getElementById('db-profile-form-holder');
    if (!form || !holder) return;
    var p = profile || {};
    var isNew = !profile;
    var secretPlain = profile ? await _readSecret(profile) : '';

    holder.style.display = 'block';
    form.innerHTML =
      '<input type="hidden" name="id" value="' + esc(p.id || '') + '" />' +
      '<label class="dbp-field"><span>' + esc(_t('db.field_label', 'Libellé')) + '</span>' +
        '<input type="text" name="label" required maxlength="60" value="' + esc(p.label || '') + '" placeholder="ex : WP prod" /></label>' +
      '<div class="dbp-field-row">' +
        '<label class="dbp-field"><span>' + esc(_t('db.field_engine', 'Moteur')) + '</span>' +
          '<select name="engine">' +
            ENGINES.map(function (e) {
              return '<option value="' + e.v + '"' + ((p.engine || 'mysql') === e.v ? ' selected' : '') + '>' + esc(e.l) + '</option>';
            }).join('') +
          '</select></label>' +
        '<label class="dbp-field"><span>' + esc(_t('db.field_mode', 'Mode')) + '</span>' +
          '<select name="mode">' +
            '<option value="paste"' + ((p.mode || 'paste') === 'paste' ? ' selected' : '') + '>' + esc(_t('db.mode_paste_long', 'Schéma collé')) + '</option>' +
            '<option value="bridge"' + (p.mode === 'bridge' ? ' selected' : '') + '>' + esc(_t('db.mode_bridge_long', 'Bridge HTTP (myfb-bridge.php)')) + '</option>' +
          '</select></label>' +
      '</div>' +
      '<div class="dbp-field-row">' +
        '<label class="dbp-field"><span>' + esc(_t('db.field_host', 'Hôte (informatif)')) + '</span>' +
          '<input type="text" name="host" maxlength="200" value="' + esc(p.host || '') + '" /></label>' +
        '<label class="dbp-field dbp-field--narrow"><span>' + esc(_t('db.field_port', 'Port')) + '</span>' +
          '<input type="number" name="port" min="1" max="65535" value="' + esc(p.port || '') + '" /></label>' +
      '</div>' +
      '<div class="dbp-field-row">' +
        '<label class="dbp-field"><span>' + esc(_t('db.field_db', 'Base')) + '</span>' +
          '<input type="text" name="database" maxlength="120" value="' + esc(p.database || '') + '" /></label>' +
        '<label class="dbp-field"><span>' + esc(_t('db.field_prefix', 'Préfixe')) + '</span>' +
          '<input type="text" name="prefix" maxlength="40" value="' + esc(p.prefix || '') + '" placeholder="wp_" /></label>' +
      '</div>' +
      '<div class="dbp-bridge-fields" data-show-when-bridge>' +
        '<label class="dbp-field"><span>' + esc(_t('db.field_url', 'URL du bridge')) + '</span>' +
          '<input type="url" name="bridgeUrl" value="' + esc(p.bridgeUrl || '') +
            '" placeholder="https://example.com/myfb-bridge.php" /></label>' +
        '<label class="dbp-field"><span>' + esc(_t('db.field_secret', 'Secret HMAC')) + '</span>' +
          '<input type="password" name="bridgeSecret" value="' + esc(secretPlain) +
            '" placeholder="' + esc(_t('db.secret_placeholder', 'Hex 64 chars — copié depuis le fichier PHP')) + '" /></label>' +
        '<div class="dbp-test-row">' +
          '<button type="button" class="dbp-btn" data-act="db-test" title="' +
            esc(_t('db.test_tip', 'Tester URL + secret sans enregistrer (appel meta)')) + '">🔌 ' +
            esc(_t('db.test', 'Tester')) + '</button>' +
          '<span class="dbp-test-status" data-test-status></span>' +
        '</div>' +
        '<p class="dbp-hint">' + esc(_t('db.bridge_hint',
          'Dépose myfb-bridge.php à la racine de ton site, génère un secret (openssl rand -hex 32) et colle-le ici. Voir bridge/README.md.')) + '</p>' +
      '</div>' +
      '<label class="dbp-field"><span>' + esc(_t('db.field_schema', 'Schéma (Markdown)')) + '</span>' +
        '<textarea name="schemaMd" rows="8" placeholder="' +
          esc(_t('db.schema_placeholder', 'Colle ici le markdown généré par ton plugin WP, ou laisse vide et clique 🔄 si tu utilises le bridge')) +
          '">' + esc(p.schemaMd || '') + '</textarea></label>' +
      '<label class="dbp-field"><span>' + esc(_t('db.field_notes', 'Notes libres')) + '</span>' +
        '<textarea name="notes" rows="3" placeholder="' +
          esc(_t('db.notes_placeholder', 'Conventions, règles métier, alias…')) +
          '">' + esc(p.notes || '') + '</textarea></label>' +
      '<label class="dbp-field dbp-field--checkbox">' +
        '<input type="checkbox" name="autoInject"' + (p.autoInject ? ' checked' : '') + ' />' +
        '<span>' + esc(_t('db.field_auto', 'Auto-injecter au démarrage d\'un segment')) + '</span></label>' +
      '<div class="dbp-form-actions">' +
        '<button type="submit" class="dbp-btn dbp-btn--primary">' +
          esc(isNew ? _t('db.create', 'Créer') : _t('db.save', 'Enregistrer')) + '</button>' +
        '<button type="button" class="dbp-btn" data-act="db-cancel">' + esc(_t('db.cancel', 'Annuler')) + '</button>' +
      '</div>';

    // Toggle bridge fields visibility based on mode select.
    var modeSelect = form.querySelector('select[name="mode"]');
    var bridgeFields = form.querySelector('[data-show-when-bridge]');
    function syncMode() {
      bridgeFields.style.display = (modeSelect.value === 'bridge') ? 'block' : 'none';
    }
    syncMode();
    modeSelect.addEventListener('change', syncMode);

    holder.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function _closeForm() {
    var holder = document.getElementById('db-profile-form-holder');
    if (holder) { holder.style.display = 'none'; }
    var form = document.getElementById('db-profile-form');
    if (form) form.innerHTML = '';
  }

  async function _handleSubmit(e) {
    e.preventDefault();
    var form = e.target;
    var fd = new FormData(form);
    var id = fd.get('id') || _uuid();
    var existing = _findProfile(id);
    var profile = existing || { id: id, ts: Date.now() };
    profile.label    = String(fd.get('label') || '').trim().slice(0, 60);
    profile.engine   = String(fd.get('engine') || 'mysql');
    profile.mode     = String(fd.get('mode') || 'paste');
    profile.host     = String(fd.get('host') || '').trim().slice(0, 200);
    var port = parseInt(fd.get('port'), 10);
    profile.port     = (port && port > 0 && port < 65536) ? port : null;
    profile.database = String(fd.get('database') || '').trim().slice(0, 120);
    profile.prefix   = String(fd.get('prefix') || '').trim().slice(0, 40);
    profile.bridgeUrl = String(fd.get('bridgeUrl') || '').trim();
    var secretPlain  = String(fd.get('bridgeSecret') || '').trim();
    profile.schemaMd = String(fd.get('schemaMd') || '');
    profile.notes    = String(fd.get('notes') || '');
    profile.autoInject = !!fd.get('autoInject');
    profile.updatedTs  = Date.now();
    if (!profile.label) { toast(_t('db.err_label', 'Libellé obligatoire'), 'error'); return; }
    if (profile.mode === 'bridge' && (!profile.bridgeUrl || !secretPlain)) {
      toast(_t('db.err_bridge_cred', 'URL et secret du bridge obligatoires en mode bridge'), 'error'); return;
    }
    try { await _writeSecret(profile, secretPlain); }
    catch (e) { toast(_t('db.err_crypto', 'Chiffrement du secret KO : ' + (e.message || e)), 'error'); return; }
    if (!existing) {
      STATE.dbProfiles = (STATE.dbProfiles || []).concat([profile]);
    }
    _persist();
    _closeForm();
    _render();
    toast(_t('db.saved', 'Fiche BDD enregistrée'), 'success', 1500);
  }

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------
  async function _refresh(id) {
    var p = _findProfile(id); if (!p) return;
    if (p.mode !== 'bridge') {
      toast(_t('db.refresh_paste_no', 'Cette fiche est en mode collé — édite-la pour mettre à jour le schéma.'), 'info', 3500);
      return;
    }
    toast(_t('db.refresh_start', 'Récupération du schéma…'), 'info', 1500);
    try {
      var secret = await _readSecret(p);
      var md = await window.MyFbDbBridge.fetchSchemaMd({ bridgeUrl: p.bridgeUrl, bridgeSecret: secret });
      p.schemaMd = md;
      p.lastRefreshTs = Date.now();
      p.updatedTs = Date.now();
      _persist();
      _render();
      toast(_t('db.refresh_ok', 'Schéma à jour ({n} car.)', { n: md.length }), 'success', 2200);
    } catch (e) {
      toast(_t('db.refresh_fail', 'Bridge KO : ' + (e.message || e), { err: e.message || e }), 'error', 4000);
    }
  }

  function _paste(id) {
    var p = _findProfile(id); if (!p) return;
    if (!p.schemaMd) {
      toast(_t('db.paste_empty', 'Schéma vide — édite la fiche ou rafraîchis depuis le bridge.'), 'info', 3000);
      return;
    }
    var editor = document.querySelector('.demande-editor');
    if (!editor) { toast(_t('db.paste_no_editor', 'Éditeur introuvable'), 'error'); return; }
    // Append the schema as a fenced markdown block at the end of the editor.
    var sep = (editor.textContent || '').trim() ? '\n\n' : '';
    var block = sep + '```\n' + (p.label ? '# ' + p.label + '\n' : '') + p.schemaMd + '\n```\n';
    editor.appendChild(document.createTextNode(block));
    if (window.MyFbSession && window.MyFbSession.syncCurrentDemandeFromEditor) {
      window.MyFbSession.syncCurrentDemandeFromEditor();
    }
    if (window.MyFbRenderer && window.MyFbRenderer.renderDemandeEditor) {
      window.MyFbRenderer.renderDemandeEditor();
    }
    _persist();
    toast(_t('db.paste_ok', 'Schéma inséré'), 'success', 1500);
  }

  function _delete(id) {
    var p = _findProfile(id); if (!p) return;
    if (!window.confirm(_t('db.confirm_delete', 'Supprimer la fiche « ' + (p.label || '') + ' » ?', { label: p.label }))) return;
    STATE.dbProfiles = (STATE.dbProfiles || []).filter(function (x) { return x.id !== id; });
    _persist();
    _render();
    toast(_t('db.deleted', 'Fiche supprimée'), 'info', 1500);
  }

  // -----------------------------------------------------------------------
  // Event delegation (panel is always in the DOM, just folded)
  // -----------------------------------------------------------------------
  function _bind() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-act]');
      if (!t) return;
      var act = t.dataset.act;
      if (act === 'db-add')     { e.preventDefault(); _openForm(null); }
      else if (act === 'db-edit')   { e.preventDefault(); _openForm(_findProfile(t.dataset.id)); }
      else if (act === 'db-cancel') { e.preventDefault(); _closeForm(); }
      else if (act === 'db-delete') { e.preventDefault(); _delete(t.dataset.id); }
      else if (act === 'db-refresh'){ e.preventDefault(); _refresh(t.dataset.id); }
      else if (act === 'db-paste')  { e.preventDefault(); _paste(t.dataset.id); }
      else if (act === 'db-test')   { e.preventDefault(); _testFromForm(); }
    });
    document.addEventListener('submit', function (e) {
      if (e.target && e.target.id === 'db-profile-form') _handleSubmit(e);
    });
  }

  async function init(state) {
    STATE = state || (window.MyFbRender && window.MyFbRender.ctx && window.MyFbRender.ctx.STATE);
    if (!STATE) return;
    if (!Array.isArray(STATE.dbProfiles)) STATE.dbProfiles = [];
    _bind();
    _render();
    try {
      if (_crypto()) { await _crypto().ready(); await _migrateLegacySecrets(); _render(); }
    } catch (_) {}
  }

  // ── Test bridge from the open form ─────────────────────────────────
  // Reads the live URL+Secret from the form (not from STATE — the user
  // may be entering them for the first time and hasn't saved yet) and
  // pings the `meta` op. Reports inline so the user knows their
  // credentials work BEFORE clicking Save.
  async function _testFromForm() {
    var form = document.getElementById('db-profile-form');
    if (!form) return;
    var fd  = new FormData(form);
    var url = String(fd.get('bridgeUrl') || '').trim();
    var sec = String(fd.get('bridgeSecret') || '').trim();
    var status = form.querySelector('[data-test-status]');
    function show(kind, msg) {
      if (!status) return;
      status.className = 'dbp-test-status dbp-test-status--' + kind;
      status.textContent = msg;
    }
    if (!url || !sec) {
      show('err', _t('db.test_missing', '✗ URL et secret requis'));
      return;
    }
    if (!window.MyFbDbBridge) {
      show('err', _t('db.test_no_client', '✗ Bridge client indisponible'));
      return;
    }
    show('info', _t('db.test_running', '⏳ Test en cours…'));
    try {
      var data = await window.MyFbDbBridge.call({ bridgeUrl: url, bridgeSecret: sec }, 'meta');
      var n = (data && data.tableCount) || 0;
      show('ok', _t('db.test_ok', '✓ Connexion OK — {n} table(s) exposée(s)', { n: n }));
    } catch (e) {
      show('err', _t('db.test_fail', '✗ ' + (e && e.message || 'échec'), { err: e && e.message || 'échec' }));
    }
  }

  window.MyFbDbProfilesUi = {
    init:   init,
    render: _render,
  };
})(window);
