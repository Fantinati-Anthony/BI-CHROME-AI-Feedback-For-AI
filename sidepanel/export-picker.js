/**
 * My-Feedbacks Export Picker (v1.11)
 *
 * Per-card "Send to…" menu that lets the user pick among the 9 export
 * targets (Claude / ChatGPT / Cursor / Aider / Mailto / etc.) and
 * fires the right open/clipboard/inject flow.
 *
 * Decorator pattern (like ai-ui.js) — uses MutationObserver to inject
 * a small ↗ button into each segment card without touching the legacy
 * render code.
 *
 * Prompt building :
 *   - Pulls the demande from MyFb.runtime.state (preferred) or legacy
 *     STATE.demandes (fallback)
 *   - Pulls breadcrumbs + network failures from the active tab's
 *     content scripts via chrome.tabs.sendMessage (best-effort, won't
 *     block the export if they're unavailable)
 *   - Composes a Markdown-shaped prompt with the standard MyFb
 *     header / text / refs / metadata sections
 *
 * Export flow per target kind :
 *   url     — window.open(url)
 *   cli     — copies prompt to clipboard, opens deep-link if any
 *   mailto  — window.open(mailto:…)  (prompts to set "to" first time)
 *   inject  — falls through to legacy MyFbExport bridge calls
 *
 * Settings → "Default export target" (saved as `myfb:export:default`)
 * lets the user pick which target the existing 📤 quick-share button
 * uses without opening the menu.
 */

