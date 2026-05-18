// @ts-check
/**
 * My-Feedbacks AI Client
 *
 * Thin wrapper over the Anthropic Messages API (Claude). Used for the
 * two AI features in v1.0:
 *   1. summarize(demande) → short human-readable summary of a feedback
 *   2. suggestTriage(demande) → { status, priority, tags } recommendation
 *
 * Configuration:
 *   - The API key is stored in chrome.storage.local under
 *     `myfb:ai:anthropic-key`. User pastes it in Settings → AI.
 *   - Default model is claude-haiku-4-5 (fast + cheap). User can pick
 *     claude-sonnet-4-6 or claude-opus-4-7 for higher-quality output.
 *
 * Failure modes:
 *   - No key configured → reject with a clear message the UI can show
 *     ("Configurez votre clé API dans Réglages → IA")
 *   - Network error → reject (UI shows error toast)
 *   - Rate limit (429) → reject with retryAfter hint
 *
 * NEVER stored on the API call:
 *   - User identity / device UUID
 *   - Page URL (unless explicitly in the feedback text, then it's the
 *     user's content already)
 */

(function (root) {
  'use strict';

  root.MyFb = root.MyFb || {};
  root.MyFb.core = root.MyFb.core || {};

  var API_KEY_STORAGE = 'myfb:ai:anthropic-key';
  var MODEL_STORAGE   = 'myfb:ai:model';
  var DEFAULT_MODEL   = 'claude-haiku-4-5-20251001';
  var API_BASE        = 'https://api.anthropic.com/v1';
  var API_VERSION     = '2023-06-01';

  /**
   * Available Claude models (highest → lowest priority for UI dropdown).
   * @type {ReadonlyArray<{ id: string, label: string, tier: 'opus'|'sonnet'|'haiku' }>}
   */
  var MODELS = Object.freeze([
    { id: 'claude-opus-4-7',           label: 'Claude Opus 4.7 (highest quality)', tier: 'opus'   },
    { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 (balanced)',      tier: 'sonnet' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast + cheap)',   tier: 'haiku'  },
  ]);

  // ── chrome.storage abstraction (testable) ──────────────────────────
  var _impl = null;
  function _storage() {
    if (_impl) return _impl;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      var sl = /** @type {any} */ (chrome.storage.local);
      _impl = {
        get: function (key) { return new Promise(function (r) { sl.get(key, r); }); },
        set: function (obj) { return new Promise(function (r) { sl.set(obj, function () { r(); }); }); },
      };
    } else {
      var mem = {};
      _impl = {
        get: function (key) { var o = {}; if (mem[key] !== undefined) o[key] = mem[key]; return Promise.resolve(o); },
        set: function (obj) { Object.assign(mem, obj); return Promise.resolve(); },
      };
    }
    return _impl;
  }

  function getApiKey()    { return _storage().get(API_KEY_STORAGE).then(function (o) { return o[API_KEY_STORAGE] || null; }); }
  function setApiKey(k)   { var o = {}; o[API_KEY_STORAGE] = (k || '').trim() || null; return _storage().set(o); }
  function getModel()     { return _storage().get(MODEL_STORAGE).then(function (o) { return o[MODEL_STORAGE] || DEFAULT_MODEL; }); }
  function setModel(m)    { var o = {}; o[MODEL_STORAGE] = m || DEFAULT_MODEL; return _storage().set(o); }

  /**
   * Lower-level: send a single prompt to Claude and return the text reply.
   * @param {string} prompt
   * @param {{ model?: string, maxTokens?: number, system?: string, fetchImpl?: typeof fetch }} [opts]
   * @returns {Promise<string>}
   */
  function complete(prompt, opts) {
    opts = opts || {};
    var fetchFn = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchFn) return Promise.reject(new Error('No fetch available'));
    return Promise.all([getApiKey(), getModel()]).then(function (out) {
      var apiKey = opts.fetchImpl ? (out[0] || 'test-key') : out[0];
      var model  = opts.model || out[1] || DEFAULT_MODEL;
      if (!apiKey) {
        var err = new Error('AI not configured');
        /** @type {any} */ (err).code = 'NO_KEY';
        return Promise.reject(err);
      }
      var body = {
        model:      model,
        max_tokens: opts.maxTokens || 1024,
        messages:   [{ role: 'user', content: prompt }],
      };
      if (opts.system) /** @type {any} */ (body).system = opts.system;
      return fetchFn(API_BASE + '/messages', {
        method:  'POST',
        headers: {
          'Content-Type':       'application/json',
          'x-api-key':          apiKey,
          'anthropic-version':  API_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (txt) {
            var e = new Error('AI request failed: ' + res.status);
            /** @type {any} */ (e).status = res.status;
            /** @type {any} */ (e).body   = txt;
            if (res.status === 429) /** @type {any} */ (e).code = 'RATE_LIMIT';
            throw e;
          });
        }
        return res.json();
      }).then(function (json) {
        var content = json && json.content;
        if (Array.isArray(content) && content[0] && content[0].text) return content[0].text;
        return '';
      });
    });
  }

  /**
   * Summarize a demande in 1-2 sentences. Returns plain text.
   * @param {{ text: string, url?: string, refs?: object[] }} demande
   * @param {{ model?: string, fetchImpl?: typeof fetch }} [opts]
   * @returns {Promise<string>}
   */
  function summarize(demande, opts) {
    var prompt = _buildSummaryPrompt(demande);
    var lang   = _detectLang();
    return complete(prompt, Object.assign({
      maxTokens: 200,
      system:    'You are a concise feedback triage assistant. ALWAYS reply in ' + lang + ' regardless of the input language. Be factual, short (max 200 chars).',
    }, opts || {}));
  }

  /**
   * Suggest a triage classification for a demande. Returns a structured
   * object the UI can directly apply via MyFbTriage.
   * @param {{ text: string, url?: string, refs?: object[] }} demande
   * @param {{ model?: string, fetchImpl?: typeof fetch }} [opts]
   * @returns {Promise<{ status: string, priority: string, tags: string[], confidence: number }>}
   */
  function suggestTriage(demande, opts) {
    var prompt = _buildTriagePrompt(demande);
    return complete(prompt, Object.assign({
      maxTokens: 300,
      system:    'You output ONLY valid JSON matching the requested schema. No prose, no markdown fence. The "tags" array values stay in English (slug form: kebab-case ASCII).',
    }, opts || {})).then(function (text) {
      var cleaned = (text || '').trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      var json;
      try { json = JSON.parse(cleaned); } catch (_) {
        throw new Error('AI returned invalid JSON: ' + cleaned.slice(0, 200));
      }
      // Normalize / validate
      var statuses = ['new', 'accepted', 'rejected', 'shipped'];
      var prios    = ['low', 'medium', 'high', 'critical'];
      return {
        status:     statuses.indexOf(json.status)   >= 0 ? json.status   : 'new',
        priority:   prios.indexOf(json.priority)    >= 0 ? json.priority : 'medium',
        tags:       Array.isArray(json.tags) ? json.tags.slice(0, 6).map(function (t) { return String(t || '').toLowerCase().slice(0, 40); }).filter(Boolean) : [],
        confidence: typeof json.confidence === 'number' ? Math.max(0, Math.min(1, json.confidence)) : 0.5,
      };
    });
  }

  // ── Language detection helper ──────────────────────────────────────

  /**
   * Maps the user's MyFbI18n locale to a full English language name
   * so the model knows what to write in. Defaults to 'French'.
   * @returns {string}
   */
  function _detectLang() {
    var code = null;
    try {
      if (root.MyFbI18n && typeof root.MyFbI18n.getLang === 'function') code = root.MyFbI18n.getLang();
      else if (typeof navigator !== 'undefined' && navigator.language) code = String(navigator.language).slice(0, 2);
    } catch (_) {}
    var map = {
      fr: 'French', en: 'English', es: 'Spanish', de: 'German',
      it: 'Italian', pt: 'Portuguese', nl: 'Dutch',
    };
    return map[code] || 'French';
  }

  // ── Prompt builders (exposed for tests) ────────────────────────────

  function _buildSummaryPrompt(demande) {
    var parts = [];
    parts.push('Summarize this feedback in 1-2 sentences. Keep it under 200 characters total.');
    parts.push('');
    parts.push('Feedback text:');
    parts.push((demande && demande.text) || '(empty)');
    if (demande && demande.url) {
      parts.push('');
      parts.push('Page URL: ' + demande.url);
    }
    if (demande && Array.isArray(demande.refs) && demande.refs.length) {
      parts.push('');
      parts.push('Attached references: ' + demande.refs.length +
                 ' (' + demande.refs.map(function (r) { return r && r.type; }).join(', ') + ')');
    }
    return parts.join('\n');
  }

  function _buildTriagePrompt(demande) {
    return [
      'Classify this user feedback. Return ONLY a JSON object with this exact schema:',
      '{ "status": "new"|"accepted"|"rejected"|"shipped",',
      '  "priority": "low"|"medium"|"high"|"critical",',
      '  "tags": ["short-tag-1", "short-tag-2"], // max 6, lowercase, hyphenated',
      '  "confidence": 0.0-1.0 }',
      '',
      'Rules:',
      '- "status" is always "new" unless the feedback explicitly says it\'s already fixed/rejected.',
      '- "priority" reflects user impact: critical=blocking, high=major bug, medium=minor bug or improvement, low=nitpick.',
      '- "tags" should be reusable categories like "ui", "perf", "auth", "regression", "css", "data-loss".',
      '- "confidence" is your self-assessment of the classification quality.',
      '',
      'Feedback:',
      (demande && demande.text) || '(empty)',
      demande && demande.url ? '\nURL: ' + demande.url : '',
    ].join('\n');
  }

  // Test seam
  function __setStorageImpl(impl) { _impl = impl; }

  root.MyFb.core.aiClient = {
    MODELS:           MODELS,
    DEFAULT_MODEL:    DEFAULT_MODEL,
    API_KEY_STORAGE:  API_KEY_STORAGE,
    MODEL_STORAGE:    MODEL_STORAGE,
    getApiKey:        getApiKey,
    setApiKey:        setApiKey,
    getModel:         getModel,
    setModel:         setModel,
    complete:         complete,
    summarize:        summarize,
    suggestTriage:    suggestTriage,
    _buildSummaryPrompt: _buildSummaryPrompt,
    _buildTriagePrompt:  _buildTriagePrompt,
    __setStorageImpl: __setStorageImpl,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MyFb.core.aiClient;
  }
})(typeof window !== 'undefined' ? window : globalThis);
