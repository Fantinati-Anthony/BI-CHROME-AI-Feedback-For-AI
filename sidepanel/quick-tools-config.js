/**
 * My-Feedbacks Quick-Tools Config (v2.2)
 *
 * Manages visibility of each .tool-btn inside .quick-tools-row :
 *   - 7 tools : mic / picker / capture / files / errors / templates / video
 *   - Per-tool visibility persisted in chrome.storage.local under
 *     `myfb:quick-tools:visible` = { [toolKey]: boolean }
 *   - Defaults : everything ON except video (opt-in feature)
 *   - Rendered in Settings → "Outils rapides" : 7 checkboxes
 *
 * Each .tool-btn gets a data-tool-key attribute (injected at first
 * paint) so the visibility rules can target them via CSS attribute
 * selectors without touching the legacy markup.
 */

(function (window) {
  'use strict';

  var STORAGE_KEY = 'myfb:quick-tools:visible';

  /**
   * Ordered catalog of tools. Order matches the rendered row.
   * `selector` overrides `act` when the toggle target is identified by
   * a different attribute (e.g. video lives inside the capture subline
   * with `data-act="video"`, not in the top quick-tools row).
   */
  var TOOLS = Object.freeze([
    { key: 'mic',       act: 'mic',             defaultOn: true,  i18nKey: 'tools.mic',       fallback: 'Micro' },
    { key: 'picker',    act: 'picker',          defaultOn: true,  i18nKey: 'tools.picker',    fallback: 'Sélecteur' },
    { key: 'capture',   act: 'capture-toggle',  defaultOn: true,  i18nKey: 'tools.capture',   fallback: 'Capture' },
    { key: 'files',     act: 'open-files',      defaultOn: true,  i18nKey: 'tools.file',      fallback: 'Fichier' },
    { key: 'errors',    act: 'open-errors',     defaultOn: true,  i18nKey: 'tools.errors',    fallback: 'Erreurs' },
    { key: 'templates', act: 'open-templates',  defaultOn: true,  i18nKey: 'tools.templates', fallback: 'Modèles' },
    { key: 'video',     act: 'video',           defaultOn: false, i18nKey: 'capture.video',   fallback: 'Vidéo', selector: '.subline-btn--video' },
  ]);

  function _t(k, fb) {
    return (window.MyFb && window.MyFb.utils && window.MyFb.utils.t)
      ? window.MyFb.utils.t(k, fb) : (fb || k);
  }

  function init() {
    _stampToolKeys();
    document.addEventListener('change', _onChange, true);
    // Load + apply visibility, then render the Settings checkboxes.
    _load().then(function (cfg) {
      _apply(cfg);
      _renderSettings(cfg);
    });
  }

  function _stampToolKeys() {
    TOOLS.forEach(function (tool) {
      var sel = tool.selector || '[data-act="' + tool.act + '"]';
      var btn = document.querySelector(sel);
      if (btn && !btn.getAttribute('data-tool-key')) {
        btn.setAttribute('data-tool-key', tool.key);
      }
    });
  }

  function _load() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([STORAGE_KEY], function (o) {
          var saved = (o && o[STORAGE_KEY]) || {};
          var cfg = {};
          TOOLS.forEach(function (tool) {
            cfg[tool.key] = (typeof saved[tool.key] === 'boolean') ? saved[tool.key] : tool.defaultOn;
          });
          resolve(cfg);
        });
      } catch (_) {
        var fb = {};
        TOOLS.forEach(function (tool) { fb[tool.key] = tool.defaultOn; });
        resolve(fb);
      }
    });
  }

  function _save(cfg) {
    var obj = {}; obj[STORAGE_KEY] = cfg;
    try { chrome.storage.local.set(obj); } catch (_) {}
  }

  function _apply(cfg) {
    TOOLS.forEach(function (tool) {
      var btn = document.querySelector('[data-tool-key="' + tool.key + '"]');
      if (!btn) return;
      var on = !!cfg[tool.key];
      btn.classList.toggle('is-hidden', !on);
      // also set hidden attribute for screen readers / accessibility
      if (on) btn.removeAttribute('hidden');
      else    btn.setAttribute('hidden', '');
    });
  }

  function _renderSettings(cfg) {
    var host = document.querySelector('[data-myfb-quick-tools-config]');
    if (!host) return;
    host.innerHTML =
      '<p class="sp-section-desc">' +
        _t('settings.qt.desc', 'Activez ou désactivez chaque bouton de la barre d\'outils rapides.') +
      '</p>' +
      '<div class="myfb-qt-list">' +
      TOOLS.map(function (tool) {
        var on = !!cfg[tool.key];
        return '<label class="myfb-qt-row">' +
          '<input type="checkbox" data-qt-key="' + tool.key + '"' + (on ? ' checked' : '') + ' />' +
          '<span class="myfb-qt-label">' + _t(tool.i18nKey, tool.fallback) + '</span>' +
          '<code class="myfb-qt-key">' + tool.key + '</code>' +
        '</label>';
      }).join('') +
      '</div>';
  }

  function _onChange(e) {
    var inp = e.target;
    if (!inp || !inp.getAttribute) return;
    var k = inp.getAttribute('data-qt-key');
    if (!k) return;
    _load().then(function (cfg) {
      cfg[k] = !!inp.checked;
      _save(cfg);
      _apply(cfg);
    });
  }

  window.MyFbQuickToolsConfig = {
    init:    init,
    TOOLS:   TOOLS,
    _load:   _load,
    _apply:  _apply,
  };
})(window);
