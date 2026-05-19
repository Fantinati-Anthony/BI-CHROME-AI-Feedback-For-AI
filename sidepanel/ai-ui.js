/**
 * My-Feedbacks AI UI Controller
 *
 * Glue between the user-facing UI (Settings section, segment-card AI
 * buttons) and the headless `MyFb.core.aiClient` + `MyFbTriage` APIs.
 *
 * Responsibilities:
 *   1. Wire the Settings → AI section : API key input, model picker,
 *      "Test connection" button. Persists via aiClient.setApiKey /
 *      setModel.
 *   2. Wire per-segment-card buttons (✨ menu) for "Summarize" and
 *      "Suggest triage". Calls aiClient.summarize / suggestTriage and
 *      pipes the result through MyFbTriage on apply.
 *   3. Display loading / success / error toasts.
 *
 * Uses MutationObserver to decorate segment cards as they appear,
 * since we don't want to fork sidepanel/render/segment-card.js for
 * v1.0 — keeps the integration purely additive.
 */

(function (window) {
  'use strict';

  var t = function (k, fb) {
    return (window.MyFb && window.MyFb.utils && window.MyFb.utils.t)
      ? window.MyFb.utils.t(k, fb) : (fb || k);
  };

  function _toast(msg, kind, duration) {
    if (window.MyFbToast && window.MyFbToast.show) {
      window.MyFbToast.show(msg, kind || 'info', duration || 2200);
    }
  }

  // ── Settings panel wiring ──────────────────────────────────────────

  function initSettingsPanel() {
    document.addEventListener('input',  _onSettingsInput,  true);
    document.addEventListener('change', _onSettingsInput,  true);
    document.addEventListener('click',  _onSettingsClick,  true);
    _hydrateSettings();
  }

  function _hydrateSettings() {
    var ai = window.MyFb && window.MyFb.core && window.MyFb.core.aiClient;
    if (!ai) return;
    ai.getApiKey().then(function (key) {
      var inp = document.querySelector('[data-myfb-ai-key]');
      if (inp) inp.value = key || '';
      _updateConfiguredBadge(!!key);
    }).catch(function () {});
    ai.getModel().then(function (model) {
      var sel = document.querySelector('[data-myfb-ai-model]');
      if (sel) sel.value = model;
    }).catch(function () {});
  }

  function _updateConfiguredBadge(isConfigured) {
    document.querySelectorAll('.myfb-ai-status-badge').forEach(function (b) {
      b.classList.toggle('is-configured', isConfigured);
      b.textContent = isConfigured
        ? t('settings.ai.configured', 'Configurée ✓')
        : t('settings.ai.not_configured', 'Non configurée');
    });
  }

  function _onSettingsInput(e) {
    var inp = e.target;
    if (!inp || !inp.getAttribute) return;
    var ai = window.MyFb && window.MyFb.core && window.MyFb.core.aiClient;
    if (!ai) return;
    if (inp.hasAttribute('data-myfb-ai-key')) {
      // Debounce save by 600ms so we don't spam storage on every keystroke
      clearTimeout(inp.__myfbDebounce);
      inp.__myfbDebounce = setTimeout(function () {
        ai.setApiKey(inp.value || '').then(function () {
          _updateConfiguredBadge(!!(inp.value || '').trim());
        });
      }, 600);
    } else if (inp.hasAttribute('data-myfb-ai-model')) {
      ai.setModel(inp.value).catch(function () {});
    }
  }

  function _onSettingsClick(e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-act=test-ai]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    _testConnection(btn);
  }

  function _testConnection(btn) {
    var ai = window.MyFb && window.MyFb.core && window.MyFb.core.aiClient;
    if (!ai) return;
    btn.disabled = true;
    var orig = btn.textContent;
    btn.textContent = t('settings.ai.testing', 'Test en cours…');
    ai.complete('Reply with the single word OK.', { maxTokens: 10 }).then(function (out) {
      var ok = /\bok\b/i.test(out);
      _toast(
        ok ? t('settings.ai.test_ok', 'Connexion OK !') : t('settings.ai.test_strange', 'Réponse inattendue : ' + out.slice(0, 60)),
        ok ? 'success' : 'warning',
        ok ? 2000 : 4000
      );
    }).catch(function (err) {
      var msg = err && err.code === 'NO_KEY'
        ? t('settings.ai.no_key', 'Aucune clé API configurée.')
        : err && err.code === 'RATE_LIMIT'
          ? t('settings.ai.rate_limit', 'Limite atteinte — réessayez plus tard.')
          : t('settings.ai.test_fail', 'Échec : ' + ((err && err.message) || err));
      _toast(msg, 'error', 4500);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = orig;
    });
  }

  // ── Segment-card AI button decorator ────────────────────────────────

  /**
   * Observe the segments wrapper for new cards, then inject the AI ✨
   * button into each card's action area. Idempotent per card.
   */
  function initCardDecorator() {
    var wrap = document.querySelector('#segments') || document.body;
    if (!wrap) return;
    _decorateAll(wrap);
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n && n.nodeType === 1) _decorateAll(n);
        }
      }
    });
    mo.observe(wrap, { childList: true, subtree: true });
  }

  function _decorateAll(root) {
    var cards = (root.querySelectorAll && root.querySelectorAll('.myfb-segment')) || [];
    cards.forEach(_decorateCard);
    if (root.classList && root.classList.contains('myfb-segment')) _decorateCard(root);
  }

  function _decorateCard(card) {
    if (!card || card.__myfbAiDecorated) return;
    card.__myfbAiDecorated = true;
    // The legacy card layout has different possible action containers;
    // we try a few before giving up gracefully.
    var actions = card.querySelector('.seg-actions') ||
                  card.querySelector('.segment-actions') ||
                  card.querySelector('.actions');
    if (!actions) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'myfb-ai-btn';
    btn.setAttribute('aria-label', t('card.ai_menu_aria', 'Actions IA'));
    btn.title = t('card.ai_menu_title', 'Actions IA (résumé, suggestion de triage)');
    btn.innerHTML = '✨';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      _openMenu(card, btn);
    });
    actions.insertBefore(btn, actions.firstChild);
  }

  // Singleton menu (only one open at a time)
  var _menu = null;
  function _openMenu(card, anchor) {
    _closeMenu();
    var demandeId = card.getAttribute('data-id') || card.dataset.id;
    if (!demandeId) {
      _toast(t('card.ai_no_id', 'Carte sans identifiant — ignorée.'), 'warning');
      return;
    }
    _menu = document.createElement('div');
    _menu.className = 'myfb-ai-menu';
    _menu.innerHTML =
      '<button type="button" class="myfb-ai-menu-item" data-act="ai-summarize">' +
        '<span class="myfb-ai-menu-icon" aria-hidden="true">📝</span>' +
        t('card.ai_summarize', 'Résumer cette demande') +
      '</button>' +
      '<button type="button" class="myfb-ai-menu-item" data-act="ai-triage">' +
        '<span class="myfb-ai-menu-icon" aria-hidden="true">🎯</span>' +
        t('card.ai_triage', 'Suggérer un triage') +
      '</button>';
    document.body.appendChild(_menu);
    var rect = anchor.getBoundingClientRect();
    _menu.style.top  = (rect.bottom + 4) + 'px';
    _menu.style.left = Math.max(8, rect.right - _menu.offsetWidth) + 'px';
    _menu.addEventListener('click', function (e) {
      var item = e.target.closest('[data-act]');
      if (!item) return;
      var act = item.getAttribute('data-act');
      _closeMenu();
      if (act === 'ai-summarize') _runSummarize(card, demandeId);
      else if (act === 'ai-triage') _runTriage(card, demandeId);
    });
    // Close on outside click
    setTimeout(function () { document.addEventListener('click', _closeMenu, { once: true, capture: true }); }, 0);
  }
  function _closeMenu() {
    if (_menu) { _menu.remove(); _menu = null; }
  }

  function _getDemandeForCard(demandeId) {
    var ctx = window.MyFb && window.MyFb.runtime;
    if (ctx && ctx.state && ctx.state.demandes[demandeId]) return ctx.state.demandes[demandeId];
    // Fallback to legacy STATE
    var STATE = window.MyFbBindings && window.MyFbBindings.ctx && window.MyFbBindings.ctx.STATE;
    if (STATE && Array.isArray(STATE.demandes)) {
      for (var i = 0; i < STATE.demandes.length; i++) {
        if (STATE.demandes[i].id === demandeId) return STATE.demandes[i];
      }
    }
    return null;
  }

  function _runSummarize(card, demandeId) {
    var ai = window.MyFb && window.MyFb.core && window.MyFb.core.aiClient;
    var demande = _getDemandeForCard(demandeId);
    if (!ai || !demande) {
      _toast(t('card.ai_unavailable', 'IA indisponible.'), 'error');
      return;
    }
    _toast(t('card.ai_summarizing', 'Résumé en cours…'), 'info', 8000);
    ai.summarize(demande).then(function (summary) {
      _showResultInCard(card, summary, 'summary');
      _toast(t('card.ai_done', 'Résumé prêt.'), 'success');
    }).catch(function (err) {
      _handleAiError(err);
    });
  }

  function _runTriage(card, demandeId) {
    var ai      = window.MyFb && window.MyFb.core && window.MyFb.core.aiClient;
    var triage  = window.MyFbTriage;
    var demande = _getDemandeForCard(demandeId);
    if (!ai || !triage || !demande) {
      _toast(t('card.ai_unavailable', 'IA indisponible.'), 'error');
      return;
    }
    _toast(t('card.ai_triaging', 'Triage suggéré en cours…'), 'info', 8000);
    ai.suggestTriage(demande).then(function (suggestion) {
      _showTriageSuggestion(card, demandeId, suggestion);
    }).catch(function (err) {
      _handleAiError(err);
    });
  }

  function _showResultInCard(card, text, kind) {
    // Remove previous result if any
    var prev = card.querySelector('.myfb-ai-result');
    if (prev) prev.remove();
    var box = document.createElement('div');
    box.className = 'myfb-ai-result myfb-ai-result-' + kind;
    box.innerHTML =
      '<div class="myfb-ai-result-header">' +
        '<span class="myfb-ai-result-icon" aria-hidden="true">' + (kind === 'summary' ? '📝' : '🎯') + '</span>' +
        '<span class="myfb-ai-result-label">' + (kind === 'summary' ? t('card.ai_summary_label', 'Résumé IA') : t('card.ai_triage_label', 'Triage suggéré')) + '</span>' +
        '<button type="button" class="myfb-ai-result-close" aria-label="Fermer">×</button>' +
      '</div>' +
      '<div class="myfb-ai-result-body"></div>';
    box.querySelector('.myfb-ai-result-body').textContent = text;
    box.querySelector('.myfb-ai-result-close').addEventListener('click', function () { box.remove(); });
    card.appendChild(box);
  }

  function _showTriageSuggestion(card, demandeId, suggestion) {
    var prev = card.querySelector('.myfb-ai-result');
    if (prev) prev.remove();
    var box = document.createElement('div');
    box.className = 'myfb-ai-result myfb-ai-result-triage';
    var tagsHtml = suggestion.tags.map(function (tg) {
      return '<span class="myfb-ai-tag">' + tg.replace(/</g, '&lt;') + '</span>';
    }).join('');
    box.innerHTML =
      '<div class="myfb-ai-result-header">' +
        '<span class="myfb-ai-result-icon" aria-hidden="true">🎯</span>' +
        '<span class="myfb-ai-result-label">' + t('card.ai_triage_label', 'Triage suggéré') + '</span>' +
        '<span class="myfb-ai-confidence" title="' + t('card.ai_confidence', 'Confiance') + '">' + Math.round(suggestion.confidence * 100) + '%</span>' +
        '<button type="button" class="myfb-ai-result-close" aria-label="Fermer">×</button>' +
      '</div>' +
      '<div class="myfb-ai-result-body">' +
        '<div class="myfb-ai-suggest-row"><strong>' + t('card.status', 'Statut') + ' :</strong> ' + suggestion.status + '</div>' +
        '<div class="myfb-ai-suggest-row"><strong>' + t('card.priority', 'Priorité') + ' :</strong> ' + suggestion.priority + '</div>' +
        '<div class="myfb-ai-suggest-row"><strong>' + t('card.tags', 'Tags') + ' :</strong> ' + (tagsHtml || '<em>—</em>') + '</div>' +
        '<button type="button" class="myfb-ai-apply-btn" data-act="ai-apply-triage">' + t('card.ai_apply', 'Appliquer') + '</button>' +
      '</div>';
    box.querySelector('.myfb-ai-result-close').addEventListener('click', function () { box.remove(); });
    box.querySelector('[data-act=ai-apply-triage]').addEventListener('click', function () {
      _applyTriage(demandeId, suggestion).then(function () {
        _toast(t('card.ai_applied', 'Triage appliqué.'), 'success');
        box.remove();
      }).catch(function (err) {
        _toast(t('card.ai_apply_fail', 'Échec : ' + ((err && err.message) || err)), 'error');
      });
    });
    card.appendChild(box);
  }

  function _applyTriage(demandeId, suggestion) {
    var T = window.MyFbTriage;
    if (!T) return Promise.reject(new Error('triage api missing'));
    var jobs = [
      T.setStatus(demandeId, suggestion.status).catch(function () {}),
      T.setPriority(demandeId, suggestion.priority).catch(function () {}),
    ];
    (suggestion.tags || []).forEach(function (tg) {
      jobs.push(T.addTag(demandeId, tg).catch(function () {}));
    });
    return Promise.all(jobs);
  }

  function _handleAiError(err) {
    var msg = err && err.code === 'NO_KEY'
      ? t('card.ai_no_key', 'Aucune clé API — configurez-la dans Réglages → IA.')
      : err && err.code === 'RATE_LIMIT'
        ? t('card.ai_rate_limit', 'Limite atteinte — réessayez plus tard.')
        : t('card.ai_fail', 'Échec : ' + ((err && err.message) || err));
    _toast(msg, 'error', 4500);
  }

  // ── Public API ──────────────────────────────────────────────────────
  window.MyFbAiUi = {
    initSettingsPanel: initSettingsPanel,
    initCardDecorator: initCardDecorator,
    _applyTriage:      _applyTriage,
    _getDemandeForCard: _getDemandeForCard,
  };
})(window);