(function (window) {
  'use strict';

  var t = function (k, fb) {
    return (window.MyFb && window.MyFb.utils && window.MyFb.utils.t)
      ? window.MyFb.utils.t(k, fb) : (fb || k);
  };

  var DEFAULT_KEY = 'myfb:export:default';
  var MAILTO_KEY  = 'myfb:export:mailto-to';

  function _toast(m, k, d) {
    if (window.MyFbToast && window.MyFbToast.show) window.MyFbToast.show(m, k || 'info', d || 2200);
  }

  // ── Init ────────────────────────────────────────────────────────────

  function init() {
    var wrap = document.querySelector('#segments') || document.body;
    if (!wrap) return;
    _decorateAll(wrap);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) { if (n && n.nodeType === 1) _decorateAll(n); });
      });
    }).observe(wrap, { childList: true, subtree: true });
  }

  function _decorateAll(root) {
    var cards = (root.querySelectorAll && root.querySelectorAll('.myfb-segment')) || [];
    cards.forEach(_decorate);
    if (root.classList && root.classList.contains('myfb-segment')) _decorate(root);
  }

  function _decorate(card) {
    if (!card || card.__myfbExportDecorated) return;
    card.__myfbExportDecorated = true;
    var actions = card.querySelector('.seg-actions') || card.querySelector('.segment-actions') || card.querySelector('.actions');
    if (!actions) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'myfb-export-btn';
    btn.setAttribute('aria-label', t('card.export_aria', 'Envoyer vers…'));
    btn.title = t('card.export_title', 'Envoyer vers une IA / éditeur / email');
    btn.innerHTML = '↗';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      _openMenu(card, btn);
    });
    actions.insertBefore(btn, actions.firstChild);
  }

  // ── Menu ────────────────────────────────────────────────────────────

  var _menu = null;
  function _openMenu(card, anchor) {
    _close();
    var targets = (window.MyFb.core && window.MyFb.core.exportTargets && window.MyFb.core.exportTargets.TARGETS) || [];
    if (!targets.length) return;
    _menu = document.createElement('div');
    _menu.className = 'myfb-export-menu';
    _menu.innerHTML =
      '<div class="myfb-export-menu-header">' + t('card.export_pick', 'Envoyer vers…') + '</div>' +
      targets.map(function (tg) {
        return '<button type="button" class="myfb-export-menu-item" data-tid="' + tg.id + '">' +
                 '<span class="myfb-export-menu-icon">' + (tg.icon || '◇') + '</span>' +
                 '<span class="myfb-export-menu-label">' + tg.label + '</span>' +
                 '<span class="myfb-export-menu-kind">' + tg.kind + '</span>' +
               '</button>';
      }).join('');
    document.body.appendChild(_menu);
    var rect = anchor.getBoundingClientRect();
    _menu.style.top  = (rect.bottom + 4) + 'px';
    _menu.style.left = Math.max(8, rect.right - _menu.offsetWidth) + 'px';
    _menu.addEventListener('click', function (e) {
      var item = e.target.closest('[data-tid]');
      if (!item) return;
      var tid = item.getAttribute('data-tid');
      _close();
      _runExport(card, tid);
    });
    setTimeout(function () { document.addEventListener('click', _close, { once: true, capture: true }); }, 0);
  }
  function _close() { if (_menu) { _menu.remove(); _menu = null; } }

  // ── Export flow ─────────────────────────────────────────────────────

  function _runExport(card, targetId) {
    var ET = window.MyFb.core && window.MyFb.core.exportTargets;
    var target = ET && ET.byId(targetId);
    if (!target) { _toast(t('card.export_unknown', 'Cible inconnue.'), 'error'); return; }
    var demandeId = card.getAttribute('data-id') || card.dataset.id;
    var demande = _getDemandeForCard(demandeId);
    if (!demande) { _toast(t('card.export_no_demande', 'Demande introuvable.'), 'error'); return; }

    _buildPrompt(demande).then(function (prompt) {
      var opts = {};
      if (target.kind === 'mailto') {
        var to = prompt_or_load_mailto();
        if (to === null) return;  // user cancelled
        opts.to = to;
      }
      var url = ET.buildUrl(targetId, prompt, opts);
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
        _toast(t('card.export_sent', 'Envoyé vers ' + target.label), 'success');
      } else {
        // Clipboard fallback (aider, vscode-copilot, gemini)
        _copyToClipboard(prompt).then(function () {
          _toast(t('card.export_clipboard', 'Prompt copié — collez-le dans ' + target.label + '.'), 'info', 4500);
          if (targetId === 'gemini') {
            window.open(target.build(prompt), '_blank', 'noopener,noreferrer');
          }
        }).catch(function () {
          _toast(t('card.export_clipboard_fail', 'Copie échouée.'), 'error');
        });
      }
    }).catch(function (e) {
      _toast(t('card.export_failed', 'Échec : ' + (e.message || e)), 'error');
    });
  }

  function prompt_or_load_mailto() {
    var saved = '';
    try { saved = localStorage.getItem(MAILTO_KEY) || ''; } catch (_) {}
    var to = prompt(t('card.export_mailto_to', 'Email du destinataire :'), saved);
    if (to === null) return null;
    to = (to || '').trim();
    if (!to) return null;
    try { localStorage.setItem(MAILTO_KEY, to); } catch (_) {}
    return to;
  }

  function _copyToClipboard(s) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(s);
    // legacy fallback
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = s; ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        resolve();
      } catch (e) { reject(e); }
    });
  }

  function _getDemandeForCard(id) {
    var ctx = window.MyFb && window.MyFb.runtime;
    if (ctx && ctx.state && ctx.state.demandes[id]) return ctx.state.demandes[id];
    var STATE = window.MyFbBindings && window.MyFbBindings.ctx && window.MyFbBindings.ctx.STATE;
    if (STATE && Array.isArray(STATE.demandes)) {
      for (var i = 0; i < STATE.demandes.length; i++) {
        if (STATE.demandes[i].id === id) return STATE.demandes[i];
      }
    }
    return null;
  }

  // ── Prompt builder ──────────────────────────────────────────────────

  function _buildPrompt(demande) {
    // Best-effort fetch of breadcrumbs + network failures from active tab.
    return _activeTabContext().then(function (tabCtx) {
      var parts = [];
      parts.push('# My-Feedbacks');
      parts.push('');
      parts.push((demande.text || '').trim() || '(no text)');
      if (demande.url) parts.push('\n**URL :** ' + demande.url);
      var refs = demande.refs || [];
      if (refs.length) {
        parts.push('\n## Références (' + refs.length + ')');
        refs.forEach(function (r, i) {
          parts.push('- **' + (i+1) + '.** [' + r.type + ']' +
                     (r.selector ? ' `' + r.selector + '`' : '') +
                     (r.text ? ' — ' + r.text.slice(0, 100) : ''));
        });
      }
      if (tabCtx.breadcrumbs && tabCtx.breadcrumbs.length) {
        parts.push('\n## Actions récentes (' + tabCtx.breadcrumbs.length + ')');
        tabCtx.breadcrumbs.slice(-10).forEach(function (b) {
          parts.push('- ' + (b.type || '?') + ' · `' + (b.selector || '?') + '`' + (b.text ? ' "' + b.text + '"' : ''));
        });
      }
      if (tabCtx.failures && tabCtx.failures.length) {
        parts.push('\n## Échecs réseau récents (' + tabCtx.failures.length + ')');
        tabCtx.failures.slice(-10).forEach(function (f) {
          parts.push('- ' + (f.method || '?') + ' ' + (f.url || '?') + ' → ' + (f.status || 'err'));
        });
      }
      // Device meta (if available)
      var dm = window.MyFb && window.MyFb.core && window.MyFb.core.deviceMeta;
      if (dm) {
        var meta = dm.collectDeviceMeta();
        parts.push('\n## Appareil');
        parts.push('- ' + (meta.browser ? meta.browser.name + ' ' + meta.browser.version : '?') +
                   ' · ' + (meta.os ? meta.os.name + ' ' + meta.os.version : '?') +
                   ' · ' + (meta.viewport ? meta.viewport.w + '×' + meta.viewport.h : '?'));
      }
      return parts.join('\n');
    });
  }

  function _activeTabContext() {
    return new Promise(function (resolve) {
      var out = { breadcrumbs: [], failures: [] };
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          var tab = tabs && tabs[0];
          if (!tab) return resolve(out);
          // Pull breadcrumbs + network failures in parallel — best-effort.
          var jobs = [
            chrome.tabs.sendMessage(tab.id, { type: 'myfb:breadcrumbs:get' }).then(function (r) {
              if (r && Array.isArray(r.breadcrumbs)) out.breadcrumbs = r.breadcrumbs;
            }).catch(function () {}),
            chrome.tabs.sendMessage(tab.id, { type: 'myfb:network:get' }).then(function (r) {
              if (r && Array.isArray(r.failures)) out.failures = r.failures;
            }).catch(function () {}),
          ];
          Promise.all(jobs).then(function () { resolve(out); });
        });
      } catch (_) { resolve(out); }
    });
  }

  // Public API for tests
  window.MyFbExportPicker = {
    init:               init,
    _buildPrompt:       _buildPrompt,
    _getDemandeForCard: _getDemandeForCard,
  };
})(window);
