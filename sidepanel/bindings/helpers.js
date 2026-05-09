/**
 * BIAIF Bindings — Helpers
 *
 * Small UI helpers + high-level actions that are called from multiple
 * binding files (events, messages, keyboard, tabs). Grouped here so the
 * binding files stay focused on wiring rather than implementation.
 *
 * Sections:
 *   - Messaging primitives (sendBg, msgKey)
 *   - Tiny DOM helpers (capture subline, reload modal, settings font label)
 *   - Toast helpers (decode error, short label for descriptors)
 *   - Capture progress bar
 *   - Linked-session banner
 *   - Actions: clearAll, performUndo, addAllConsoleErrors, file import,
 *     context-menu text/image
 *   - Errors: refreshErrorsFromActiveTab, onConsoleError
 */
(function (window) {
  'use strict';
  window.BIAIFBindings = window.BIAIFBindings || {};
  var ctx   = window.BIAIFBindings.ctx;
  var UTILS = (window.BIAIF && window.BIAIF.utils) || {};
  function _t(k, fb, vars) { return UTILS.t ? UTILS.t(k, fb, vars) : (fb || k); }

  // ── Messaging primitives ───────────────────────────────────────────
  function sendBg(payload) { return chrome.runtime.sendMessage(payload).catch(function () { return null; }); }
  function msgKey(key) {
    return UTILS.msgKey ? UTILS.msgKey(key)
      : (window.BIAIF && window.BIAIF.MSG && window.BIAIF.MSG[key])
        || ('biaif:' + key.toLowerCase().replace(/_/g, '-'));
  }
  function decodeContentScriptError(err) {
    return UTILS.decodeErr ? UTILS.decodeErr(err)
      : (typeof err === 'string' ? err : (err && err.message || String(err)));
  }

  // ── Settings font label ────────────────────────────────────────────
  function updateSpFontVal() {
    var el = document.getElementById('sp-font-val');
    if (el) el.textContent = (ctx.STATE.segFontSize || 13) + 'px';
  }

  function updateSpLinesVal() {
    var el = document.getElementById('sp-seg-lines-val');
    if (el) el.textContent = (ctx.STATE.segTextLines || 5) + ' lignes';
  }

  // ── Capture subline (toolbar dropdown) ─────────────────────────────
  function openCaptureSubline() {
    var sub = document.querySelector('.quick-tools-subline');
    var btn = document.querySelector('[data-act="capture-toggle"]');
    if (sub) sub.removeAttribute('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }
  function closeCaptureSubline() {
    var sub = document.querySelector('.quick-tools-subline');
    var btn = document.querySelector('[data-act="capture-toggle"]');
    if (sub) sub.setAttribute('hidden', '');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
  function toggleCaptureSubline() {
    var sub = document.querySelector('.quick-tools-subline');
    if (!sub) return;
    sub.hasAttribute('hidden') ? openCaptureSubline() : closeCaptureSubline();
  }

  // ── Reload modal ───────────────────────────────────────────────────
  function showReloadModal() { if (ctx.REFS.reloadModal) ctx.REFS.reloadModal.removeAttribute('hidden'); }
  function hideReloadModal() { if (ctx.REFS.reloadModal) ctx.REFS.reloadModal.setAttribute('hidden', ''); }

  // ── Capture progress bar ───────────────────────────────────────────
  function updateCaptureProgress(current, total, label) {
    var REFS = ctx.REFS;
    if (!REFS.captureProgress) return;
    if (!total || current >= total) { REFS.captureProgress.setAttribute('hidden', ''); return; }
    REFS.captureProgress.removeAttribute('hidden');
    var pct = Math.round((current / total) * 100);
    if (REFS.captureProgressBar) REFS.captureProgressBar.style.width = pct + '%';
    if (REFS.captureProgressLbl) REFS.captureProgressLbl.textContent = label || ('Section ' + current + '/' + total);
  }

  // ── Linked-session banner ──────────────────────────────────────────
  async function updateLinkedSessionBanner() {
    var STATE = ctx.STATE;
    var banner = document.getElementById('linked-session-banner');
    if (!banner) return;
    if (!STATE.armed || !STATE.pendingConversationUrl) {
      banner.setAttribute('hidden', ''); return;
    }
    var convLabel = STATE.pendingConversationUrl;
    try { var u = new URL(STATE.pendingConversationUrl); convLabel = u.hostname + u.pathname; } catch (_) {}
    var tabLabel = '';
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) tabLabel = tabs[0].title || tabs[0].url || '';
      if (tabLabel.length > 40) tabLabel = tabLabel.slice(0, 38) + '…';
    } catch (_) {}
    var convEl = banner.querySelector('.lsb-conv');
    var tabEl  = banner.querySelector('.lsb-tab');
    if (convEl) convEl.textContent = convLabel;
    if (tabEl)  tabEl.textContent  = tabLabel ? '→ ' + tabLabel : '';
    banner.removeAttribute('hidden');
  }

  // ── Short-label helper for picker toasts ──────────────────────────
  function shortLabel(descriptor) {
    if (!descriptor) return '?';
    var tag = (descriptor.tag || 'el').toLowerCase();
    if (descriptor.id) return '#' + descriptor.id;
    var label = '<' + tag + '>';
    if (Array.isArray(descriptor.classes) && descriptor.classes.length) {
      var candidates = descriptor.classes.filter(function (c) {
        return c && c.length <= 22 && (c.match(/[A-Z]/g) || []).length < 3;
      });
      if (candidates.length) label = tag + '.' + candidates[0];
    }
    if (descriptor.text) {
      var snip = String(descriptor.text).replace(/\s+/g, ' ').trim();
      if (snip) label += ' « ' + (snip.length > 40 ? snip.slice(0, 40) + '…' : snip) + ' »';
    }
    return label;
  }

  // ── Console errors ─────────────────────────────────────────────────
  function onConsoleError(err) {
    var STATE = ctx.STATE;
    if (!err || !err.key) return;
    if (STATE.consoleErrors.find(function (e) { return e.key === err.key; })) return;
    STATE.consoleErrors.push(err);
    window.BIAIFRenderer.updateErrorsBadges();
  }

  async function refreshErrorsFromActiveTab() {
    var STATE = ctx.STATE;
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      var tab  = tabs[0];
      if (!tab || !tab.id) return;
      var resp = null;
      try { resp = await chrome.tabs.sendMessage(tab.id, { type: msgKey('GET_ERRORS') }); } catch (_) {}
      STATE.consoleErrors = [];
      if (resp && Array.isArray(resp.errors)) resp.errors.forEach(onConsoleError);
      else window.BIAIFRenderer.updateErrorsBadges();
    } catch (_) {}
  }

  function addAllConsoleErrors() {
    var STATE = ctx.STATE;
    if (!STATE.consoleErrors.length) {
      window.BIAIFToast.show(_t('toast.no_errors', 'Aucune erreur capturée.'), 'info');
      return;
    }
    var count = STATE.consoleErrors.length;
    for (var i = 0; i < STATE.consoleErrors.length; i++) {
      var err = STATE.consoleErrors[i];
      window.BIAIFSession.addRefToTarget({
        type: 'error', msg: err.msg || '', file: err.file || null,
        line: err.line || null, col: err.col || null, stack: err.stack || null,
        url: err.url || null, ts: err.ts || Date.now(),
      });
    }
    STATE.consoleErrors = [];
    window.BIAIFRenderer.updateErrorsBadges();
    var tn = (window.BIAIF && window.BIAIF.utils && window.BIAIF.utils.tn) || _t;
    window.BIAIFToast.show(
      tn('toast.errors_added', count, count + ' erreur(s) ajoutée(s)', { n: count }),
      'success');
  }

  // ── File import ────────────────────────────────────────────────────
  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload  = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(file);
    });
  }

  async function handleCaptureFiles(files) {
    if (!files || !files.length) return;
    var count = 0;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file.type.startsWith('image/')) continue;
      try {
        var dataUrl = await readFileAsDataUrl(file);
        if (window.BIAIFImaging) {
          try { dataUrl = await window.BIAIFImaging.compressDataUrl(dataUrl); } catch (_) {}
        }
        window.BIAIFSession.addRefToTarget({
          type: 'screenshot', mode: 'fichier', dataUrl: dataUrl,
          fileName: file.name, ts: Date.now(),
        });
        count++;
      } catch (e) { console.warn('[BIAIF] file read failed', e && e.message); }
    }
    var tnImg = (window.BIAIF && window.BIAIF.utils && window.BIAIF.utils.tn) || _t;
    if (count) window.BIAIFToast.show(
      tnImg('toast.images_added', count, count + ' image(s) ajoutée(s)', { n: count }),
      'success');
  }

  // ── Context-menu handlers (text/image grabbed from any web page) ──
  function addTextFromContext(text, pageUrl) {
    if (!text) return;
    window.BIAIFSession.addTextToTarget('« ' + text + ' »');
    if (pageUrl) ctx.STATE.currentDemande.pageUrl = pageUrl;
    window.BIAIFToast.show(_t('toast.text_selection_added', 'Texte ajouté.'), 'success');
  }

  async function addImageFromContext(srcUrl, pageUrl) {
    if (!srcUrl) return;
    window.BIAIFToast.show(_t('toast.image_downloading', 'Téléchargement…'), 'info', 2000);
    var dataUrl = null;
    try {
      var resp = await fetch(srcUrl);
      var blob = await resp.blob();
      dataUrl = await new Promise(function (res, rej) {
        var r = new FileReader();
        r.onload = function () { res(r.result); };
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
      if (dataUrl && window.BIAIFImaging) {
        try { dataUrl = await window.BIAIFImaging.compressDataUrl(dataUrl); } catch (_) {}
      }
    } catch (_) {}
    window.BIAIFSession.addRefToTarget({
      type: 'screenshot', mode: dataUrl ? 'image' : 'image-url',
      dataUrl: dataUrl, srcUrl: srcUrl, url: pageUrl || null, ts: Date.now(),
    });
    if (pageUrl) ctx.STATE.currentDemande.pageUrl = pageUrl;
    window.BIAIFToast.show(
      _t(dataUrl ? 'toast.image_added' : 'toast.image_added_url', 'Image ajoutée.'),
      'success');
  }

  // ── Clear-all ──────────────────────────────────────────────────────
  function clearAll() {
    var STATE = ctx.STATE, REFS = ctx.REFS;
    if (!STATE.demandes.length && !(STATE.currentDemande.text || '').trim() && !STATE.currentDemande.refs.length) return;
    // Snapshot BEFORE wiping so the toast's "Annuler" can restore it.
    if (window.BIAIFUndo) window.BIAIFUndo.push({
      demandes:       JSON.parse(JSON.stringify(STATE.demandes)),
      currentDemande: JSON.parse(JSON.stringify(STATE.currentDemande)),
    });
    if (STATE.editingDemandeIdx !== null) window.BIAIFSession.exitEditMode({ silent: true });
    STATE.demandes       = [];
    STATE.currentDemande = { text: '', refs: [], pageUrl: null };
    STATE.currentInterim = '';
    STATE.lastShot       = null;
    STATE.lastShotMode   = null;
    if (REFS.demandeEditor) REFS.demandeEditor.innerHTML = '';
    window.BIAIFSpeech.clearInterimGhost();
    window.BIAIFRenderer.renderDemandeRefsStrip();
    window.BIAIFRenderer.renderSegments();
    window.BIAIFRenderer.updateArmedUi();
    window.BIAIFStorage.persist(STATE, { skipUndo: true });
    window.BIAIFToast.showAction(
      _t('toast.cleared', 'Tout effacé.'),
      _t('toast.undo_action', 'Annuler'),
      performUndo,
      { duration: 6000 }
    );
  }

  // ── Undo (Ctrl+Z) ──────────────────────────────────────────────────
  function _applySnapshot(snapshot) {
    var STATE = ctx.STATE;
    STATE.demandes       = snapshot.demandes;
    STATE.currentDemande = snapshot.currentDemande;
    window.BIAIFRenderer.renderDemandeEditor();
    window.BIAIFRenderer.renderSegments();
    window.BIAIFRenderer.updateArmedUi();
    window.BIAIFStorage.persist(STATE, { skipUndo: true });
  }

  function _currentSnapshot() {
    var STATE = ctx.STATE;
    return { demandes: JSON.parse(JSON.stringify(STATE.demandes)), currentDemande: JSON.parse(JSON.stringify(STATE.currentDemande)) };
  }

  function performUndo() {
    if (!window.BIAIFUndo.canUndo()) {
      window.BIAIFToast.show(_t('toast.nothing_to_undo', 'Rien à annuler.'), 'info', 1500);
      return;
    }
    var snapshot = window.BIAIFUndo.pop(_currentSnapshot());
    if (!snapshot) return;
    _applySnapshot(snapshot);
    window.BIAIFToast.show(_t('toast.undone', 'Action annulée.'), 'success', 2000);
  }

  function performRedo() {
    if (!window.BIAIFUndo.canRedo()) {
      window.BIAIFToast.show(_t('toast.nothing_to_redo', 'Rien à rétablir.'), 'info', 1500);
      return;
    }
    var snapshot = window.BIAIFUndo.popRedo();
    if (!snapshot) return;
    _applySnapshot(snapshot);
    window.BIAIFToast.show(_t('toast.redone', 'Action rétablie.'), 'success', 2000);
  }

  window.BIAIFBindings.helpers = {
    sendBg:                   sendBg,
    msgKey:                   msgKey,
    decodeContentScriptError: decodeContentScriptError,
    updateSpFontVal:          updateSpFontVal,
    updateSpLinesVal:         updateSpLinesVal,
    openCaptureSubline:       openCaptureSubline,
    closeCaptureSubline:      closeCaptureSubline,
    toggleCaptureSubline:     toggleCaptureSubline,
    showReloadModal:          showReloadModal,
    hideReloadModal:          hideReloadModal,
    updateCaptureProgress:    updateCaptureProgress,
    updateLinkedSessionBanner: updateLinkedSessionBanner,
    shortLabel:               shortLabel,
    onConsoleError:           onConsoleError,
    refreshErrorsFromActiveTab: refreshErrorsFromActiveTab,
    addAllConsoleErrors:      addAllConsoleErrors,
    handleCaptureFiles:       handleCaptureFiles,
    readFileAsDataUrl:        readFileAsDataUrl,
    addTextFromContext:       addTextFromContext,
    addImageFromContext:      addImageFromContext,
    clearAll:                 clearAll,
    performUndo:              performUndo,
    performRedo:              performRedo,
  };
})(window);
