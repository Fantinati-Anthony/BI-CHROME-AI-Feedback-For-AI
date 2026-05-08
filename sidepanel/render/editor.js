/**
 * BIAIF Render — Demande editor
 *
 * Rendering for the live "currentDemande" editor (the contenteditable above
 * the segments list) and its references strip (the small chip preview row).
 */
(function (window) {
  'use strict';
  window.BIAIFRender = window.BIAIFRender || {};
  var ctx   = window.BIAIFRender.ctx;
  var UTILS = (window.BIAIF && window.BIAIF.utils) || {};
  function _t(k, fb, vars) { return UTILS.t ? UTILS.t(k, fb, vars) : (fb || k); }

  function render() {
    var ed = ctx.REFS.demandeEditor;
    if (!ed) return;
    ed.innerHTML = '';
    var text = ctx.STATE.currentDemande.text, refs = ctx.STATE.currentDemande.refs;
    if (!text) { renderRefsStrip(); _attachTextBlocks(ed); return; }
    var re = /\{\{ref:(\d+)\}\}/g, last = 0, m;
    var Chips = window.BIAIFRender.chips;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) ed.appendChild(document.createTextNode(text.slice(last, m.index)));
      var ref = refs[Number(m[1])];
      if (ref) ed.appendChild(Chips.make(Number(m[1]), ref, { demKey: 'current' }));
      last = m.index + m[0].length;
    }
    if (last < text.length) ed.appendChild(document.createTextNode(text.slice(last)));
    renderRefsStrip();
    _attachTextBlocks(ed);
  }

  // Wire the margin-drag-handle reorder helper on the live demande editor.
  // Idempotent — safe to call after every render().
  function _attachTextBlocks(ed) {
    var TB = window.BIAIFRender.textBlocks;
    if (!TB) return;
    TB.attach(ed, function () {
      if (window.BIAIFSession) window.BIAIFSession.syncCurrentDemandeFromEditor();
      renderRefsStrip();
      if (window.BIAIFStorage) window.BIAIFStorage.persist(ctx.STATE);
    });
  }

  function renderRefsStrip() {
    if (ctx.REFS.demandeRefsCount) {
      var n = ctx.STATE.currentDemande.refs.length;
      ctx.REFS.demandeRefsCount.textContent = _t(
        n > 1 ? 'segments.ref_plural' : 'segments.ref_singular',
        n + ' réf' + (n > 1 ? 's' : ''),
        { n: n },
      );
    }
    var strip = ctx.REFS.demandeRefsStrip;
    if (!strip) return;
    strip.innerHTML = '';
    ctx.STATE.currentDemande.refs.forEach(function (ref, i) {
      var mini = document.createElement('div');
      mini.className = 'ref-mini ref-mini--' + (ref.type || 'element');
      var num = document.createElement('span');
      num.className = 'ref-mini-num'; num.textContent = '#' + (i + 1);
      mini.appendChild(num);
      if (ref.type === 'screenshot' && ref.dataUrl) {
        var img = document.createElement('img');
        img.className = 'ref-mini-thumb';
        img.src = ref.dataUrl; img.alt = 'capture #' + (i + 1);
        mini.appendChild(img);
      }
      var lbl = document.createElement('span');
      lbl.className = 'ref-mini-label';
      lbl.textContent = ref.type === 'screenshot' ? (ref.mode || 'capture') : (ref.selector || ref.tag || '?');
      mini.appendChild(lbl);
      strip.appendChild(mini);
    });
  }

  function appendChip(absIdx, ref) {
    var ed = ctx.REFS.demandeEditor;
    if (!ed) return;
    var Chips = window.BIAIFRender.chips;
    var last = ed.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE && !/\s$/.test(last.textContent))
      last.textContent += ' ';
    else if (last && last.nodeType === Node.ELEMENT_NODE)
      ed.appendChild(document.createTextNode(' '));
    ed.appendChild(Chips.make(absIdx, ref, { demKey: 'current' }));
    ed.appendChild(document.createTextNode(' '));
    if (window.BIAIFSession) window.BIAIFSession.syncCurrentDemandeFromEditor();
    renderRefsStrip();
    if (window.BIAIFStorage) window.BIAIFStorage.persist(ctx.STATE);
  }

  window.BIAIFRender.editor = {
    render:         render,
    renderRefsStrip: renderRefsStrip,
    appendChip:     appendChip,
  };
})(window);
