/**
 * BIAIF Bindings — Templates popover.
 *
 * Extracted from bindings/events.js to keep that file focused on
 * session/topbar/editor wiring. This module owns:
 *   - the templates list (clickable + delete per item)
 *   - the "Save current as template" action
 *   - the open/close popover toggle
 *
 * Public entry point: BIAIFBindings.bindTemplatesPopover(autoArm).
 * Called by events.js → bind() during init.
 */
(function (window) {
  'use strict';
  window.BIAIFBindings = window.BIAIFBindings || {};
  var ctx = window.BIAIFBindings.ctx;
  var H   = window.BIAIFBindings.helpers;

  function _t(k, fb, vars) {
    var U = window.BIAIF && window.BIAIF.utils;
    return (U && U.t) ? U.t(k, fb, vars) : (fb || k);
  }

  /** @param {() => void} autoArm */
  function bindTemplatesPopover(autoArm) {
    var STATE   = ctx.STATE;
    var btn     = document.querySelector('[data-act="open-templates"]');
    var popover = document.getElementById('templates-popover');
    var list    = popover && popover.querySelector('.templates-list');
    var saveBtn = popover && popover.querySelector('[data-act="template-save-current"]');
    if (!btn || !popover || !list) return;

    function renderList() {
      list.innerHTML = '';
      var items = (window.BIAIFTemplates && window.BIAIFTemplates.list()) || [];
      items.forEach(function (t) {
        var li = document.createElement('li');
        li.className = 'template-item';
        li.dataset.id = t.id;
        var name = document.createElement('span');
        name.className = 'template-item-name'; name.textContent = t.name;
        var prev = document.createElement('span');
        prev.className = 'template-item-preview';
        prev.textContent = t.body.replace(/\s+/g, ' ').slice(0, 60);
        prev.title = t.body;
        var del = document.createElement('button');
        del.className = 'template-item-del'; del.textContent = '×';
        del.setAttribute('aria-label', _t('templates.delete', 'Supprimer ce modèle'));
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          window.BIAIFTemplates.remove(t.id);
          renderList();
        });
        li.appendChild(name); li.appendChild(prev); li.appendChild(del);
        li.addEventListener('click', function () {
          if (typeof autoArm === 'function') autoArm();
          window.BIAIFTemplates.insertIntoEditor(t.id);
          close();
          window.BIAIFToast.show(_t('toast.template_inserted', 'Modèle inséré.'), 'success', 1800);
        });
        list.appendChild(li);
      });
    }

    function open() {
      if (typeof autoArm === 'function') autoArm();
      if (H && H.closeCaptureSubline) H.closeCaptureSubline();
      renderList();
      popover.removeAttribute('hidden');
      btn.setAttribute('aria-expanded', 'true');
    }
    function close() {
      popover.setAttribute('hidden', '');
      btn.setAttribute('aria-expanded', 'false');
    }
    function toggle() { popover.hasAttribute('hidden') ? open() : close(); }

    btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    if (saveBtn) saveBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var entry = window.BIAIFTemplates && window.BIAIFTemplates.saveCurrentAsTemplate();
      if (!entry) {
        window.BIAIFToast.show(_t('toast.template_empty', 'Rien à enregistrer — saisissez du texte.'), 'info');
        return;
      }
      renderList();
      window.BIAIFToast.show(_t('toast.template_saved', 'Modèle enregistré.'), 'success');
    });
    document.addEventListener('click', function (e) {
      if (popover.hasAttribute('hidden')) return;
      if (e.target.closest && (e.target.closest('#templates-popover') || e.target.closest('[data-act="open-templates"]'))) return;
      close();
    });
  }

  window.BIAIFBindings.bindTemplatesPopover = bindTemplatesPopover;
})(window);
