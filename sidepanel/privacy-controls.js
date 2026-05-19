/**
 * My-Feedbacks Privacy Controls UI (v2.0)
 *
 * Wires two toggles + one informational counter into Settings →
 * "Vos données" :
 *
 *   1. Telemetry opt-in — controls MyFb.core.telemetry.setEnabled().
 *      When enabled, counters accumulate locally; users see their own
 *      activity right below the toggle.
 *
 *   2. E2E encryption opt-in — controls a flag in chrome.storage.local
 *      ('myfb:e2e:enabled', default false). When ON, future events
 *      will be encrypted before push (wiring lives in transports/
 *      sync-engine extensions — out of scope here).
 *
 *   3. Reload extension button — small DX helper. Calls
 *      chrome.runtime.reload() (which restarts the service worker +
 *      side panel). Skipped on environments without that API.
 */

(function (window) {
  'use strict';

  var E2E_KEY       = 'myfb:e2e:enabled';
  var t = function (k, fb) {
    return (window.MyFb && window.MyFb.utils && window.MyFb.utils.t)
      ? window.MyFb.utils.t(k, fb) : (fb || k);
  };

  function _toast(m, k, d) {
    if (window.MyFbToast && window.MyFbToast.show) window.MyFbToast.show(m, k || 'info', d || 2200);
  }

  function init() {
    document.addEventListener('change', _onChange, true);
    document.addEventListener('click',  _onClick,  true);
    _render();
  }

  function _render() {
    var host = document.querySelector('[data-myfb-privacy-controls]');
    if (!host) return;
    var T = window.MyFb && window.MyFb.core && window.MyFb.core.telemetry;
    Promise.all([
      T ? T.isEnabled().catch(function () { return false; }) : Promise.resolve(false),
      T ? T.getCounters().catch(function () { return {}; }) : Promise.resolve({}),
      _readBoolean(E2E_KEY),
    ]).then(function (out) {
      var telemEnabled = !!out[0];
      var counters     = out[1] || {};
      var e2eEnabled   = !!out[2];
      var totalCount = Object.keys(counters).reduce(function (s, k) { return s + (counters[k] || 0); }, 0);

      host.innerHTML =
        '<div class="myfb-priv-toggle">' +
          '<label class="myfb-priv-toggle-row">' +
            '<input type="checkbox" data-myfb-priv="telemetry"' + (telemEnabled ? ' checked' : '') + ' />' +
            '<span class="myfb-priv-toggle-text">' +
              '<span class="myfb-priv-toggle-label">' + t('priv.telemetry.label', 'Partager des statistiques anonymes') + '</span>' +
              '<span class="myfb-priv-toggle-detail">' + t('priv.telemetry.detail', 'Compteurs locaux uniquement (jamais envoyés en v2.0). Aide à prioriser les futures features.') + '</span>' +
            '</span>' +
          '</label>' +
          (telemEnabled
            ? '<div class="myfb-priv-stats">' +
                '<span>' + t('priv.telemetry.total', 'Total local') + ' : <strong>' + totalCount + '</strong></span>' +
                (totalCount > 0 ? '<button type="button" class="myfb-priv-mini-btn" data-myfb-priv-act="reset-telem">' + t('priv.telemetry.reset', 'Réinitialiser') + '</button>' : '') +
              '</div>'
            : '') +
        '</div>' +

        '<div class="myfb-priv-toggle">' +
          '<label class="myfb-priv-toggle-row">' +
            '<input type="checkbox" data-myfb-priv="e2e"' + (e2eEnabled ? ' checked' : '') + ' />' +
            '<span class="myfb-priv-toggle-text">' +
              '<span class="myfb-priv-toggle-label">' + t('priv.e2e.label', '🔒 Chiffrement E2E avec mes partenaires') + '</span>' +
              '<span class="myfb-priv-toggle-detail">' + t('priv.e2e.detail', 'Les events synchronisés via shared-folder seront chiffrés avec une clé dérivée ECDH. Même My-Feedbacks Cloud (v3.0+) ne pourra rien lire.') + '</span>' +
            '</span>' +
          '</label>' +
        '</div>' +

        '<div class="myfb-priv-actions">' +
          '<button type="button" class="sp-action-btn" data-myfb-priv-act="reload-ext">' +
            t('priv.reload_ext', '🔄 Recharger l\'extension') +
          '</button>' +
        '</div>';
    });
  }

  function _onChange(e) {
    var inp = e.target;
    if (!inp || !inp.getAttribute) return;
    var key = inp.getAttribute('data-myfb-priv');
    if (!key) return;

    if (key === 'telemetry') {
      var T = window.MyFb && window.MyFb.core && window.MyFb.core.telemetry;
      if (!T) return;
      T.setEnabled(inp.checked).then(function () {
        _toast(inp.checked ? t('priv.telemetry.on', 'Statistiques anonymes activées.') : t('priv.telemetry.off', 'Statistiques désactivées.'), 'info');
        _render();
      });
    } else if (key === 'e2e') {
      var obj = {}; obj[E2E_KEY] = !!inp.checked;
      try { chrome.storage.local.set(obj, function () {
        _toast(inp.checked ? t('priv.e2e.on', 'Chiffrement E2E activé pour les futurs events.') : t('priv.e2e.off', 'Chiffrement E2E désactivé.'), 'info');
        _render();
      }); } catch (_) {}
    }
  }

  function _onClick(e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-myfb-priv-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-myfb-priv-act');
    if (act === 'reset-telem') {
      var T = window.MyFb && window.MyFb.core && window.MyFb.core.telemetry;
      if (!T) return;
      if (!confirm(t('priv.telemetry.reset_confirm', 'Réinitialiser tous les compteurs locaux ?'))) return;
      T.resetCounters().then(function () {
        _toast(t('priv.telemetry.reset_ok', 'Compteurs remis à zéro.'), 'success');
        _render();
      });
    } else if (act === 'reload-ext') {
      try {
        if (chrome.runtime && chrome.runtime.reload) {
          _toast(t('priv.reload_ext_ok', 'Rechargement…'), 'info', 1200);
          setTimeout(function () { chrome.runtime.reload(); }, 600);
        } else {
          _toast(t('priv.reload_ext_unsupported', 'API non disponible.'), 'error');
        }
      } catch (_) {}
    }
  }

  function _readBoolean(key) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([key], function (o) { resolve(!!o[key]); });
      } catch (_) { resolve(false); }
    });
  }

  window.MyFbPrivacyControls = {
    init:   init,
    render: _render,
    E2E_KEY: E2E_KEY,
  };
})(window);
