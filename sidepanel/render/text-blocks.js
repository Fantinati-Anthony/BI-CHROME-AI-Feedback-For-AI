/**
 * MyFb Render — Text-block chips
 *
 * Renders bare text nodes inside `.demande-editor` / `.demande-text`
 * as draggable pill chips (`.text-chip`). Clicking a chip makes it
 * inline-editable; blurring reverts to chip appearance and persists
 * the model.
 *
 * Chip → plain text: click
 * Plain text → chip:  blur (or Escape)
 * Reorder:            HTML5 drag-and-drop within the same container
 *
 * Usage:
 *   MyFbRender.textBlocks.attach(textEl, function onSync() { … });
 *
 * Idempotent — safe to call after every render(). Listeners are only
 * installed once per element; the onSync callback is refreshed each time.
 */
(function (window) {
  'use strict';
  window.MyFbRender = window.MyFbRender || {};

  var SLOT_KEY         = '__myfb_tchip_slot__';
  var _globalDragBound = false;
  var _globalClickBound = false;
  var _activeChip      = null;   // chip currently in edit mode
  var _activeOnSync    = null;

  // ── Text-chip factory ──────────────────────────────────────────────────
  function _makeChip(text) {
    var span = document.createElement('span');
    span.className    = 'text-chip';
    span.contentEditable = 'false';
    span.draggable    = true;
    span.dataset.textChip = '1';
    span.textContent  = text;
    return span;
  }

  // ── Wrap bare text-node children in .text-chip ─────────────────────────
  // Only wraps direct children that are non-empty TEXT_NODEs and not
  // already inside a .text-chip (idempotent across re-renders).
  function _wrapTextNodes(textEl) {
    var nodes = Array.from(textEl.childNodes);
    nodes.forEach(function (node) {
      if (node.nodeType !== Node.TEXT_NODE) return;
      if (!node.textContent)               return;
      var chip = _makeChip(node.textContent);
      textEl.insertBefore(chip, node);
      node.remove();
    });
  }

  // ── Global click-outside handler (installed once) ─────────────────────
  // Uses mousedown (fires before focus change) so clicking on the editor
  // background reliably exits the active chip even inside a contenteditable.
  function _ensureGlobalClickOut() {
    if (_globalClickBound) return;
    _globalClickBound = true;
    document.addEventListener('mousedown', function (e) {
      if (!_activeChip) return;
      if (_activeChip.contains(e.target)) return; // click inside chip — ok
      _exitEdit(_activeChip, _activeOnSync);
    }, true); // capture phase so it fires before the editor's own click handler
  }

  // ── Edit mode helpers ──────────────────────────────────────────────────
  function _enterEdit(chip, onSync) {
    _ensureGlobalClickOut();
    // Exit any other chip that may be open
    if (_activeChip && _activeChip !== chip) _exitEdit(_activeChip, _activeOnSync);
    _activeChip   = chip;
    _activeOnSync = onSync;
    chip.contentEditable = 'true';
    chip.draggable       = false;
    chip.classList.add('text-chip--editing');
    chip.focus();
    // Place cursor at end
    var range = document.createRange();
    range.selectNodeContents(chip);
    range.collapse(false);
    var sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  }

  function _getEditedText(chip) {
    // Convert inner markup to plain text, preserving Enter → newline
    var html = chip.innerHTML;
    html = html.replace(/<br\s*\/?>/gi, '\n');
    html = html.replace(/<div[^>]*>/gi, '\n');
    html = html.replace(/<\/div>/gi, '');
    html = html.replace(/<[^>]+>/g, '');
    // Decode HTML entities via a temporary element
    var tmp = document.createElement('textarea');
    tmp.innerHTML = html;
    return tmp.value;
  }

  function _exitEdit(chip, onSync) {
    if (_activeChip === chip) { _activeChip = null; _activeOnSync = null; }
    var text = _getEditedText(chip);
    chip.contentEditable = 'false';
    chip.draggable       = true;
    chip.classList.remove('text-chip--editing');
    if (!text.trim()) {
      chip.remove();
    } else {
      chip.textContent = text;
    }
    if (typeof onSync === 'function') onSync();
  }

  // ── Global drag listeners (installed once) ─────────────────────────────
  function _ensureGlobalDrag() {
    if (_globalDragBound) return;
    _globalDragBound = true;

    var ctx = function () { return window.MyFbRender.ctx; };

    document.addEventListener('dragover', function (e) {
      var c = ctx();
      if (!c || !c.DRAG.textChip) return;
      var ed = e.target.closest && e.target.closest('.demande-editor, .demande-text');
      if (!ed || ed !== c.DRAG.textSourceContainer) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    document.addEventListener('drop', function (e) {
      var c = ctx();
      if (!c || !c.DRAG.textChip) return;
      var ed = e.target.closest && e.target.closest('.demande-editor, .demande-text');
      if (!ed || ed !== c.DRAG.textSourceContainer) return;
      e.preventDefault();

      var chip = c.DRAG.textChip;
      chip.classList.remove('is-dragging');
      c.DRAG.textChip = null;
      c.DRAG.textSourceContainer = null;

      // Find caret insertion point
      var range = null;
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(e.clientX, e.clientY);
      } else if (document.caretPositionFromPoint) {
        var pos = document.caretPositionFromPoint(e.clientX, e.clientY);
        if (pos) {
          range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.collapse(true);
        }
      }

      chip.remove();
      if (!range || !ed.contains(range.startContainer)) {
        ed.appendChild(chip);
      } else {
        range.insertNode(chip);
      }

      var slot = ed[SLOT_KEY];
      if (slot && typeof slot.onSync === 'function') slot.onSync();
    });

    document.addEventListener('dragend', function () {
      var c = ctx();
      if (!c || !c.DRAG.textChip) return;
      c.DRAG.textChip.classList.remove('is-dragging');
      c.DRAG.textChip = null;
      c.DRAG.textSourceContainer = null;
    });
  }

  // ── Public attach ──────────────────────────────────────────────────────
  function attach(textEl, onSync) {
    if (!textEl) return;
    _ensureGlobalDrag();

    // Always re-wrap after each render (new text nodes need chips)
    _wrapTextNodes(textEl);

    // Idempotent: refresh callback, skip re-installing listeners
    if (textEl[SLOT_KEY]) {
      textEl[SLOT_KEY].onSync = onSync;
      return;
    }

    var slot = { onSync: onSync };
    textEl[SLOT_KEY] = slot;

    // Click → enter edit mode
    textEl.addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('.text-chip');
      if (!chip || !textEl.contains(chip)) return;
      if (chip.contentEditable === 'true') return;
      e.stopPropagation();
      _enterEdit(chip, slot.onSync);
    });

    // Escape → exit edit mode
    textEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var chip = e.target.closest && e.target.closest('.text-chip');
      if (!chip || chip.contentEditable !== 'true') return;
      e.preventDefault();
      e.stopPropagation();
      _exitEdit(chip, slot.onSync);
    });

    // Drag start
    textEl.addEventListener('dragstart', function (e) {
      var chip = e.target.closest && e.target.closest('.text-chip');
      if (!chip || !textEl.contains(chip)) return;
      var c = window.MyFbRender.ctx;
      if (c) { c.DRAG.textChip = chip; c.DRAG.textSourceContainer = textEl; }
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', '__myfb_text_chip__'); } catch (_) {}
      chip.classList.add('is-dragging');
    });
  }

  window.MyFbRender.textBlocks = { attach: attach };
})(window);
