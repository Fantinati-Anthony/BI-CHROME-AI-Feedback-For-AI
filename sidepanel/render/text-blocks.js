/**
 * BIAIF Render — Text-block reorder
 *
 * Adds a Notion-style margin drag handle (⋮⋮) that appears on hover of a
 * `.demande-text` (or `.demande-editor`) editor and lets the user
 * reorder its paragraphs via mouse drag.
 *
 *   • A "block" is the run of inline content between two `<br>` elements
 *     (or between start / end of the editor). One Enter keystroke
 *     creates a new boundary, so the granularity matches the user's
 *     own intent.
 *   • The handle is a singleton in `document.body` (position: fixed) so
 *     editor clears (innerHTML = '') don't tear it down.
 *   • Editors single-block don't get a handle (nothing to reorder).
 *   • A drop indicator (horizontal blue line) shows the candidate gap
 *     during drag.
 *   • On drop: the source block's nodes (and one separator BR) are
 *     spliced to the target index; the caller's `onSync` is invoked
 *     so it can persist the model.
 *
 * Usage:
 *   BIAIFRender.textBlocks.attach(textEl, function onReorder() { ... });
 *
 * Idempotent: re-attaching to the same element refreshes its onSync
 * callback without re-installing listeners.
 */
(function (window) {
  'use strict';
  window.BIAIFRender = window.BIAIFRender || {};

  var REGISTERED = '__biaif_block_handle_registered__';
  var globalHandle   = null;
  var globalDropLine = null;
  var hoverEl        = null;
  var hoverBlock     = null;
  var hoverOnSync    = null;
  var dragState      = null;   // { textEl, sourceBlock, onSync }
  var hideTimer      = null;

  // ── Globals (one handle + one drop indicator for the whole sidepanel) ──
  function _ensureGlobals() {
    if (globalHandle) return;

    globalHandle = document.createElement('button');
    globalHandle.type = 'button';
    globalHandle.className = 'biaif-block-handle';
    globalHandle.contentEditable = 'false';
    globalHandle.setAttribute('aria-label', 'Glisser pour réordonner ce paragraphe');
    globalHandle.setAttribute('tabindex', '-1');
    globalHandle.textContent = '⋮⋮';
    globalHandle.style.display = 'none';
    document.body.appendChild(globalHandle);

    globalDropLine = document.createElement('div');
    globalDropLine.className = 'biaif-block-drop-line';
    globalDropLine.style.display = 'none';
    document.body.appendChild(globalDropLine);

    globalHandle.addEventListener('mousedown', _onHandleMouseDown);
    globalHandle.addEventListener('mouseenter', _cancelHide);
    globalHandle.addEventListener('mouseleave', _scheduleHide);
    document.addEventListener('mousemove', _onDocMouseMove);
    document.addEventListener('mouseup',   _onDocMouseUp);
    window.addEventListener('scroll', _hideAll, true);
  }

  function attach(textEl, onSync) {
    if (!textEl) return;
    _ensureGlobals();
    // Idempotent: if already wired, just refresh the latest onSync.
    if (textEl[REGISTERED]) {
      textEl[REGISTERED].onSync = onSync;
      return;
    }
    var slot = { onSync: onSync };
    textEl[REGISTERED] = slot;
    textEl.classList.add('demande-text-blockable');
    textEl.addEventListener('mousemove',  function (e) { _onTextMouseMove(e, textEl, slot); });
    textEl.addEventListener('mouseleave', _scheduleHide);
  }

  // ── Block detection ───────────────────────────────────────────────────
  function _getBlocks(textEl) {
    var blocks = [];
    var current = [];
    for (var i = 0; i < textEl.childNodes.length; i++) {
      var node = textEl.childNodes[i];
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
        if (current.length) blocks.push(current);
        current = [];
      } else {
        if (node.nodeType === Node.TEXT_NODE && node.textContent === '') continue;
        current.push(node);
      }
    }
    if (current.length) blocks.push(current);
    return blocks;
  }

  function _blockBounds(block) {
    try {
      var range = document.createRange();
      range.setStartBefore(block[0]);
      range.setEndAfter(block[block.length - 1]);
      var rects = range.getClientRects();
      if (!rects.length) return null;
      return {
        top:    rects[0].top,
        bottom: rects[rects.length - 1].bottom,
        left:   rects[0].left,
      };
    } catch (_) { return null; }
  }

  // ── Hover (handle positioning) ────────────────────────────────────────
  function _onTextMouseMove(e, textEl, slot) {
    if (dragState) return;
    var blocks = _getBlocks(textEl);
    if (blocks.length < 2) {                 // single block: nothing to reorder
      _hideHandle();
      return;
    }
    var found = null;
    for (var i = 0; i < blocks.length; i++) {
      var r = _blockBounds(blocks[i]);
      if (!r) continue;
      if (e.clientY >= r.top && e.clientY <= r.bottom) { found = { block: blocks[i], rect: r }; break; }
    }
    if (!found) { _hideHandle(); return; }

    _cancelHide();
    hoverEl     = textEl;
    hoverBlock  = found.block;
    hoverOnSync = slot.onSync;

    var textRect = textEl.getBoundingClientRect();
    globalHandle.style.display = 'flex';
    globalHandle.style.top     = found.rect.top + 'px';
    globalHandle.style.left    = (textRect.left - 22) + 'px';
  }

  function _scheduleHide() {
    if (dragState) return;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(_hideHandle, 80);
  }
  function _cancelHide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }
  function _hideHandle() {
    if (dragState) return;
    globalHandle.style.display = 'none';
    hoverEl = null; hoverBlock = null; hoverOnSync = null;
  }
  function _hideAll() {
    _hideHandle();
    if (globalDropLine) globalDropLine.style.display = 'none';
  }

  // ── Drag start ────────────────────────────────────────────────────────
  function _onHandleMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!hoverEl || !hoverBlock) return;
    dragState = { textEl: hoverEl, sourceBlock: hoverBlock, onSync: hoverOnSync };
    document.body.style.cursor = 'grabbing';
    _highlight(dragState.sourceBlock, true);
  }

  // ── During drag ───────────────────────────────────────────────────────
  function _findDropIndex(textEl, y) {
    var blocks = _getBlocks(textEl);
    for (var i = 0; i < blocks.length; i++) {
      var r = _blockBounds(blocks[i]);
      if (!r) continue;
      if (y < (r.top + r.bottom) / 2) return { index: i, top: r.top };
    }
    var last = blocks[blocks.length - 1];
    var lastR = last ? _blockBounds(last) : null;
    return { index: blocks.length, top: lastR ? lastR.bottom - 2 : 0 };
  }

  function _onDocMouseMove(e) {
    if (!dragState) return;
    e.preventDefault();
    var textEl   = dragState.textEl;
    var textRect = textEl.getBoundingClientRect();
    // Hide the indicator when the mouse drifts far outside the editor
    if (e.clientY < textRect.top - 60 || e.clientY > textRect.bottom + 60) {
      globalDropLine.style.display = 'none';
      return;
    }
    var d = _findDropIndex(textEl, e.clientY);
    globalDropLine.style.display = 'block';
    globalDropLine.style.top   = (d.top - 1) + 'px';
    globalDropLine.style.left  = textRect.left + 'px';
    globalDropLine.style.width = textRect.width + 'px';
  }

  // ── Drop ──────────────────────────────────────────────────────────────
  function _onDocMouseUp(e) {
    if (!dragState) return;
    var s = dragState;
    dragState = null;
    document.body.style.cursor = '';
    globalDropLine.style.display = 'none';
    globalHandle.style.display = 'none';
    _highlight(s.sourceBlock, false);

    var textRect = s.textEl.getBoundingClientRect();
    if (e.clientY < textRect.top - 60 || e.clientY > textRect.bottom + 60) return;

    var blocks = _getBlocks(s.textEl);
    var srcIndex = blocks.indexOf(s.sourceBlock);
    if (srcIndex < 0) return;
    var d = _findDropIndex(s.textEl, e.clientY);
    var dropIndex = d.index;
    // No-op: dropping in the same place
    if (dropIndex === srcIndex || dropIndex === srcIndex + 1) return;

    _moveBlock(s.textEl, blocks, srcIndex, dropIndex);
    if (typeof s.onSync === 'function') s.onSync();
  }

  function _highlight(block, on) {
    if (!block) return;
    block.forEach(function (n) {
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      n.classList.toggle('biaif-block-dragging-node', on);
    });
  }

  // ── Reorder logic ─────────────────────────────────────────────────────
  // Splice `srcIndex` to before `dropIndex`. Carries one BR separator
  // along (preferring the trailing one) so paragraphs stay paragraphs.
  function _moveBlock(textEl, blocks, srcIndex, dropIndex) {
    var src      = blocks[srcIndex];
    var srcFirst = src[0];
    var srcLast  = src[src.length - 1];

    var trailingBr = _scanForBr(srcLast.nextSibling, 'forward');
    var leadingBr  = _scanForBr(srcFirst.previousSibling, 'backward');

    // Detach: source nodes + one separator
    var detached = [];
    src.forEach(function (n) { detached.push(n); n.remove(); });
    if (trailingBr)      trailingBr.remove();
    else if (leadingBr)  leadingBr.remove();

    // After detachment the indices shifted; re-fetch and adjust.
    var newBlocks   = _getBlocks(textEl);
    var newDropIdx  = (srcIndex < dropIndex) ? dropIndex - 1 : dropIndex;
    var newSep      = document.createElement('br');

    if (newDropIdx >= newBlocks.length) {
      textEl.appendChild(newSep);
      detached.forEach(function (n) { textEl.appendChild(n); });
    } else {
      var anchor = newBlocks[newDropIdx][0];
      var frag   = document.createDocumentFragment();
      detached.forEach(function (n) { frag.appendChild(n); });
      frag.appendChild(newSep);
      textEl.insertBefore(frag, anchor);
    }
  }

  // Walks siblings until it finds a BR or hits non-empty content.
  function _scanForBr(start, dir) {
    var n = start;
    while (n) {
      if (n.nodeType === Node.ELEMENT_NODE && n.tagName === 'BR') return n;
      if (n.nodeType === Node.TEXT_NODE && n.textContent !== '') break;
      if (n.nodeType === Node.ELEMENT_NODE) break;
      n = (dir === 'forward') ? n.nextSibling : n.previousSibling;
    }
    return null;
  }

  window.BIAIFRender.textBlocks = { attach: attach };
})(window);
