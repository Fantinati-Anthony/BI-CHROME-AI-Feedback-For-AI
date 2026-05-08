/**
 * BIAIF Render — Chips
 *
 * Reference chips (element / screenshot / error) shown inline in the
 * demande editor and in segment cards. Owns:
 *   - the chip factory (makeChipElement)
 *   - text-with-chips renderer (renderTextWithChips)
 *   - intra-editor chip drag-drop (bindDragEvents)
 *
 * Dragging chips between editors is intentionally NOT allowed — only
 * within the same `.demande-editor` or `.demande-text` container.
 */
(function (window) {
  'use strict';
  window.BIAIFRender = window.BIAIFRender || {};
  var ctx   = window.BIAIFRender.ctx;
  var DOM   = (window.BIAIF && window.BIAIF.dom)   || {};
  var UTILS = (window.BIAIF && window.BIAIF.utils) || {};
  var esc   = DOM.esc || function (s) { return String(s == null ? '' : s); };
  function _t(k, fb, vars) { return UTILS.t ? UTILS.t(k, fb, vars) : (fb || k); }

  function makeChipElement(absIdx, ref, opts) {
    opts = opts || {};
    var span = document.createElement('span');
    span.className = 'ref-chip ref-chip--' + (ref && ref.type || 'element');
    if (opts.readOnly) span.classList.add('ref-chip-readonly');
    span.contentEditable = 'false';
    span.dataset.ref = String(absIdx);
    if (opts.demKey !== undefined) span.dataset.demKey = String(opts.demKey);

    var isShot = ref && ref.type === 'screenshot';
    var isErr  = ref && ref.type === 'error';
    if (isErr) span.classList.add('ref-chip--error');

    var ICONS = window.BIAIFRender.icons;
    var icon  = isShot ? ICONS.image() : isErr ? ICONS.alert() : ICONS.arrow();

    var labelKind = isShot ? 'capture' : isErr ? 'erreur' : 'élément';
    var num       = opts.displayNum || (absIdx + 1);

    var domainBadge = '';
    if (ref && ref.tabUrl) {
      var dHost = DOM.hostname ? DOM.hostname(ref.tabUrl) : '';
      if (dHost) domainBadge = '<span class="ref-chip-domain" title="' + esc(ref.tabUrl) + '">@' + esc(dHost) + '</span>';
    }
    var header = document.createElement('span');
    header.className = 'ref-chip-header';
    header.innerHTML = icon + '<span class="ref-chip-label">' + labelKind + ' #' + num + '</span>' + domainBadge + '<span class="ref-chip-toggle" aria-hidden="true">▾</span>';

    var details = document.createElement('span');
    details.className = 'ref-details';

    if (isShot) {
      if (ref.dataUrl) {
        var img = document.createElement('img');
        img.className = 'ref-details-img'; img.src = ref.dataUrl; img.alt = 'capture #' + num;
        details.appendChild(img);
      }
      var meta = document.createElement('span');
      meta.className = 'ref-details-meta';
      meta.textContent = 'Mode : ' + (ref.mode || 'visible');
      details.appendChild(meta);
      var btn = document.createElement('button');
      btn.className = 'ref-details-btn'; btn.type = 'button'; btn.dataset.editType = 'screenshot';
      btn.textContent = '✏ Re-annoter';
      details.appendChild(btn);
    } else if (isErr) {
      var lines = [];
      if (ref.msg)  lines.push('<span class="t-key">message</span> ' + esc(ref.msg));
      if (ref.file) lines.push('<span class="t-key">fichier</span> ' + esc(ref.file) + ':' + (ref.line || '?') + (ref.col ? ':' + ref.col : ''));
      if (ref.url)  lines.push('<span class="t-key">page</span> ' + esc(ref.url));
      var m2 = document.createElement('span'); m2.className = 'ref-details-meta'; m2.innerHTML = lines.join('<br>');
      details.appendChild(m2);
      if (ref.stack) {
        var s2 = document.createElement('span'); s2.className = 'ref-details-selector';
        s2.innerHTML = '<code>' + esc(ref.stack.slice(0, 800)) + (ref.stack.length > 800 ? '\n…(tronqué)' : '') + '</code>';
        details.appendChild(s2);
      }
    } else {
      var eLines = [];
      if (ref && ref.tag)            eLines.push('<span class="t-key">tag</span> &lt;' + esc(ref.tag) + '&gt;');
      if (ref && ref.id)             eLines.push('<span class="t-key">id</span> #' + esc(ref.id));
      if (ref && ref.classes && ref.classes.length) eLines.push('<span class="t-key">classes</span> ' + esc(ref.classes.join(' ')));
      if (ref && ref.text)           eLines.push('<span class="t-key">texte</span> « ' + esc(ref.text.slice(0, 120)) + (ref.text.length > 120 ? '…' : '') + ' »');
      var em = document.createElement('span'); em.className = 'ref-details-meta';
      em.innerHTML = eLines.join('<br>') || '<em>Pas de détails</em>';
      details.appendChild(em);
      if (ref && ref.selector) {
        var sel = document.createElement('span'); sel.className = 'ref-details-selector';
        sel.innerHTML = '<code>' + esc(ref.selector) + '</code>';
        details.appendChild(sel);
      }
      var ebtn = document.createElement('button');
      ebtn.className = 'ref-details-btn'; ebtn.type = 'button'; ebtn.dataset.editType = 'element';
      ebtn.textContent = '⌖ Re-piquer';
      details.appendChild(ebtn);
    }

    span.appendChild(header);
    span.appendChild(details);

    span.draggable = true;
    span.addEventListener('dragstart', function (e) {
      if (span.classList.contains('expanded')) { e.preventDefault(); return; }
      ctx.DRAG.chip = span;
      ctx.DRAG.sourceContainer = span.closest('.demande-editor, .demande-text');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', '__biaif_chip__'); } catch (_) {}
      span.classList.add('is-dragging');
    });
    span.addEventListener('dragend', function () {
      span.classList.remove('is-dragging');
      ctx.DRAG.chip = null; ctx.DRAG.sourceContainer = null;
    });

    return span;
  }

  function renderTextWithChips(text, refs, root, opts) {
    root.innerHTML = '';
    var re = /\{\{ref:(\d+)\}\}/g, last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) root.appendChild(document.createTextNode(text.slice(last, m.index)));
      var ref = refs[Number(m[1])];
      if (ref) root.appendChild(makeChipElement(Number(m[1]), ref, {
        readOnly: true, displayNum: Number(m[1]) + 1, demKey: opts && opts.demKey,
      }));
      last = m.index + m[0].length;
    }
    if (last < text.length) root.appendChild(document.createTextNode(text.slice(last)));
  }

  function bindDragEvents() {
    document.addEventListener('dragover', function (e) {
      if (!ctx.DRAG.chip) return;
      var ed = e.target.closest && e.target.closest('.demande-editor, .demande-text');
      if (!ed || ed !== ctx.DRAG.sourceContainer) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    });
    document.addEventListener('drop', function (e) {
      if (!ctx.DRAG.chip) return;
      var ed = e.target.closest && e.target.closest('.demande-editor, .demande-text');
      if (!ed || ed !== ctx.DRAG.sourceContainer) return;
      e.preventDefault();
      var range = null;
      if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(e.clientX, e.clientY);
      else if (document.caretPositionFromPoint) {
        var pos = document.caretPositionFromPoint(e.clientX, e.clientY);
        if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); range.collapse(true); }
      }
      if (!range || !ed.contains(range.startContainer)) ed.appendChild(ctx.DRAG.chip);
      else { ctx.DRAG.chip.remove(); range.insertNode(ctx.DRAG.chip); }
      if (ed === ctx.REFS.demandeEditor) {
        if (window.BIAIFSession) window.BIAIFSession.syncCurrentDemandeFromEditor();
        if (window.BIAIFRender.editor) window.BIAIFRender.editor.renderRefsStrip();
      } else {
        var idx = Number(ed.dataset.i), dem = ctx.STATE.demandes[idx];
        if (dem && window.BIAIFSession) window.BIAIFSession.syncDemandeFromTextEl(ed, dem);
      }
      if (window.BIAIFStorage) window.BIAIFStorage.persist(ctx.STATE);
      ctx.DRAG.chip.classList.remove('is-dragging');
      ctx.DRAG.chip = null; ctx.DRAG.sourceContainer = null;
    });
    // Chip toggle expand
    document.addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('.ref-chip');
      if (chip) {
        if (e.target.closest('.ref-details-btn') || e.target.closest('.ref-details')) return;
        e.stopPropagation();
        var wasExpanded = chip.classList.contains('expanded');
        document.querySelectorAll('.ref-chip.expanded').forEach(function (c) {
          c.classList.remove('expanded'); c.draggable = true;
        });
        if (!wasExpanded) { chip.classList.add('expanded'); chip.draggable = false; }
        return;
      }
      document.querySelectorAll('.ref-chip.expanded').forEach(function (c) {
        c.classList.remove('expanded'); c.draggable = true;
      });
    });
  }

  window.BIAIFRender.chips = {
    make:                makeChipElement,
    renderTextWithChips: renderTextWithChips,
    bindDragEvents:      bindDragEvents,
  };
})(window);
