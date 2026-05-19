// @ts-check
/**
 * MyFb Render Icons
 *
 * Inline SVG strings used across the side panel. Centralised so we don't
 * scatter 40-line SVG markup through render modules. Each icon factory
 * accepts a size override (default 12) and is otherwise self-contained.
 *
 * All callers either use these as innerHTML (safe — no user data) or pass
 * them through MyFb.dom.svg() to obtain a real SVGElement.
 */
(function (window) {
  'use strict';
  window.MyFbRender = window.MyFbRender || {};

  function _svg(size, body) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }

  // Path / shape constants — kept short for readability.
  var P = {
    chat:      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    chevronDn: '<polyline points="6 9 12 15 18 9"/>',
    link:      '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
               '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    repo:      '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>' +
               '<path d="M6 21V9a9 9 0 0 0 9 9"/>',
    checkmark: '<polyline points="20 6 9 17 4 12"/>',
    pencil:    '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    inject:    '<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/>' +
               '<path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/>' +
               '<path d="m16 6-4 4-4-4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
    code:      '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    octocat:   '<path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/>' +
               '<path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32"/>',
    copy:      '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>' +
               '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    download:  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
               '<polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    arrow:     '<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>',
    image:     '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="3"/>',
    alert:     '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/>' +
               '<line x1="12" x2="12.01" y1="16" y2="16"/>',
    filter:    '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    video:     '<rect x="2" y="6" width="14" height="12" rx="2"/>' +
               '<polygon points="16 10 22 6 22 18 16 14"/>',
  };

  window.MyFbRender.icons = {
    chat:      function (size) { return _svg(size || 12, P.chat); },
    chevronDn: function (size) { return _svg(size || 12, P.chevronDn); },
    link:      function (size) { return _svg(size || 11, P.link); },
    repo:      function (size) { return _svg(size || 9,  P.repo); },
    checkmark: function (size) { return _svg(size || 12, P.checkmark); },
    pencil:    function (size) { return _svg(size || 12, P.pencil); },
    inject:    function (size) { return _svg(size || 11, P.inject); },
    code:      function (size) { return _svg(size || 11, P.code); },
    octocat:   function (size) { return _svg(size || 11, P.octocat); },
    copy:      function (size) { return _svg(size || 11, P.copy); },
    download:  function (size) { return _svg(size || 11, P.download); },
    arrow:     function (size) { return _svg(size || 11, P.arrow); },
    image:     function (size) { return _svg(size || 11, P.image); },
    alert:     function (size) { return _svg(size || 11, P.alert); },
    filter:    function (size) { return _svg(size || 10, P.filter); },
    video:     function (size) { return _svg(size || 11, P.video); },
  };
})(window);
