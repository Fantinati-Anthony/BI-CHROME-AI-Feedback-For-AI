/**
 * BIAIF Shared Utils
 * Cross-context helpers (sidepanel, content scripts, service worker).
 * Replaces duplicate _extractGithubRepo / _decodeErr / _t / _MSG previously
 * inlined in each module.
 */
(function (root) {
  'use strict';
  root.BIAIF = root.BIAIF || {};

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
    if (root.BIAIFi18n && root.BIAIFi18n.t) {
      var v = root.BIAIFi18n.t(key, vars);
      if (v && v !== key) return v;
    }
    return fallback || key;
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
    if (root.BIAIF && root.BIAIF.MSG && root.BIAIF.MSG[key]) return root.BIAIF.MSG[key];
    return 'biaif:' + key.toLowerCase().replace(/_/g, '-');
  }

  // Match a hostname against the list of known AI hosts in AI_ADAPTERS.
  function findAiAdapter(hostname) {
    var adapters = (root.BIAIF && root.BIAIF.AI_ADAPTERS) || [];
    for (var i = 0; i < adapters.length; i++) {
      var a = adapters[i];
      if (hostname === a.host || hostname.endsWith('.' + a.host)) return a;
    }
    return null;
  }

  // Toast wrapper — safe even if BIAIFToast isn't loaded yet (content scripts).
  function toast(msg, kind, duration) {
    if (root.BIAIFToast && root.BIAIFToast.show) root.BIAIFToast.show(msg, kind, duration);
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

  root.BIAIF.utils = {
    extractGithubRepo: extractGithubRepo,
    t:                 t,
    decodeErr:         decodeErr,
    msgKey:            msgKey,
    findAiAdapter:     findAiAdapter,
    toast:             toast,
    sendBg:            sendBg,
  };

})(typeof window !== 'undefined' ? window : self);
