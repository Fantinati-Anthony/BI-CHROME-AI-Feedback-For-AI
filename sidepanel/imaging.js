/**
 * BIAIF Imaging
 *
 * Client-side image compression to keep screenshots within the
 * chrome.storage.local 10 MB quota. Called by session.js before a
 * screenshot ref is pushed into STATE.
 *
 *   compressDataUrl(dataUrl, opts) → Promise<dataUrl>
 *     opts = { maxWidth?: 1600, maxHeight?: 4096, quality?: 0.85, mime?: 'image/jpeg' }
 *
 * For PNGs with transparency we keep PNG (lossless) but still resize.
 * For everything else we re-encode as JPEG which is dramatically smaller
 * and visually indistinguishable on screenshots.
 */
(function (window) {
  'use strict';

  var DEFAULTS = { maxWidth: 1600, maxHeight: 4096, quality: 0.85, mime: 'image/jpeg' };

  function _bytes(dataUrl) {
    if (!dataUrl) return 0;
    var i = dataUrl.indexOf(',');
    return i < 0 ? dataUrl.length : Math.floor((dataUrl.length - i - 1) * 3 / 4);
  }

  function _detectMime(dataUrl) {
    var m = /^data:([^;,]+)/.exec(dataUrl || '');
    return m ? m[1].toLowerCase() : 'image/png';
  }

  function compressDataUrl(dataUrl, opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    if (!dataUrl || typeof dataUrl !== 'string') return Promise.resolve(dataUrl);

    var srcMime = _detectMime(dataUrl);
    // Keep transparent PNGs as PNG; re-encode others as JPEG.
    var outMime = srcMime === 'image/png' ? 'image/png' : opts.mime;

    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (!w || !h) { resolve(dataUrl); return; }

          // Compute scale: shrink to fit maxWidth × maxHeight, never enlarge.
          var scale = Math.min(1, opts.maxWidth / w, opts.maxHeight / h);
          var dw = Math.round(w * scale);
          var dh = Math.round(h * scale);

          var canvas = document.createElement('canvas');
          canvas.width = dw; canvas.height = dh;
          var ctx = canvas.getContext('2d');
          // Fill white for JPEG (no alpha) so transparent areas don't go black.
          if (outMime !== 'image/png') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, dw, dh);
          }
          ctx.drawImage(img, 0, 0, dw, dh);

          var out = canvas.toDataURL(outMime, opts.quality);
          // If compression somehow made it bigger, keep the original.
          resolve(_bytes(out) < _bytes(dataUrl) ? out : dataUrl);
        } catch (_) { resolve(dataUrl); }
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  window.BIAIFImaging = { compressDataUrl: compressDataUrl, bytes: _bytes };
})(window);
