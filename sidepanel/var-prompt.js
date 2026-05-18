/**
 * MyFbVarPrompt — modal form for {{var:name}} template variables.
 *
 * Replaces the native window.prompt() calls in templates.js.
 * Collects all {{var:name?default}} patterns from a template body,
 * shows a single modal form with one field per unique variable,
 * then calls onConfirm(values) with the filled-in map.
 *
 * Public API:
 *   MyFbVarPrompt.collect(body)         → [{name, def}]
 *   MyFbVarPrompt.prompt(vars, onConfirm, onCancel)
 */
(function (window) {
  'use strict';

  var VAR_RE = /\{\{\s*var:([\w-]+)(?:\?([^}]*))?\s*\}\}/g;

  function collect(body) {
    if (typeof body !== 'string' || !body.includes('{{')) return [];
    var vars = [], seen = Object.create(null);
    var m, re = new RegExp(VAR_RE.source, 'g');
    while ((m = re.exec(body)) !== null) {
      var name = m[1], def = m[2] || '';
      if (!seen[name]) { seen[name] = true; vars.push({ name: name, def: def }); }
    }
    return vars;
  }

  function prompt(vars, onConfirm, onCancel) {
    if (!vars || !vars.length) { onConfirm({}); return; }

    var overlay = document.createElement('div');
    overlay.className = 'bvp-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    var panel = document.createElement('div');
    panel.className = 'bvp-panel';

    /* Header */
    var header = document.createElement('div');
    header.className = 'bvp-header';
    header.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
      '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
      '<span class="bvp-title">Variables du modèle</span>';

    /* Fields */
    var form = document.createElement('div');
    form.className = 'bvp-form';
    var inputs = {};
    vars.forEach(function (v, i) {
      var field = document.createElement('div');
      field.className = 'bvp-field';
      var lbl = document.createElement('label');
      lbl.className = 'bvp-label';
      lbl.textContent = v.name.replace(/[-_]/g, ' ');
      lbl.setAttribute('for', 'bvp-' + v.name);
      var inp = document.createElement('input');
      inp.className = 'bvp-input';
      inp.id = 'bvp-' + v.name;
      inp.type = 'text';
      inp.value = v.def;
      inp.placeholder = v.def || v.name;
      inp.setAttribute('autocomplete', 'off');
      // Tab + Enter navigation
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); _confirm(); }
        if (e.key === 'Escape') { e.preventDefault(); _cancel(); }
      });
      inputs[v.name] = inp;
      field.appendChild(lbl);
      field.appendChild(inp);
      form.appendChild(field);
      if (i === 0) setTimeout(function () { inp.focus(); inp.select(); }, 30);
    });

    /* Footer */
    var footer = document.createElement('div');
    footer.className = 'bvp-footer';
    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'bvp-btn';
    cancelBtn.textContent = 'Annuler';
    var confirmBtn = document.createElement('button');
    confirmBtn.type = 'button'; confirmBtn.className = 'bvp-btn bvp-btn--primary';
    confirmBtn.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><polyline points="4 13 9 19 20 5"/></svg>' +
      ' Insérer le modèle';
    cancelBtn.addEventListener('click', _cancel);
    confirmBtn.addEventListener('click', _confirm);
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    panel.appendChild(header);
    panel.appendChild(form);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) _cancel(); });
    document.body.appendChild(overlay);

    function _values() {
      var v = {};
      vars.forEach(function (vv) { v[vv.name] = inputs[vv.name].value; });
      return v;
    }
    function _confirm() { _close(); onConfirm(_values()); }
    function _cancel()  { _close(); if (onCancel) onCancel(); }
    function _close()   { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
  }

  window.MyFbVarPrompt = { collect: collect, prompt: prompt };
})(window);
