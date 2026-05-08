/**
 * BIAIF Session
 * Session lifecycle, demande finalization, edit mode, shot runner, merge.
 */
(function (window) {
  'use strict';

  var STATE, REFS;
  var timerInterval = null, timerStart = 0;

  function init(state, refs) { STATE = state; REFS = refs; }

  // -----------------------------------------------------------------------
  // Session lifecycle
  // -----------------------------------------------------------------------
  async function startSession() {
    if (STATE.armed) return;
    if (STATE.editingDemandeIdx !== null) exitEditMode({ silent: true });
    STATE.armed = true;
    if (REFS.masterBtn) REFS.masterBtn.classList.add('armed');
    _updateMasterBtn();
    if (REFS.stopBtn) REFS.stopBtn.hidden = false;
    _updateArmedUi();
    _startTimer();
    if (!STATE.pickerActive) {
      var resp = await _sendBg({ type: _MSG('PICKER_ENABLE') });
      if (resp && resp.error) _toast(_t('toast.picker_fail', 'Picker KO : ' + _decodeErr(resp.error), { err: _decodeErr(resp.error) }), 'error');
    }
    if (!STATE.micActive) await window.BIAIFSpeech.startMic();
    _toast(_t('toast.session_started', 'Session démarrée.'), 'success');
  }

  function stopSession() {
    if (!STATE.armed) return;
    if (STATE.editingDemandeIdx !== null) exitEditMode({ silent: true });
    STATE.armed = false;
    if (REFS.masterBtn) REFS.masterBtn.classList.remove('armed');
    _updateMasterBtn();
    if (REFS.stopBtn) REFS.stopBtn.hidden = true;
    _stopTimer();
    if (STATE.pickerActive) _sendBg({ type: _MSG('PICKER_DISABLE') });
    if (STATE.micActive)    window.BIAIFSpeech.stopMic();
    syncCurrentDemandeFromEditor();
    if ((STATE.currentDemande.text || '').trim() || STATE.currentDemande.refs.length) {
      finalizeDemande(true);
    }
    _updateArmedUi();
    _toast(_t('toast.session_stopped', 'Session arrêtée — ' + STATE.demandes.length + ' demande(s) capturée(s).', { n: STATE.demandes.length }), 'info');
  }

  var MAX_DEMANDE_LEN = 50000;

  function finalizeDemande(silent) {
    if (STATE.editingDemandeIdx !== null) {
      // Unified editor → save changes back to the segment then go back to history
      _saveEditToDemande();
      var updatedIdx = STATE.editingDemandeIdx;
      exitEditMode({ silent: true });
      _disarm();
      window.BIAIFStorage.persist(STATE);
      if (!silent) _toast(_t('toast.demande_updated', 'Demande #' + (updatedIdx + 1) + ' mise à jour.', { n: updatedIdx + 1 }), 'success');
      return;
    }
    // Auto-arm silently on first save (no mic/picker forced, user controls those).
    if (!STATE.armed) {
      STATE.armed = true;
      if (REFS && REFS.masterBtn) REFS.masterBtn.classList.add('armed');
    }
    syncCurrentDemandeFromEditor();
    var text    = STATE.currentDemande.text, refs = STATE.currentDemande.refs;
    var cleaned = (text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned && !refs.length) {
      if (!silent) _toast(_t('toast.nothing_to_finalize', 'Rien à finaliser — parlez ou ajoutez une référence.'), 'info');
      return;
    }
    if (cleaned.length > MAX_DEMANDE_LEN) {
      cleaned = cleaned.slice(0, MAX_DEMANDE_LEN);
      _toast(_t('toast.demande_truncated', 'Texte tronqué à ' + MAX_DEMANDE_LEN + ' caractères.', { n: MAX_DEMANDE_LEN }), 'warning', 5000);
    }
    // Derive repoId: prefer explicit pending, then scan refs
    var repoId = STATE.pendingRepoId || null;
    if (!repoId) {
      for (var j = 0; j < refs.length; j++) { if (refs[j].repoId) { repoId = refs[j].repoId; break; } }
    }
    var savedNum = STATE.demandes.length + 1;
    STATE.demandes.push({
      id:              'dem-' + Date.now(),
      ts:              Date.now(),
      text:            cleaned,
      refs:            refs.slice(),
      url:             STATE.currentDemande.pageUrl || null,
      conversationUrl: STATE.pendingConversationUrl || null,
      repoId:          repoId,
    });
    STATE.currentDemande = { text: '', refs: [], pageUrl: null };
    if (REFS.demandeEditor) REFS.demandeEditor.innerHTML = '';
    // Save done → go back to history view
    _disarm();
    window.BIAIFRenderer.renderDemandeRefsStrip();
    window.BIAIFRenderer.renderSegments();
    window.BIAIFStorage.persist(STATE);
    if (!silent) _toast(_t('toast.demande_finalized', 'Demande #' + savedNum + ' finalisée.', { n: savedNum }), 'success');
  }

  // nextVoiceSegment is the legacy alias for finalizeDemande
  function nextVoiceSegment() { finalizeDemande(false); }

  // -----------------------------------------------------------------------
  // Edit mode — unified editor zone (top editor is reused for both new and edit)
  // -----------------------------------------------------------------------
  function enterEditMode(idx) {
    if (idx == null || idx === STATE.editingDemandeIdx) {
      // Second click on same card → save and exit
      if (idx === STATE.editingDemandeIdx) finalizeDemande(false);
      return;
    }
    if (STATE.editingDemandeIdx !== null) exitEditMode({ silent: true });
    var dem = STATE.demandes[idx];
    if (!dem) return;
    window.BIAIFSpeech.clearInterimGhost();

    // Backup the new-demande draft so we can restore it when exiting edit mode
    STATE._draftBackup = {
      text: STATE.currentDemande.text,
      refs: STATE.currentDemande.refs.slice(),
      pageUrl: STATE.currentDemande.pageUrl,
    };

    // Load the segment into the top editor via currentDemande
    STATE.currentDemande = { text: dem.text || '', refs: (dem.refs || []).slice(), pageUrl: dem.url || null };
    STATE.editingDemandeIdx = idx;
    STATE.dictationTarget   = 'current';
    STATE.modalTarget       = 'current';
    // Arm the session so the unified zone shows (history hidden, tools visible)
    STATE.armed = true;
    if (REFS && REFS.masterBtn) REFS.masterBtn.classList.add('armed');

    if (!STATE.micActive) window.BIAIFSpeech.startMic();
    if (!STATE.pickerActive) _sendBg({ type: _MSG('PICKER_ENABLE') });

    window.BIAIFRenderer.renderDemandeEditor();
    window.BIAIFRenderer.renderSegments();
    window.BIAIFRenderer.updateArmedUi();
    window.BIAIFRenderer.updateMasterBtnLabel();
    window.BIAIFRenderer.updateEditorContext(idx, dem.url || null);

    setTimeout(function () {
      if (REFS.demandeEditor) REFS.demandeEditor.focus();
    }, 30);
    _toast(_t('toast.edit_mode_entered', 'Édition de la demande #' + (idx + 1) + ' — voix, picker, capture s\'y insèrent.', { n: idx + 1 }), 'info', 3000);
  }

  function _saveEditToDemande() {
    var idx = STATE.editingDemandeIdx;
    if (idx === null || idx === undefined) return;
    var dem = STATE.demandes[idx];
    if (!dem) return;
    syncCurrentDemandeFromEditor();
    dem.text = STATE.currentDemande.text;
    dem.refs = STATE.currentDemande.refs.slice();
  }

  function exitEditMode(opts) {
    if (STATE.editingDemandeIdx === null) return;
    if (!opts || !opts.silent) _saveEditToDemande();
    window.BIAIFSpeech.clearInterimGhost();

    // Restore the new-demande draft
    STATE.currentDemande = STATE._draftBackup || { text: '', refs: [], pageUrl: null };
    STATE._draftBackup   = null;
    STATE.editingDemandeIdx = null;
    STATE.dictationTarget   = 'current';

    if (!STATE.armed && STATE.pickerActive) _sendBg({ type: _MSG('PICKER_DISABLE') });

    window.BIAIFRenderer.renderDemandeEditor();
    window.BIAIFRenderer.renderSegments();
    window.BIAIFRenderer.updateArmedUi();
    window.BIAIFRenderer.updateMasterBtnLabel();
    window.BIAIFRenderer.updateEditorContext(null, null);

    if (!opts || !opts.silent) _toast(_t('toast.edit_mode_exited', 'Demande mise à jour.'), 'success');
  }

  // -----------------------------------------------------------------------
  // Ref routing
  // -----------------------------------------------------------------------
  function activeTargetIdx() {
    if (typeof STATE.editingDemandeIdx === 'number') return STATE.editingDemandeIdx;
    if (typeof STATE.modalTarget       === 'number') return STATE.modalTarget;
    return null;
  }

  async function addRefToTarget(ref) {
    // SCRUB: clean PII/secrets in text fields before storing (defense-in-depth)
    if (window.BIAIFScrub && window.BIAIFScrub.isEnabled(STATE)) window.BIAIFScrub.scrubRef(ref);
    // Stamp the active tab's URL and GitHub repo onto every ref
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      var tabUrl = (tabs[0] && tabs[0].url) || null;
      if (tabUrl) {
        ref.tabUrl = tabUrl;
        var repo = _extractGithubRepo(tabUrl);
        if (repo) ref.repoId = repo;
      }
    } catch (_) {}

    // Always insert into the top editor (currentDemande),
    // whether creating new or editing an existing segment.
    STATE.currentDemande.refs.push(ref);
    var absIdx = STATE.currentDemande.refs.length - 1;
    window.BIAIFRenderer.appendChipToEditor(absIdx, ref);
    if (!STATE.editingDemandeIdx) rememberPageUrl();
    window.BIAIFRenderer.updateMasterBtnLabel();
    return true;
  }

  function _extractGithubRepo(url) {
    return (window.BIAIF && window.BIAIF.utils)
      ? window.BIAIF.utils.extractGithubRepo(url)
      : null;
  }

  function addTextToTarget(text) {
    if (!text) return;
    // Always target the top editor (works for both new and edit mode)
    if (REFS.demandeEditor) {
      REFS.demandeEditor.focus();
      insertTextAtSelection(REFS.demandeEditor, text);
      syncCurrentDemandeFromEditor();
      window.BIAIFStorage.persist(STATE);
    }
  }

  // -----------------------------------------------------------------------
  // Shot runner
  // -----------------------------------------------------------------------
  async function runShotMode(mode) {
    _toast(_t('toast.shot_running', 'Capture (' + mode + ')…', { mode: mode }), 'info', 2000);
    var resp = await _sendBg({ type: _MSG('CAPTURE_MODE'), mode: mode });
    if (!resp || resp.error || !resp.dataUrl) {
      var err = _decodeErr(resp ? (resp.error || 'pas de dataUrl') : 'pas de réponse');
      _toast(_t('toast.shot_fail', 'Capture KO : ' + err, { err: err }), 'error');
      return;
    }
    // Compress before storing so we don't blow chrome.storage.local quota.
    var compressedUrl = resp.dataUrl;
    if (window.BIAIFImaging) {
      try { compressedUrl = await window.BIAIFImaging.compressDataUrl(resp.dataUrl); } catch (_) {}
    }
    STATE.lastShot     = compressedUrl;
    STATE.lastShotMode = mode;
    // Move the heavy bytes to IndexedDB; keep dataUrl in memory for live render.
    var blobId = null;
    if (window.BIAIFBlobStore) {
      try { blobId = await window.BIAIFBlobStore.put(compressedUrl); } catch (_) {}
    }
    var ref  = { type: 'screenshot', mode: mode, dataUrl: compressedUrl, blobId: blobId, ts: Date.now() };
    var tIdx = activeTargetIdx();
    addRefToTarget(ref);
    _toast(typeof tIdx === 'number'
      ? _t('toast.shot_added', 'Capture ' + mode + ' ajoutée à la demande #' + (tIdx + 1), { mode: mode, n: tIdx + 1 })
      : _t('toast.shot_added_current', 'Capture ' + mode + ' OK — ajoutée comme référence', { mode: mode }), 'success');
    STATE.modalTarget = 'current';
  }

  // -----------------------------------------------------------------------
  // Merge
  // -----------------------------------------------------------------------
  // Reorder: move src segment to the dst position (no merge).
  function reorderDemande(srcIdx, dstIdx) {
    if (srcIdx === dstIdx || srcIdx === dstIdx - 1) return;
    var item = STATE.demandes.splice(srcIdx, 1)[0];
    if (!item) return;
    if (dstIdx > srcIdx) dstIdx--;
    STATE.demandes.splice(dstIdx, 0, item);
    if (typeof STATE.editingDemandeIdx === 'number') {
      if (STATE.editingDemandeIdx === srcIdx) STATE.editingDemandeIdx = dstIdx;
      else if (srcIdx < STATE.editingDemandeIdx && dstIdx >= STATE.editingDemandeIdx) STATE.editingDemandeIdx--;
      else if (srcIdx > STATE.editingDemandeIdx && dstIdx <= STATE.editingDemandeIdx) STATE.editingDemandeIdx++;
    }
    window.BIAIFRenderer.renderSegments();
    window.BIAIFStorage.persist(STATE);
    _toast(_t('toast.reordered', 'Demande déplacée en position #' + (dstIdx + 1) + '.', { n: dstIdx + 1 }), 'success', 1800);
  }

  function mergeDemandes(srcIdx, dstIdx) {
    if (srcIdx === dstIdx) return;
    var src = STATE.demandes[srcIdx], dst = STATE.demandes[dstIdx];
    if (!src || !dst) return;
    var offset  = (dst.refs || []).length;
    var shifted = (src.text || '').replace(/\{\{ref:(\d+)\}\}/g, function (_, n) { return '{{ref:' + (Number(n) + offset) + '}}'; });
    dst.text    = ((dst.text || '') + (dst.text ? ' ' : '') + shifted).replace(/\s+/g, ' ').trim();
    dst.refs    = (dst.refs || []).concat(src.refs || []);
    STATE.demandes.splice(srcIdx, 1);
    if (typeof STATE.dictationTarget === 'number') {
      if (STATE.dictationTarget === srcIdx) STATE.dictationTarget = srcIdx < dstIdx ? dstIdx - 1 : dstIdx;
      else if (STATE.dictationTarget > srcIdx) STATE.dictationTarget--;
    }
    window.BIAIFRenderer.renderSegments();
    window.BIAIFStorage.persist(STATE);
    var newNum = ((srcIdx < dstIdx) ? dstIdx - 1 : dstIdx) + 1;
    _toast(_t('toast.merge_complete', 'Demandes fusionnées dans #' + newNum + '.', { n: newNum }), 'success');
  }

  // -----------------------------------------------------------------------
  // Editor sync helpers (used by speech.js and renderer.js)
  // -----------------------------------------------------------------------
  function syncCurrentDemandeFromEditor() {
    var ed = REFS.demandeEditor;
    if (!ed) return;
    var oldRefs = STATE.currentDemande.refs, newRefs = [], text = '';
    for (var node of ed.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList && node.classList.contains('ref-chip')) {
          var ref = oldRefs[Number(node.dataset.ref)];
          if (ref) {
            newRefs.push(ref);
            var newIdx = newRefs.length - 1;
            text += '{{ref:' + newIdx + '}}';
            node.dataset.ref = String(newIdx);
            var numSpan = node.querySelector('.ref-chip-label');
            if (numSpan) numSpan.textContent = numSpan.textContent.replace(/#\d+/, '#' + (newIdx + 1));
          }
        } else if (node.tagName === 'BR') {
          text += '\n';
        } else if (node.classList && node.classList.contains('text-chip')) {
          text += node.textContent;
        }
      }
    }
    STATE.currentDemande.text = text;
    STATE.currentDemande.refs = newRefs;
    window.BIAIFRenderer.updateMasterBtnLabel();
  }

  function syncDemandeFromTextEl(textEl, dem) {
    var oldRefs = dem.refs || [], newRefs = [], txt = '';
    for (var node of textEl.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) txt += node.textContent;
      else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList && node.classList.contains('ref-chip')) {
          var ref = oldRefs[Number(node.dataset.ref)];
          if (ref) { newRefs.push(ref); txt += '{{ref:' + (newRefs.length - 1) + '}}'; node.dataset.ref = String(newRefs.length - 1); }
        } else if (node.tagName === 'BR') txt += '\n';
        else txt += node.textContent;
      }
    }
    dem.text = txt.replace(/\s+/g, ' ').trim();
    dem.refs = newRefs;
  }

  function insertTextAtSelection(container, text) {
    if (!container || !text) return;
    var trimmed = text.replace(/\s+$/, '');
    if (!trimmed) return;
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && container.contains(sel.anchorNode)) {
      var range    = sel.getRangeAt(0);
      var prevChar = _charBefore(range), nextChar = _charAfter(range);
      var final    = (prevChar && !/\s/.test(prevChar) ? ' ' : '') + trimmed + (!nextChar || !/\s/.test(nextChar) ? ' ' : '');
      range.deleteContents();
      var node = document.createTextNode(final);
      range.insertNode(node);
      range.setStartAfter(node); range.collapse(true);
      sel.removeAllRanges(); sel.addRange(range);
      return;
    }
    _appendWithSpace(container, trimmed);
  }

  async function rememberPageUrl(opt) {
    try {
      var url = opt || null;
      if (!url) {
        var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        url = tabs[0] && tabs[0].url || null;
      }
      if (url) STATE.currentDemande.pageUrl = url;
    } catch (_) {}
  }

  // -----------------------------------------------------------------------
  // Edit ref (replace element / re-annotate screenshot)
  // -----------------------------------------------------------------------
  async function editRef(demKey, refIndex, editType) {
    var target = demKey === 'current' ? STATE.currentDemande : STATE.demandes[demKey];
    if (!target || !target.refs || !target.refs[refIndex]) return;
    var ref = target.refs[refIndex];

    if (editType === 'screenshot' || ref.type === 'screenshot') {
      if (!ref.dataUrl) { _toast(_t('toast.annotate_unavailable', 'Capture indisponible (cache local).'), 'error'); return; }
      _toast(_t('toast.annotate_open', "Annotateur ouvert dans l'onglet actif…"), 'info', 2000);
      var resp = await _sendBg({ type: _MSG('ANNOTATE'), dataUrl: ref.dataUrl });
      if (!resp || resp.cancelled) { _toast(_t('toast.annotate_cancelled', 'Annotation annulée.'), 'info'); return; }
      if (resp.error || !resp.dataUrl) {
        var aerr = _decodeErr(resp.error || 'no result');
        _toast(_t('toast.annotate_fail', 'Annotation KO : ' + aerr, { err: aerr }), 'error'); return;
      }
      ref.dataUrl = resp.dataUrl;
      if (demKey === 'current') window.BIAIFRenderer.renderDemandeEditor();
      else window.BIAIFRenderer.renderSegments();
      window.BIAIFStorage.persist(STATE);
      _toast(_t('toast.annotate_saved', 'Référence #' + (refIndex + 1) + ' : annotation enregistrée.', { n: refIndex + 1 }), 'success');
      return;
    }
    STATE.replacingRef = { demKey: demKey, refIndex: refIndex };
    var r2 = await _sendBg({ type: _MSG('PICKER_ENABLE') });
    if (r2 && r2.error) {
      STATE.replacingRef = null;
      var perr = _decodeErr(r2.error);
      _toast(_t('toast.picker_fail', 'Picker KO : ' + perr, { err: perr }), 'error');
      return;
    }
    _toast(_t('toast.replace_ref_prompt', 'Cliquez un élément pour remplacer la référence #' + (refIndex + 1) + '…', { n: refIndex + 1 }), 'info', 4000);
  }

  // -----------------------------------------------------------------------
  // Timer
  // -----------------------------------------------------------------------
  function _startTimer() {
    if (!REFS.timer) return;
    timerStart = Date.now();
    timerInterval = setInterval(function () {
      var s  = Math.floor((Date.now() - timerStart) / 1000);
      var mm = String(Math.floor(s / 60)).padStart(2, '0');
      var ss = String(s % 60).padStart(2, '0');
      if (REFS.timer) REFS.timer.textContent = mm + ':' + ss;
    }, 250);
  }
  function _stopTimer() {
    if (timerInterval) clearInterval(timerInterval); timerInterval = null;
    if (REFS.timer) REFS.timer.textContent = '00:00';
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------
  // Silently disarm: leave new/edit mode → stop mic + picker (they only run
  // while a session is armed). Switch back to the history view.
  function _disarm() {
    STATE.armed = false;
    if (REFS && REFS.masterBtn) REFS.masterBtn.classList.remove('armed');
    if (STATE.micActive    && window.BIAIFSpeech.stopMic) window.BIAIFSpeech.stopMic();
    if (STATE.pickerActive) _sendBg({ type: _MSG('PICKER_DISABLE') });
    window.BIAIFRenderer.updateArmedUi();
    window.BIAIFRenderer.updateMasterBtnLabel();
  }

  // Public disarm — saves edit if any, abandons new draft, goes back to history
  function disarm() {
    if (STATE.editingDemandeIdx !== null) {
      // Save edits before going back
      _saveEditToDemande();
      exitEditMode({ silent: true });
    } else {
      syncCurrentDemandeFromEditor();
    }
    _disarm();
    window.BIAIFRenderer.renderSegments();
    window.BIAIFStorage.persist(STATE);
    _toast(_t('toast.back_to_history', 'Retour à l\'historique.'), 'info', 1500);
  }

  function _updateMasterBtn() { if (window.BIAIFRenderer) window.BIAIFRenderer.updateMasterBtnLabel(); }
  function _updateArmedUi()   { if (window.BIAIFRenderer) window.BIAIFRenderer.updateArmedUi(); }
  function _toast(m, k, d)    { if (window.BIAIFToast) window.BIAIFToast.show(m, k, d); }
  function _t(key, fallback, vars) {
    if (window.BIAIFi18n && window.BIAIFi18n.t) {
      var v = window.BIAIFi18n.t(key, vars);
      if (v && v !== key) return v;
    }
    return fallback || key;
  }
  function _sendBg(payload)   { return chrome.runtime.sendMessage(payload).catch(function () { return null; }); }
  function _MSG(key)          { return window.BIAIF && window.BIAIF.MSG ? window.BIAIF.MSG[key] : 'biaif:' + key.toLowerCase().replace(/_/g, '-'); }
  function _decodeErr(e) {
    return (window.BIAIF && window.BIAIF.utils)
      ? window.BIAIF.utils.decodeErr(e)
      : (typeof e === 'string' ? e : (e && e.message || String(e)));
  }

  function _appendWithSpace(container, text) {
    var trimmed = text.replace(/^\s+|\s+$/g, '');
    if (!trimmed) return;
    var last = container.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) {
      var end = last.textContent.slice(-1);
      last.textContent += (end && !/\s/.test(end) ? ' ' : '') + trimmed + ' ';
    } else if (last && last.nodeType === Node.ELEMENT_NODE) {
      container.appendChild(document.createTextNode(' ' + trimmed + ' '));
    } else {
      container.appendChild(document.createTextNode(trimmed + ' '));
    }
  }
  function _charBefore(range) {
    try { var r = range.cloneRange(); r.collapse(true); r.setStart(range.startContainer, Math.max(0, range.startOffset - 1)); return r.toString(); } catch (_) { return ''; }
  }
  function _charAfter(range) {
    try { var r = range.cloneRange(); r.collapse(false); var n = r.endContainer; if (n.nodeType === Node.TEXT_NODE) return n.textContent.slice(r.endOffset, r.endOffset + 1); } catch (_) {}
    return '';
  }

  window.BIAIFSession = {
    init:                       init,
    startSession:               startSession,
    stopSession:                stopSession,
    finalizeDemande:            finalizeDemande,
    nextVoiceSegment:           nextVoiceSegment,
    disarm:                     disarm,
    enterEditMode:              enterEditMode,
    exitEditMode:               exitEditMode,
    activeTargetIdx:            activeTargetIdx,
    addRefToTarget:             addRefToTarget,
    addTextToTarget:            addTextToTarget,
    runShotMode:                runShotMode,
    mergeDemandes:              mergeDemandes,
    reorderDemande:             reorderDemande,
    syncCurrentDemandeFromEditor: syncCurrentDemandeFromEditor,
    insertTextAtSelection:      insertTextAtSelection,
    rememberPageUrl:            rememberPageUrl,
    editRef:                    editRef,
  };

})(window);
