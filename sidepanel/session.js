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
      if (resp && resp.error) _toast('Picker KO : ' + _decodeErr(resp.error), 'error');
    }
    if (!STATE.micActive) await window.BIAIFSpeech.startMic();
    _toast('Session démarrée.', 'success');
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
    _toast('Session arrêtée — ' + STATE.demandes.length + ' demande(s) capturée(s).', 'info');
  }

  function finalizeDemande(silent) {
    if (STATE.editingDemandeIdx !== null) { exitEditMode(); return; }
    syncCurrentDemandeFromEditor();
    var text    = STATE.currentDemande.text, refs = STATE.currentDemande.refs;
    var cleaned = (text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned && !refs.length) {
      if (!silent) _toast('Rien à finaliser — parlez ou ajoutez une référence.', 'info');
      return;
    }
    STATE.demandes.push({
      id:   'dem-' + Date.now(),
      ts:   Date.now(),
      text: cleaned,
      refs: refs.slice(),
      url:  STATE.currentDemande.pageUrl || null,
    });
    STATE.currentDemande = { text: '', refs: [], pageUrl: null };
    if (REFS.demandeEditor) REFS.demandeEditor.innerHTML = '';
    window.BIAIFRenderer.renderDemandeRefsStrip();
    window.BIAIFRenderer.renderSegments();
    window.BIAIFRenderer.updateArmedUi();
    window.BIAIFStorage.persist(STATE);
    if (!silent) _toast('Demande #' + STATE.demandes.length + ' finalisée.', 'success');
  }

  // nextVoiceSegment is the legacy alias for finalizeDemande
  function nextVoiceSegment() { finalizeDemande(false); }

  // -----------------------------------------------------------------------
  // Edit mode
  // -----------------------------------------------------------------------
  function enterEditMode(idx) {
    if (idx == null || idx === STATE.editingDemandeIdx) return;
    if (STATE.editingDemandeIdx !== null) exitEditMode({ silent: true });
    window.BIAIFSpeech.clearInterimGhost();
    STATE.editingDemandeIdx = idx;
    STATE.dictationTarget   = idx;
    STATE.modalTarget       = 'current';
    if (!STATE.micActive) window.BIAIFSpeech.startMic();
    if (!STATE.pickerActive) _sendBg({ type: _MSG('PICKER_ENABLE') });
    window.BIAIFRenderer.renderSegments();
    window.BIAIFRenderer.updateArmedUi();
    setTimeout(function () {
      var card   = document.querySelector('.biaif-segment[data-i="' + idx + '"]');
      if (card)  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      var textEl = document.querySelector('.demande-text[data-i="' + idx + '"]');
      if (textEl) textEl.focus();
    }, 30);
    _toast('Édition de la demande #' + (idx + 1) + ' — voix, picker, capture s\'y insèrent.', 'info', 3000);
  }

  function exitEditMode(opts) {
    if (STATE.editingDemandeIdx === null) return;
    window.BIAIFSpeech.clearInterimGhost();
    STATE.editingDemandeIdx = null;
    STATE.dictationTarget   = 'current';
    if (!STATE.armed && STATE.pickerActive) _sendBg({ type: _MSG('PICKER_DISABLE') });
    window.BIAIFRenderer.renderSegments();
    window.BIAIFRenderer.updateArmedUi();
    if (!opts || !opts.silent) _toast('Mode édition terminé.', 'info');
  }

  // -----------------------------------------------------------------------
  // Ref routing
  // -----------------------------------------------------------------------
  function activeTargetIdx() {
    if (typeof STATE.editingDemandeIdx === 'number') return STATE.editingDemandeIdx;
    if (typeof STATE.modalTarget       === 'number') return STATE.modalTarget;
    return null;
  }

  function addRefToTarget(ref) {
    var idx = activeTargetIdx();
    if (typeof idx === 'number') {
      var dem = STATE.demandes[idx];
      if (!dem) return false;
      dem.refs = dem.refs || [];
      dem.refs.push(ref);
      var newIdx = dem.refs.length - 1;
      var cur    = (dem.text || '').replace(/\s+$/, '');
      dem.text   = (cur + (cur ? ' ' : '') + '{{ref:' + newIdx + '}} ').replace(/\s{2,}/g, ' ');
      window.BIAIFRenderer.renderSegments();
      window.BIAIFStorage.persist(STATE);
      return true;
    }
    STATE.currentDemande.refs.push(ref);
    var absIdx = STATE.currentDemande.refs.length - 1;
    window.BIAIFRenderer.appendChipToEditor(absIdx, ref);
    rememberPageUrl();
    window.BIAIFRenderer.updateMasterBtnLabel();
    return true;
  }

  function addTextToTarget(text) {
    if (!text) return;
    var idx = activeTargetIdx();
    if (typeof idx === 'number') {
      var dem    = STATE.demandes[idx];
      if (!dem) return;
      var textEl = document.querySelector('.demande-text[data-i="' + idx + '"]');
      if (textEl) {
        insertTextAtSelection(textEl, text);
        syncDemandeFromTextEl(textEl, dem);
      } else {
        var cur = dem.text || '';
        dem.text = (cur + (cur && !/\s$/.test(cur) ? ' ' : '') + text.trim() + ' ').replace(/\s{2,}/g, ' ');
        window.BIAIFRenderer.renderSegments();
      }
      window.BIAIFStorage.persist(STATE);
      return;
    }
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
    _toast('Capture (' + mode + ')…', 'info', 2000);
    var resp = await _sendBg({ type: _MSG('CAPTURE_MODE'), mode: mode });
    if (!resp || resp.error || !resp.dataUrl) {
      _toast('Capture KO : ' + _decodeErr(resp ? (resp.error || 'pas de dataUrl') : 'pas de réponse'), 'error');
      return;
    }
    STATE.lastShot     = resp.dataUrl;
    STATE.lastShotMode = mode;
    var ref  = { type: 'screenshot', mode: mode, dataUrl: resp.dataUrl, ts: Date.now() };
    var tIdx = activeTargetIdx();
    addRefToTarget(ref);
    _toast(typeof tIdx === 'number'
      ? 'Capture ' + mode + ' ajoutée à la demande #' + (tIdx + 1)
      : 'Capture ' + mode + ' OK — ajoutée comme référence', 'success');
    STATE.modalTarget = 'current';
  }

  // -----------------------------------------------------------------------
  // Merge
  // -----------------------------------------------------------------------
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
    _toast('Demandes fusionnées dans #' + newNum + '.', 'success');
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
      if (!ref.dataUrl) { _toast('Capture indisponible (cache local).', 'error'); return; }
      _toast("Annotateur ouvert dans l'onglet actif…", 'info', 2000);
      var resp = await _sendBg({ type: _MSG('ANNOTATE'), dataUrl: ref.dataUrl });
      if (!resp || resp.cancelled) { _toast('Annotation annulée.', 'info'); return; }
      if (resp.error || !resp.dataUrl) { _toast('Annotation KO : ' + _decodeErr(resp.error || 'no result'), 'error'); return; }
      ref.dataUrl = resp.dataUrl;
      if (demKey === 'current') window.BIAIFRenderer.renderDemandeEditor();
      else window.BIAIFRenderer.renderSegments();
      window.BIAIFStorage.persist(STATE);
      _toast('Référence #' + (refIndex + 1) + ' : annotation enregistrée.', 'success');
      return;
    }
    STATE.replacingRef = { demKey: demKey, refIndex: refIndex };
    var r2 = await _sendBg({ type: _MSG('PICKER_ENABLE') });
    if (r2 && r2.error) {
      STATE.replacingRef = null;
      _toast('Picker KO : ' + _decodeErr(r2.error), 'error');
      return;
    }
    _toast('Cliquez un élément pour remplacer la référence #' + (refIndex + 1) + '…', 'info', 4000);
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
  function _updateMasterBtn() { if (window.BIAIFRenderer) window.BIAIFRenderer.updateMasterBtnLabel(); }
  function _updateArmedUi()   { if (window.BIAIFRenderer) window.BIAIFRenderer.updateArmedUi(); }
  function _toast(m, k, d)    { if (window.BIAIFToast) window.BIAIFToast.show(m, k, d); }
  function _sendBg(payload)   { return chrome.runtime.sendMessage(payload).catch(function () { return null; }); }
  function _MSG(key)          { return window.BIAIF && window.BIAIF.MSG ? window.BIAIF.MSG[key] : 'biaif:' + key.toLowerCase().replace(/_/g, '-'); }
  function _decodeErr(e) {
    var s = typeof e === 'string' ? e : (e && e.message || String(e));
    if (s.includes('Receiving end does not exist') || s.includes('Could not establish connection'))
      return "content script pas prêt — rechargez l'onglet";
    return s;
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
    enterEditMode:              enterEditMode,
    exitEditMode:               exitEditMode,
    activeTargetIdx:            activeTargetIdx,
    addRefToTarget:             addRefToTarget,
    addTextToTarget:            addTextToTarget,
    runShotMode:                runShotMode,
    mergeDemandes:              mergeDemandes,
    syncCurrentDemandeFromEditor: syncCurrentDemandeFromEditor,
    syncDemandeFromTextEl:      syncDemandeFromTextEl,
    insertTextAtSelection:      insertTextAtSelection,
    rememberPageUrl:            rememberPageUrl,
    editRef:                    editRef,
  };

})(window);
