/**
 * MyFb Bindings — Runtime messages
 *
 * Handles every chrome.runtime.onMessage that arrives at the side panel:
 *   - ELEMENT_PICKED     (content/element-selector → SW → here)
 *   - PICKER_STATE       (content → here)
 *   - CONSOLE_ERROR      (content → here)
 *   - CONTEXT_*          (background context-menu handlers)
 *   - HOTKEY             (background chrome.commands relay)
 *   - OPEN_WITH_FILTER, START_LINKED_SEGMENT  (content textarea-injector → here)
 *   - AI_STATUS_UPDATE, AI_RESPONSE_DONE      (content/ai-watcher → here)
 *
 * Plus the AI-event matcher (`_matchesAiEvent`) and the high-level
 * AI status / done / linked-session handlers.
 */
(function (window) {
  'use strict';
  window.MyFbBindings = window.MyFbBindings || {};
  var ctx   = window.MyFbBindings.ctx;
  var H     = window.MyFbBindings.helpers;
  var UTILS = (window.MyFb && window.MyFb.utils) || {};
  function _t(k, fb, vars) { return UTILS.t ? UTILS.t(k, fb, vars) : (fb || k); }

  // Match an AI event against an in-flight demande. Three strategies in
  // order of reliability: tabId, exact URL, same hostname.
  function _matchesAiEvent(dem, conversationUrl, tabId) {
    if (dem.status !== 'submitted') return false;
    if (tabId && dem.submittedTabId === tabId) return true;
    if (dem.conversationUrl && dem.conversationUrl === conversationUrl) return true;
    try {
      if (dem.conversationUrl && conversationUrl &&
          new URL(dem.conversationUrl).hostname === new URL(conversationUrl).hostname) return true;
    } catch (_) {}
    return false;
  }

  function onAiStatusUpdate(conversationUrl, status, tabId) {
    if (status !== 'generating') return;
    var matched = ctx.STATE.demandes.some(function (d) {
      return _matchesAiEvent(d, conversationUrl, tabId);
    });
    if (matched) window.MyFbRenderer.renderSegments();
  }

  function onAiResponseDone(conversationUrl, tabId) {
    var STATE = ctx.STATE;
    var matched = false;
    STATE.demandes.forEach(function (dem) {
      if (_matchesAiEvent(dem, conversationUrl, tabId)) {
        dem.status = 'done';
        dem.responseReceivedAt = Date.now();
        matched = true;
      }
    });
    if (!matched) return;
    if (window.MyFbStorage) window.MyFbStorage.persist(STATE);
    window.MyFbRenderer.renderSegments();
    window.MyFbToast.show(_t('toast.ai_response_done', '✓ Réponse reçue !'), 'success', 3500);
  }

  function onOpenWithFilter(conversationUrl, repoId) {
    var STATE = ctx.STATE;
    STATE.conversationFilter = conversationUrl || '';
    if (repoId) STATE.repoFilter = repoId;
    window.MyFbRenderer.renderSegments();
    if (conversationUrl) {
      var label = conversationUrl;
      try { label = new URL(conversationUrl).hostname + new URL(conversationUrl).pathname; } catch (_) {}
      window.MyFbToast.show(_t('toast.filter_applied', 'Filtre : ' + label, { host: label }), 'info', 2500);
    }
  }

  async function onContextNewSegment(text, pageUrl) {
    var STATE = ctx.STATE;
    if (!STATE.armed) await window.MyFbSession.startSession();
    if (text) window.MyFbSession.addTextToTarget(text);
    if (pageUrl && STATE.currentDemande) STATE.currentDemande.pageUrl = pageUrl;
    window.MyFbToast.show(_t('toast.segment_created', 'Nouveau segment créé depuis la sélection.'), 'success', 2500);
  }

  async function onStartLinkedSegment(conversationUrl, repoId) {
    var STATE = ctx.STATE;
    STATE.conversationFilter     = conversationUrl || '';
    STATE.pendingConversationUrl = conversationUrl || null;
    if (repoId) { STATE.repoFilter = repoId; STATE.pendingRepoId = repoId; }
    window.MyFbRenderer.renderSegments();
    if (!STATE.armed) await window.MyFbSession.startSession();
    H.updateLinkedSessionBanner();
    if (conversationUrl) {
      var label = conversationUrl;
      try { label = new URL(conversationUrl).hostname + new URL(conversationUrl).pathname; } catch (_) {}
      window.MyFbToast.show(_t('toast.linked_session_started', 'Session liée à ' + label, { conv: label }), 'success', 3000);
    }
  }

  function onPickerState(active) {
    var STATE = ctx.STATE, REFS = ctx.REFS;
    STATE.pickerActive = active;
    if (!REFS.pickerBtn) return;
    REFS.pickerBtn.classList.toggle('active', active);
    REFS.pickerBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    var lbl = REFS.pickerBtn.querySelector('.label');
    if (lbl) lbl.textContent = active ? _t('tools.picker_active', 'Picker actif') : _t('tools.picker', 'Picker');
  }

  function onElementPicked(msg) {
    var STATE = ctx.STATE;
    var descriptor = msg.descriptor || { selector: '?', tag: null, id: null, classes: [], text: null };
    var ref = {
      type:       'element',
      selector:   descriptor.selector || '?',
      tag:        descriptor.tag   || null,
      id:         descriptor.id    || null,
      classes:    descriptor.classes || [],
      text:       descriptor.text  || null,
      outerHTML:  descriptor.outerHTML || null,
      screenshot: msg.screenshot   || null,
      metadata:   msg.metadata     || null,
      ts:         Date.now(),
    };

    if (STATE.replacingRef) {
      var demKey   = STATE.replacingRef.demKey;
      var refIndex = STATE.replacingRef.refIndex;
      STATE.replacingRef = null;
      var target = (demKey === 'current') ? STATE.currentDemande : STATE.demandes[demKey];
      if (target && target.refs && target.refs[refIndex]) {
        target.refs[refIndex] = ref;
        if (demKey === 'current') window.MyFbRenderer.renderDemandeEditor();
        else window.MyFbRenderer.renderSegments();
        window.MyFbStorage.persist(STATE);
        window.MyFbToast.show(
          _t('toast.ref_updated', 'Référence #' + (refIndex + 1) + ' mise à jour',
            { n: refIndex + 1, label: H.shortLabel(descriptor) }),
          'success');
      }
      if (!STATE.armed) H.sendBg({ type: H.msgKey('PICKER_DISABLE') });
      return;
    }

    var tIdx = window.MyFbSession.activeTargetIdx();
    window.MyFbSession.addRefToTarget(ref);
    window.MyFbToast.show(
      typeof tIdx === 'number'
        ? _t('toast.element_added', 'Élément ajouté à #' + (tIdx + 1),
            { n: tIdx + 1, label: H.shortLabel(descriptor) })
        : _t('toast.ref_added', 'Référence ajoutée', { label: H.shortLabel(descriptor) }),
      'success');
    STATE.modalTarget = 'current';
  }

  function bind() {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (!msg || typeof msg.type !== 'string') return;
      var T = H.msgKey;
      if (msg.type === T('ELEMENT_PICKED'))    { onElementPicked(msg); return; }
      if (msg.type === T('PICKER_STATE'))      { onPickerState(!!msg.active); return; }
      if (msg.type === T('CONSOLE_ERROR'))     { H.onConsoleError(msg.error); return; }
      if (msg.type === T('CONTEXT_STATUS'))    { window.MyFbToast.show(msg.msg, 'info'); return; }
      if (msg.type === T('CONTEXT_SHOT'))      { window.MyFbSession.runShotMode(msg.mode); return; }
      if (msg.type === T('CONTEXT_ADD_TEXT'))  { H.addTextFromContext(msg.text, msg.pageUrl); return; }
      if (msg.type === T('CONTEXT_ADD_IMAGE')) { H.addImageFromContext(msg.srcUrl, msg.pageUrl); return; }
      if (msg.type === T('CONTEXT_NEW_SEGMENT')) { onContextNewSegment(msg.text, msg.pageUrl); return; }
      if (msg.type === T('CONTEXT_APPEND_TEXT')) { H.addTextFromContext(msg.text, msg.pageUrl); return; }
      if (msg.type === T('HOTKEY')) {
        if (msg.action === 'toggle-mic')  window.MyFbSpeech.toggleMic();
        if (msg.action === 'copy-prompt') window.MyFbExport.copyPrompt();
        return;
      }
      if (msg.type === T('OPEN_WITH_FILTER')) {
        onOpenWithFilter(msg.conversationUrl || msg.filterUrl, msg.repoId || null);
        return;
      }
      if (msg.type === T('START_LINKED_SEGMENT')) {
        onStartLinkedSegment(msg.conversationUrl, msg.repoId || null);
        return;
      }
      if (msg.type === T('AI_STATUS_UPDATE')) {
        onAiStatusUpdate(msg.conversationUrl, msg.status, msg.tabId);
        return;
      }
      if (msg.type === T('AI_RESPONSE_DONE')) {
        onAiResponseDone(msg.conversationUrl, msg.tabId);
        return;
      }
    });
  }

  window.MyFbBindings.messages = {
    bind:                bind,
    onAiStatusUpdate:    onAiStatusUpdate,
    onAiResponseDone:    onAiResponseDone,
    onOpenWithFilter:    onOpenWithFilter,
    onStartLinkedSegment: onStartLinkedSegment,
    onContextNewSegment: onContextNewSegment,
    onPickerState:       onPickerState,
    onElementPicked:     onElementPicked,
  };
})(window);
