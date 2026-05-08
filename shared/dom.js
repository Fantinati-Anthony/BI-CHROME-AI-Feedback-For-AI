// @ts-check
/**
 * BIAIF DOM helpers
 *
 * Tiny, dependency-free utilities used across the side panel and content
 * scripts. Lives next to logger / utils so any context (SW, sidepanel,
 * content) can pull from the same source. SW won't actually call DOM
 * helpers but importing them is harmless (they only read globals lazily).
 *
 * API:
 *   esc(str)                       — escape & < > " for safe HTML interpolation
 *   escAttr(str)                   — escape for an attribute value (alias of esc)
 *   el(tag, attrs?, children?)     — createElement helper. attrs values can be
 *                                    strings, numbers, booleans (for hidden/disabled),
 *                                    or null (skipped). children: string | Node | array.
 *   svg(html)                      — wrap an inline SVG markup string into a
 *                                    document fragment (safe: caller controls the
 *                                    string, never user data).
 *   hostname(url)                  — URL.hostname or '' on invalid input
 *   formatUrl(url, max=60)         — host + path + truncated search, capped
 *   makeEmpty(message, className)  — div with the given class (default biaif-empty)
 *                                    and textContent
 */
(function (root) {
  'use strict';
  root.BIAIF = root.BIAIF || {};

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class' || k === 'className') node.className = String(v);
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k === 'text') node.textContent = String(v);
        else if (k === 'html') node.innerHTML = String(v); // caller-controlled only
        else if (k === 'dataset' && typeof v === 'object') {
          for (var dk in v) node.dataset[dk] = String(v[dk]);
        } else if (k.indexOf('on') === 0 && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) {
          node.setAttribute(k, '');
        } else {
          node.setAttribute(k, String(v));
        }
      }
    }
    if (children !== undefined && children !== null) _appendChildren(node, children);
    return node;
  }

  function _appendChildren(parent, children) {
    if (children == null) return;
    if (Array.isArray(children)) {
      for (var i = 0; i < children.length; i++) _appendChildren(parent, children[i]);
      return;
    }
    if (typeof children === 'string' || typeof children === 'number') {
      parent.appendChild(document.createTextNode(String(children)));
      return;
    }
    if (children instanceof Node) {
      parent.appendChild(children);
      return;
    }
  }

  // svg() takes a complete <svg>...</svg> string (controlled by caller, never
  // user data) and returns a real SVG element. Useful for the icon factory.
  function svg(html) {
    var wrap = document.createElement('div');
    wrap.innerHTML = String(html).trim();
    return wrap.firstElementChild;
  }

  function hostname(url) {
    try { return new URL(url).hostname; } catch (_) { return ''; }
  }

  function formatUrl(url, max) {
    var cap = (max == null) ? 60 : Number(max);
    if (!url) return '';
    try {
      var u = new URL(url);
      var s = u.host + u.pathname + (u.search.length > 30 ? u.search.slice(0, 30) + '…' : u.search);
      return s.length > cap ? s.slice(0, cap) + '…' : s;
    } catch (_) {
      return url.length > cap ? url.slice(0, cap) + '…' : url;
    }
  }

  function makeEmpty(message, className) {
    var node = document.createElement('div');
    node.className = className || 'biaif-empty';
    node.textContent = String(message || '');
    return node;
  }

  root.BIAIF.dom = {
    esc:       esc,
    escAttr:   esc,
    el:        el,
    svg:       svg,
    hostname:  hostname,
    formatUrl: formatUrl,
    makeEmpty: makeEmpty,
  };

})(typeof window !== 'undefined' ? window : self);
