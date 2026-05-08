/**
 * BIAIF Export
 * Markdown prompt generation, clipboard copy, and file download.
 */
(function (window) {
  'use strict';

  var STATE, REFS;

  function init(state, refs) {
    STATE = state;
    REFS  = refs;
  }

  // -----------------------------------------------------------------------
  // Inline human rendering  ({{ref:N}} → readable label)
  // -----------------------------------------------------------------------
  function renderInlineHuman(text, refs) {
    return (text || '').replace(/\{\{ref:(\d+)\}\}/g, function (_, n) {
      var i = Number(n);
      var r = refs[i];
      if (!r) return '[ref #' + (i + 1) + ']';
      if (r.type === 'screenshot') return '[#' + (i + 1) + ' capture' + (r.mode ? ' ' + r.mode : '') + ']';
      if (r.type === 'error')      return '[#' + (i + 1) + ' erreur: ' + (r.msg || '').slice(0, 80) + ']';
      return '[#' + (i + 1) + ' ' + (r.selector || r.tag || '?') + ']';
    }).replace(/\s+/g, ' ').trim();
  }

  // -----------------------------------------------------------------------
  // Prompt builder
  // -----------------------------------------------------------------------
  function buildPrompt(opts) {
    opts = opts || {};
    var lines = [];
    lines.push('# Demandes utilisateur');
    lines.push('');
    lines.push('> Chaque demande est une instruction unique exprimée en langage naturel, avec des références numérotées `[#N]` insérées inline. Les références sont détaillées en dessous (élément cliqué ou capture d\'écran).');
    lines.push('');

    if (!STATE.demandes.length) {
      lines.push('_Aucune demande._');
      return lines.join('\n');
    }

    STATE.demandes.forEach(function (dem, di) {
      var num = di + 1;
      lines.push('## Demande #' + num);
      lines.push('');
      if (dem.url) lines.push('**Page :** ' + dem.url);
      lines.push('');
      lines.push('**Instruction :**');
      lines.push('');
      lines.push('> ' + renderInlineHuman(dem.text, dem.refs || []));
      lines.push('');

      var refs = dem.refs || [];
      if (refs.length) {
        lines.push('**Références :**');
        lines.push('');
        refs.forEach(function (r, i) {
          var refNum = i + 1;
          if (r.type === 'screenshot') {
            var fileName = 'dem' + num + '-ref' + refNum + '.png';
            lines.push('- **#' + refNum + ' — capture (' + (r.mode || 'visible') + ')**');
            if (opts.inlineImages && r.dataUrl) lines.push('  ![capture #' + refNum + '](' + r.dataUrl + ')');
            else lines.push('  📷 Voir `' + fileName + '` (à joindre avec ce prompt).');
          } else if (r.type === 'error') {
            lines.push('- **#' + refNum + ' — erreur JavaScript**');
            if (r.msg)  lines.push('  - message : ' + r.msg);
            if (r.file) lines.push('  - fichier : `' + r.file + ':' + (r.line || '?') + (r.col ? ':' + r.col : '') + '`');
            if (r.url)  lines.push('  - page : ' + r.url);
            if (r.stack) {
              var fence = _pickFence(r.stack);
              lines.push('');
              lines.push('  ' + fence);
              r.stack.split('\n').forEach(function (ln) { lines.push('  ' + ln); });
              lines.push('  ' + fence);
            }
          } else {
            lines.push('- **#' + refNum + ' — élément**');
            if (r.selector)        lines.push('  - sélecteur : `' + r.selector + '`');
            if (r.tag)             lines.push('  - tag : `<' + r.tag + '>`');
            if (r.id)              lines.push('  - id : `' + r.id + '`');
            if (r.classes && r.classes.length) lines.push('  - classes : `' + r.classes.join(' ') + '`');
            if (r.text)            lines.push('  - texte : « ' + r.text + ' »');
            if (r.outerHTML) {
              var hfence = _pickFence(r.outerHTML);
              lines.push('');
              lines.push('  ' + hfence + 'html');
              r.outerHTML.split('\n').forEach(function (ln) { lines.push('  ' + ln); });
              lines.push('  ' + hfence);
            }
          }
          lines.push('');
        });
      }
    });

    lines.push('---');
    lines.push('Pour chaque demande, propose un plan groupé puis applique. Si plusieurs demandes touchent les mêmes fichiers/composants, déduplique.');
    return lines.join('\n');
  }

  function buildPromptForDemande(idx) {
    var single = STATE.demandes[idx];
    if (!single) return '';
    var saved  = STATE.demandes;
    STATE.demandes = [single];
    try { return buildPrompt({ inlineImages: false }); }
    finally { STATE.demandes = saved; }
  }

  // -----------------------------------------------------------------------
  // Copy
  // -----------------------------------------------------------------------
  async function copyPrompt() {
    var text = buildPrompt({ inlineImages: false });
    try {
      await navigator.clipboard.writeText(text);
      _toast(_t('toast.copy_paste_full', 'Prompt copié — collez dans Claude Code et drag-droppez les screenshots.'), 'success');
    } catch (e) {
      _toast(_t('toast.copy_fail', 'Copie impossible : ' + e.message, { err: e.message }), 'error');
    }
  }

  async function copyPromptForDemande(idx) {
    var text = buildPromptForDemande(idx);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      _toast(_t('toast.copied_demande', 'Prompt de la demande #' + (idx + 1) + ' copié.', { n: idx + 1 }), 'success');
    } catch (e) {
      _toast(_t('toast.copy_fail', 'Copie impossible : ' + e.message, { err: e.message }), 'error');
    }
  }

  // Helper: copy prompt + open URL in a new tab.
  async function _copyAndOpen(idx, url, name) {
    var text = buildPromptForDemande(idx);
    if (!text) { _toast(_t('toast.nothing_to_send', 'Rien à envoyer pour cette demande.'), 'info'); return; }
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      _toast(_t('toast.copy_fail', 'Copie impossible : ' + e.message, { err: e.message }), 'error');
      return;
    }
    try {
      if (chrome && chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url: url });
      else window.open(url, '_blank', 'noopener');
    } catch (_) {
      try { window.open(url, '_blank', 'noopener'); } catch (__) {}
    }
    _toast(_t('toast.copy_paste_into', 'Prompt copié — collez-le dans ' + name, { name: name }), 'success');
    _stampSubmitted(STATE.demandes[idx], name);
  }

  function openInClaudeOnline(idx) { return _copyAndOpen(idx, 'https://claude.ai/new',          'Claude.ai'); }
  function openInChatgpt(idx)      { return _copyAndOpen(idx, 'https://chatgpt.com/',           'ChatGPT'); }
  function openInGemini(idx)       { return _copyAndOpen(idx, 'https://gemini.google.com/app',  'Gemini'); }
  function openInPerplexity(idx)   { return _copyAndOpen(idx, 'https://www.perplexity.ai/',     'Perplexity'); }
  function openInGrok(idx)         { return _copyAndOpen(idx, 'https://grok.com/',              'Grok'); }
  function openInLechat(idx)       { return _copyAndOpen(idx, 'https://chat.mistral.ai/chat',   'Le Chat'); }
  function openInDeepseek(idx)     { return _copyAndOpen(idx, 'https://chat.deepseek.com/',     'DeepSeek'); }

  // -----------------------------------------------------------------------
  // Download
  // -----------------------------------------------------------------------
  async function downloadBundle() {
    if (!STATE.demandes.length) { _toast(_t('toast.nothing_to_download', 'Rien à télécharger.'), 'info'); return; }
    var text = buildPrompt({ inlineImages: false });
    _downloadFile('biaif-prompt.md', new Blob([text], { type: 'text/markdown' }));
    var imgCount = 0;
    for (var di = 0; di < STATE.demandes.length; di++) {
      var refs = STATE.demandes[di].refs || [];
      for (var ri = 0; ri < refs.length; ri++) {
        var r = refs[ri];
        if (r.type !== 'screenshot' || !r.dataUrl) continue;
        _downloadFile('dem' + (di + 1) + '-ref' + (ri + 1) + '.png', await _dataUrlToBlob(r.dataUrl));
        imgCount++;
      }
    }
    _toast(_t('toast.bundle_downloaded', 'Prompt + ' + imgCount + ' capture(s) téléchargés.', { n: imgCount }), 'success');
  }

  async function downloadDemande(idx) {
    var dem = STATE.demandes[idx];
    if (!dem) return;
    _downloadFile('biaif-demande-' + (idx + 1) + '.md', new Blob([buildPromptForDemande(idx)], { type: 'text/markdown' }));
    var imgCount = 0;
    var refs = dem.refs || [];
    for (var ri = 0; ri < refs.length; ri++) {
      var r = refs[ri];
      if (r.type !== 'screenshot' || !r.dataUrl) continue;
      _downloadFile('biaif-demande-' + (idx + 1) + '-ref' + (ri + 1) + '.png', await _dataUrlToBlob(r.dataUrl));
      imgCount++;
    }
    _toast(imgCount
      ? _t('toast.demande_downloaded_with', 'Demande #' + (idx + 1) + ' téléchargée (+ ' + imgCount + ' capture(s)).', { n: idx + 1, imgs: imgCount })
      : _t('toast.demande_downloaded', 'Demande #' + (idx + 1) + ' téléchargée.', { n: idx + 1 }),
      'success');
  }

  // -----------------------------------------------------------------------
  // Inject into Claude.ai editor (drag-and-drop simulation)
  // -----------------------------------------------------------------------
  async function injectToCopilot(idx) {
    return _injectVscodeBridge(idx, 'copilot', _t('btn.copilot', 'VS-Code GH for Copilot'));
  }

  async function injectToVscode(idx) {
    return _injectVscodeBridge(idx, 'vscode', _t('btn.vscode', 'VS-Code Terminal'));
  }

  async function _injectVscodeBridge(idx, target, label) {
    var dem = STATE.demandes[idx];
    if (!dem) return;

    var port   = (window.BIAIF && window.BIAIF.VSCODE_BRIDGE_PORT) || 51473;
    var text   = buildPromptForDemande(idx);
    var images = (dem.refs || []).filter(function (r) { return r.type === 'screenshot' && r.dataUrl; }).map(function (r) { return r.dataUrl; });
    var total  = (text ? 1 : 0) + images.length;

    if (!total) { _toast(_t('toast.nothing_to_send', 'Rien à envoyer pour cette demande.'), 'info'); return; }

    _toast(_t('toast.bridge_connecting', 'Connexion au bridge ' + label + '…', { label: label }), 'info');
    _updateProgress(0, total, 'Ping bridge…');

    try {
      var pingCtrl  = new AbortController();
      var pingTimer = setTimeout(function () { pingCtrl.abort(); }, 3000);
      try {
        var pingResp = await fetch('http://127.0.0.1:' + port + '/ping', { signal: pingCtrl.signal });
        clearTimeout(pingTimer);
        if (!pingResp.ok) throw new Error('bridge HTTP ' + pingResp.status);
      } catch (pingErr) {
        clearTimeout(pingTimer);
        _hideProgress();
        _toast(
          _t('toast.bridge_offline', "Bridge VS Code introuvable (port " + port + "). Installez l'extension BIAIF dans VS Code.", { port: port }),
          'error', 8000,
        );
        return;
      }

      _updateProgress(0, total, 'Envoi vers ' + label + '…');

      var resp = await fetch('http://127.0.0.1:' + port + '/inject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: target, text: text, images: images }),
      });
      if (!resp.ok) throw new Error('bridge HTTP ' + resp.status);
      var result;
      try {
        result = await resp.json();
      } catch (parseErr) {
        throw new Error(_t('err.bridge_invalid_json', 'réponse bridge invalide (JSON malformé)'));
      }
      result = result || {};

      _updateProgress(total, total, 'Envoyé !');
      setTimeout(_hideProgress, 1400);

      if (result.error) throw new Error(result.error);

      var imgInfo = images.length ? ' + ' + images.length + ' image(s)' : '';
      _toast(_t('toast.bridge_sent', 'Demande #' + (idx + 1) + ' → ' + label + imgInfo + '.', { n: idx + 1, label: label, imgs: imgInfo }), 'success');
      _stampSubmitted(STATE.demandes[idx], label);

    } catch (e) {
      _hideProgress();
      _toast(_t('toast.bridge_fail', 'Erreur ' + label + ' bridge : ' + (e && e.message || String(e)), { label: label, err: (e && e.message || String(e)) }), 'error');
    }
  }

  // -----------------------------------------------------------------------
  // Inject into VS Code via local bridge (localhost:VSCODE_BRIDGE_PORT)
  // -----------------------------------------------------------------------

  async function injectDemande(idx) {
    var dem = STATE.demandes[idx];
    if (!dem) return;
    var text   = buildPromptForDemande(idx);
    var images = (dem.refs || []).filter(function (r) { return r.type === 'screenshot' && r.dataUrl; }).map(function (r) { return r.dataUrl; });
    var total  = (text ? 1 : 0) + images.length;

    if (!total) { _toast(_t('toast.nothing_to_inject', 'Rien à injecter dans cette demande.'), 'info'); return; }

    var hasTarget = !!(dem.conversationUrl);
    _toast(_t(hasTarget ? 'toast.injecting_to_conv' : 'toast.injecting', hasTarget ? "Ouverture de la conversation et injection…" : "Injection en cours dans l'éditeur Claude Code…"), 'info');
    _updateProgress(0, total, hasTarget ? 'Ouverture de la conversation…' : 'Connexion à l\'éditeur…');

    try {
      var resp = await new Promise(function (resolve, reject) {
        chrome.runtime.sendMessage({
          type:        window.BIAIF.MSG.INJECT_TO_EDITOR,
          text:        text,
          images:      images,
          targetUrl:   dem.conversationUrl || null,
          autoSubmit:  !!(STATE.autoSubmitAfterInject),
        }, function (r) {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(r || {});
        });
      });
      _updateProgress(total, total, 'Terminé');
      setTimeout(_hideProgress, 1200);
      if (resp.error) {
        _toast(_t('toast.inject_fail', 'Injection impossible : ' + resp.error, { err: resp.error }), 'error');
      } else {
        var imgInfo = images.length ? ' + ' + images.length + ' image(s)' : '';
        _toast(_t('toast.injected', 'Demande #' + (idx + 1) + ' injectée' + imgInfo + '.', { n: idx + 1, imgs: imgInfo }), 'success');
        var dem = STATE.demandes[idx];
        if (dem) {
          if (resp.targetTabId) dem.submittedTabId = resp.targetTabId;
          // Update conversationUrl from actual tab URL so AI_RESPONSE_DONE can match
          if (resp.tabUrl && !dem.conversationUrl) dem.conversationUrl = resp.tabUrl;
        }
        _stampSubmitted(dem, 'Claude Code');
      }
    } catch (e) {
      _hideProgress();
      _toast(_t('toast.inject_fail_generic', 'Injection échouée : ' + (e && e.message || String(e)), { err: (e && e.message || String(e)) }), 'error');
    }
  }

  function _updateProgress(current, total, label) {
    var el  = document.getElementById('capture-progress');
    var bar = el && el.querySelector('.capture-progress-bar');
    var lbl = el && el.querySelector('.capture-progress-label');
    if (!el) return;
    el.hidden = false;
    if (bar) bar.style.width = (total > 0 ? Math.round((current / total) * 100) : 0) + '%';
    if (lbl) lbl.textContent = label || '';
  }

  function _hideProgress() {
    var el = document.getElementById('capture-progress');
    if (el) { el.hidden = true; var bar = el.querySelector('.capture-progress-bar'); if (bar) bar.style.width = '0%'; }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  function _downloadFile(name, blob) {
    var url = URL.createObjectURL(blob);
    var a   = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function _dataUrlToBlob(dataUrl) { return fetch(dataUrl).then(function (r) { return r.blob(); }); }

  function _pickFence(s) {
    var runs = String(s).match(/`+/g) || [];
    var max  = 0;
    runs.forEach(function (r) { if (r.length > max) max = r.length; });
    return '`'.repeat(Math.max(3, max + 1));
  }

  function _stampSubmitted(dem, submittedTo) {
    if (!dem) return;
    dem.status      = 'submitted';
    dem.submittedAt = Date.now();
    dem.submittedTo = submittedTo;
    if (window.BIAIFStorage) window.BIAIFStorage.persist(STATE);
    if (window.BIAIFRenderer) window.BIAIFRenderer.renderSegments();
  }

  function _toast(msg, kind, dur) {
    if (window.BIAIFToast) window.BIAIFToast.show(msg, kind, dur);
  }
  function _t(key, fallback, vars) {
    if (window.BIAIFi18n && window.BIAIFi18n.t) {
      var v = window.BIAIFi18n.t(key, vars);
      if (v && v !== key) return v;
    }
    return fallback || key;
  }

  window.BIAIFExport = {
    init: init,
    buildPrompt: buildPrompt,
    buildPromptForDemande: buildPromptForDemande,
    copyPrompt: copyPrompt,
    copyPromptForDemande: copyPromptForDemande,
    downloadBundle: downloadBundle,
    downloadDemande: downloadDemande,
    injectDemande: injectDemande,
    injectToVscode: injectToVscode,
    injectToCopilot: injectToCopilot,
    openInClaudeOnline: openInClaudeOnline,
    openInChatgpt: openInChatgpt,
    openInGemini: openInGemini,
    openInPerplexity: openInPerplexity,
    openInGrok: openInGrok,
    openInLechat: openInLechat,
    openInDeepseek: openInDeepseek,
  };

})(window);
