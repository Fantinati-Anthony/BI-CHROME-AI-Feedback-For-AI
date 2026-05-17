/**
 * MyFb Shared Utils
 * Cross-context helpers (sidepanel, content scripts, service worker).
 * Replaces duplicate _extractGithubRepo / _decodeErr / _t / _MSG previously
 * inlined in each module.
 */
(function (root) {
  'use strict';
  root.MyFb = root.MyFb || {};

  var GH_SKIP = [
    'orgs', 'settings', 'marketplace', 'explore', 'trending',
    'notifications', 'search', 'login', 'logout',
  ];

  function extractGithubRepo(url) {
    try {
      var u = new URL(url);
      if (u.hostname !== 'github.com') return null;
      var parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && GH_SKIP.indexOf(parts[0]) === -1) {
        return parts[0] + '/' + parts[1];
      }
    } catch (_) {}
    return null;
  }

  function t(key, fallback, vars) {
    if (root.MyFbI18n && root.MyFbI18n.t) {
      var v = root.MyFbI18n.t(key, vars);
      if (v && v !== key) return v;
    }
    return fallback || key;
  }

  // Plural-aware lookup. Resolves baseKey + '_' + category via
  // Intl.PluralRules, with fallback to legacy *_singular / *_plural.
  function tn(baseKey, n, fallback, vars) {
    if (root.MyFbI18n && root.MyFbI18n.tn) {
      var v = root.MyFbI18n.tn(baseKey, n, vars);
      if (v && v !== baseKey) return v;
    }
    return fallback || baseKey;
  }

  function decodeErr(e) {
    var s = typeof e === 'string' ? e : (e && e.message || String(e));
    if (s.indexOf('Receiving end does not exist') !== -1 ||
        s.indexOf('Could not establish connection') !== -1) {
      return t('err.content_script_not_ready', "content script pas prêt — rechargez l'onglet");
    }
    return s;
  }

  function msgKey(key) {
    if (root.MyFb && root.MyFb.MSG && root.MyFb.MSG[key]) return root.MyFb.MSG[key];
    return 'myfb:' + key.toLowerCase().replace(/_/g, '-');
  }

  // Match a hostname against the list of known AI hosts in AI_ADAPTERS.
  function findAiAdapter(hostname) {
    var adapters = (root.MyFb && root.MyFb.AI_ADAPTERS) || [];
    for (var i = 0; i < adapters.length; i++) {
      var a = adapters[i];
      if (hostname === a.host || hostname.endsWith('.' + a.host)) return a;
    }
    return null;
  }

  // Toast wrapper — safe even if MyFbToast isn't loaded yet (content scripts).
  function toast(msg, kind, duration) {
    if (root.MyFbToast && root.MyFbToast.show) root.MyFbToast.show(msg, kind, duration);
  }

  // Best-effort runtime.sendMessage wrapper — swallows the lastError noise
  // that fires on closed channels / disabled tabs.
  function sendBg(payload) {
    try {
      return root.chrome.runtime.sendMessage(payload).catch(function () { return null; });
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  var api = {
    extractGithubRepo: extractGithubRepo,
    t:                 t,
    tn:                tn,
    decodeErr:         decodeErr,
    msgKey:            msgKey,
    findAiAdapter:     findAiAdapter,
    toast:             toast,
    sendBg:            sendBg,
  };
  root.MyFb.utils = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
