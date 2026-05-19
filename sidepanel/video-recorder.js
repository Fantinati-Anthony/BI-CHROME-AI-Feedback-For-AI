/**
 * My-Feedbacks Video Recorder (v2.2)
 *
 * Quick-tool that records the user's screen via getDisplayMedia +
 * MediaRecorder, then attaches the resulting webm blob to the
 * current demande as a `{type: 'video'}` reference.
 *
 * The video is intentionally NOT included in the AI export prompts
 * (export.js / export-picker.js skip ref.type === 'video') — its
 * sole purpose is to reach the admin alongside the demande via the
 * bundle export, shared-folder sync, or mailto attachment.
 *
 * UX :
 *   - 1st click  : prompts the user to share their screen, then starts
 *                  recording. Button gets a pulsing red dot.
 *   - 2nd click  : stops recording, persists the blob to blob-store,
 *                  pushes a video ref to STATE.currentDemande.refs.
 *   - On stop or user-revoke (closing the share picker) : tear down.
 *
 * No-op gracefully when:
 *   - getDisplayMedia is unavailable
 *   - MediaRecorder is unavailable
 *   - The user denies the screen share permission
 */

(function (window) {
  'use strict';

  var t = function (k, fb) {
    return (window.MyFb && window.MyFb.utils && window.MyFb.utils.t)
      ? window.MyFb.utils.t(k, fb) : (fb || k);
  };

  function _toast(m, k, d) {
    if (window.MyFbToast && window.MyFbToast.show) window.MyFbToast.show(m, k || 'info', d || 2200);
  }

  var _recorder = null;
  var _stream   = null;
  var _chunks   = [];
  var _btn      = null;

  function init() {
    document.addEventListener('click', _onClick, true);
  }

  function isRecording() { return !!_recorder; }

  function _onClick(e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-act="video"]');
    if (!btn) return;
    e.stopPropagation();
    _btn = btn;
    if (_recorder) _stop();
    else            _start();
  }

  function _start() {
    if (!navigator || !navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      _toast(t('video.unsupported', 'Enregistrement vidéo non supporté dans ce navigateur.'), 'error', 4000);
      return;
    }
    if (typeof window.MediaRecorder !== 'function') {
      _toast(t('video.unsupported', 'Enregistrement vidéo non supporté dans ce navigateur.'), 'error', 4000);
      return;
    }
    navigator.mediaDevices.getDisplayMedia({
      video: { /* default best quality */ },
      audio: true,
    }).then(function (stream) {
      _stream = stream;
      _chunks = [];
      var mimeType = _pickMime();
      try {
        _recorder = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);
      } catch (e) {
        _toast(t('video.fail', 'Échec : ' + e.message), 'error', 4000);
        _teardown();
        return;
      }
      _recorder.ondataavailable = function (ev) { if (ev.data && ev.data.size > 0) _chunks.push(ev.data); };
      _recorder.onstop = _onStop;
      _recorder.onerror = function (ev) {
        _toast(t('video.error', 'Erreur enregistrement.'), 'error');
        _teardown();
      };
      // If the user clicks the browser's "Stop sharing" overlay, the
      // video track fires 'ended'. We translate that into stop().
      var vt = stream.getVideoTracks()[0];
      if (vt) vt.addEventListener('ended', function () { if (_recorder && _recorder.state === 'recording') _recorder.stop(); });
      _recorder.start(1000);  // 1s chunks
      _setRecordingUi(true);
      _toast(t('video.started', 'Enregistrement démarré.'), 'info', 1800);
    }).catch(function (err) {
      if (err && err.name === 'NotAllowedError') return; // user cancelled
      _toast(t('video.start_failed', 'Échec démarrage : ' + (err && err.message || err)), 'error', 4000);
    });
  }

  function _stop() {
    if (_recorder && _recorder.state === 'recording') _recorder.stop();
    // _onStop will fire and handle teardown
  }

  function _onStop() {
    var blob = new Blob(_chunks, { type: (_recorder && _recorder.mimeType) || 'video/webm' });
    _teardown();
    _persistAndAttach(blob);
  }

  function _persistAndAttach(blob) {
    var STATE = window.MyFbBindings && window.MyFbBindings.ctx && window.MyFbBindings.ctx.STATE;
    if (!STATE) {
      _toast(t('video.no_state', 'État indisponible.'), 'error');
      return;
    }
    var ts = Date.now();
    var fileName = 'video-' + new Date(ts).toISOString().replace(/[:.]/g, '-') + '.webm';
    var blobStore = window.MyFbBlobStore;
    var jobs = blobStore && blobStore.put
      ? blobStore.put(blob).then(function (blobId) { return { blobId: blobId, dataUrl: null }; })
      : _blobToDataUrl(blob).then(function (du) { return { blobId: null, dataUrl: du }; });

    jobs.then(function (out) {
      var ref = {
        id:       'ref-video-' + ts,
        type:     'video',
        ts:       ts,
        fileName: fileName,
        mime:     blob.type || 'video/webm',
        sizeBytes: blob.size,
        blobId:   out.blobId,
        dataUrl:  out.dataUrl,  // null when blobId is set
      };
      if (!STATE.currentDemande) STATE.currentDemande = { text: '', refs: [], pageUrl: null };
      if (!Array.isArray(STATE.currentDemande.refs)) STATE.currentDemande.refs = [];
      STATE.currentDemande.refs.push(ref);
      if (window.MyFbStorage && window.MyFbStorage.persist) window.MyFbStorage.persist(STATE);
      if (window.MyFbRenderer && window.MyFbRenderer.renderDemandeRefsStrip) window.MyFbRenderer.renderDemandeRefsStrip();
      _toast(t('video.saved', 'Vidéo ajoutée à la demande (' + _humanSize(blob.size) + ').'), 'success', 3000);
    }).catch(function (err) {
      _toast(t('video.persist_failed', 'Sauvegarde KO : ' + (err && err.message)), 'error', 4000);
    });
  }

  function _teardown() {
    _setRecordingUi(false);
    if (_recorder) {
      try { _recorder.stream && _recorder.stream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (_) {}
      _recorder = null;
    }
    if (_stream) {
      try { _stream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (_) {}
      _stream = null;
    }
    _chunks = [];
  }

  function _setRecordingUi(isRec) {
    if (!_btn) _btn = document.querySelector('[data-act="video"]');
    if (!_btn) return;
    _btn.classList.toggle('is-recording', !!isRec);
    _btn.setAttribute('aria-pressed', isRec ? 'true' : 'false');
  }

  function _pickMime() {
    var candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (var i = 0; i < candidates.length; i++) {
      if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  function _blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result)); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }

  function _humanSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' kB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  window.MyFbVideoRecorder = {
    init:        init,
    isRecording: isRecording,
    _humanSize:  _humanSize,
  };
})(window);
