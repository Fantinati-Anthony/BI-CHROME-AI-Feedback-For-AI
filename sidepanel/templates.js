// @ts-check
/**
 * BIAIF Templates — reusable prompt snippets.
 *
 * Stored in STATE.templates as [{ id, name, body, ts }]. Persisted via the
 * canonical BIAIFStorage.persist (templates are part of the bundle, so they
 * also flow through Export/Import).
 *
 * Public API on window.BIAIFTemplates:
 *   list()                      → array of templates (newest first)
 *   add({ name, body })         → creates and returns the new template
 *   remove(id)                  → boolean
 *   rename(id, name)            → boolean
 *   insertIntoEditor(id)        → inserts the body at the caret in the
 *                                 current demande editor (auto-arms)
 *   saveCurrentAsTemplate(name) → snapshots the editor's plain text
 */
(function (window) {
  'use strict';

  var STATE; // injected via init()

  function init(state) {
    STATE = state;
    if (!Array.isArray(STATE.templates)) STATE.templates = [];
  }

  function list() {
    return (STATE.templates || []).slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  }

  function add(tpl) {
    if (!tpl || !tpl.body) return null;
    var entry = {
      id:   'tpl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      name: (tpl.name || _firstLine(tpl.body) || 'Snippet').slice(0, 60),
      body: String(tpl.body).slice(0, 4000),
      ts:   Date.now(),
    };
    STATE.templates = (STATE.templates || []).concat([entry]);
    if (window.BIAIFStorage) window.BIAIFStorage.persist(STATE);
    return entry;
  }

  function remove(id) {
    var before = (STATE.templates || []).length;
    STATE.templates = (STATE.templates || []).filter(function (t) { return t.id !== id; });
    if (STATE.templates.length === before) return false;
    if (window.BIAIFStorage) window.BIAIFStorage.persist(STATE);
    return true;
  }

  function rename(id, name) {
    var t = (STATE.templates || []).find(function (x) { return x.id === id; });
    if (!t) return false;
    t.name = String(name || '').slice(0, 60) || t.name;
    if (window.BIAIFStorage) window.BIAIFStorage.persist(STATE);
    return true;
  }

  // ─── Variable interpolation ────────────────────────────────────
  // Built-in variables (resolved synchronously; fallback to '' if missing):
  //   {{date}}, {{time}}, {{datetime}}, {{url}}, {{title}}, {{repo}},
  //   {{selection}} (last picker text snippet), {{lang}} (UI lang),
  //   {{aiLang}} (speech-recognition lang), {{n}} (number of demandes)
  // Custom prompts: {{var:label}} or {{var:label?default}} — popped via
  //                 prompt() at insertion time.
  function _builtins() {
    var now  = new Date();
    var pad  = function (n) { return String(n).padStart(2, '0'); };
    var date = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    var time = pad(now.getHours()) + ':' + pad(now.getMinutes());
    var url  = (STATE.currentDemande && STATE.currentDemande.pageUrl) || '';
    var title = '';
    try { title = (chrome.tabs && chrome.tabs.query) ? '' : ''; } catch (_) {}
    // Pull the last interactive picker selection if any.
    var lastRef = (STATE.currentDemande && (STATE.currentDemande.refs || []).slice(-1)[0]) || null;
    var selection = lastRef && (lastRef.text || lastRef.selector || '') || '';
    var repo = STATE.pendingRepoId || (lastRef && lastRef.repoId) || '';
    return {
      date: date, time: time, datetime: date + ' ' + time,
      url: url, title: title, selection: selection, repo: repo,
      lang: STATE.uiLang || 'fr', aiLang: STATE.lang || '',
      n: String((STATE.demandes || []).length),
    };
  }

  function interpolate(body) {
    if (typeof body !== 'string' || !body.includes('{{')) return body;
    var built = _builtins();
    return body.replace(/\{\{\s*(var:)?([\w-]+)(?:\?([^}]*))?\s*\}\}/g, function (_m, isVar, name, def) {
      if (isVar) {
        // Custom prompt — only ask once per name within a single insertion.
        if (interpolate._promptCache && interpolate._promptCache[name] !== undefined) {
          return interpolate._promptCache[name];
        }
        var v;
        try { v = window.prompt(name + (def ? ' (' + def + ')' : ''), def || ''); } catch (_) { v = def || ''; }
        if (v == null) v = '';
        if (!interpolate._promptCache) interpolate._promptCache = {};
        interpolate._promptCache[name] = v;
        return v;
      }
      return built[name] !== undefined ? built[name] : '';
    });
  }

  function insertIntoEditor(id) {
    var t = (STATE.templates || []).find(function (x) { return x.id === id; });
    if (!t || !window.BIAIFSession) return;
    interpolate._promptCache = null; // fresh ask per insertion
    window.BIAIFSession.addTextToTarget(interpolate(t.body));
  }

  function saveCurrentAsTemplate(name) {
    if (!window.BIAIFSession) return null;
    window.BIAIFSession.syncCurrentDemandeFromEditor();
    var body = ((STATE.currentDemande && STATE.currentDemande.text) || '').trim();
    if (!body) return null;
    return add({ name: name, body: body });
  }

  function _firstLine(s) {
    return String(s || '').split(/\r?\n/)[0].trim().slice(0, 50);
  }

  window.BIAIFTemplates = {
    init: init,
    list: list,
    add: add,
    remove: remove,
    rename: rename,
    insertIntoEditor: insertIntoEditor,
    interpolate: interpolate,
    saveCurrentAsTemplate: saveCurrentAsTemplate,
  };
})(window);
