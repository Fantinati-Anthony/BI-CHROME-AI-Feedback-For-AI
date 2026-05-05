/**
 * BIAIF Inject
 * Injects prompt text and images into Claude.ai's Tiptap/ProseMirror editor.
 * Simulates what happens when you drag-and-drop files — one element at a time.
 */
(function () {
  'use strict';

  if (window.__BIAIF_INJECT__) return;
  window.__BIAIF_INJECT__ = true;

  // Claude Code web uses a Tiptap ProseMirror editor; try multiple selectors
  // in order of specificity.
  var EDITOR_SELECTORS = [
    'div[contenteditable="true"][aria-label="Prompt"].ProseMirror',
    'div.tiptap[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"][aria-label="Prompt"]',
    'div[contenteditable="true"]',
  ];

  function findEditor() {
    for (var i = 0; i < EDITOR_SELECTORS.length; i++) {
      var el = document.querySelector(EDITOR_SELECTORS[i]);
      if (el) return el;
    }
    return null;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // -----------------------------------------------------------------------
  // Text injection — tries beforeinput (ProseMirror), then execCommand
  // -----------------------------------------------------------------------
  async function injectText(editor, text) {
    editor.focus();
    await sleep(80);

    // ProseMirror listens to beforeinput → insertText
    var ev = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: text,
      bubbles: true,
      cancelable: true,
    });
    editor.dispatchEvent(ev);
    await sleep(60);

    // execCommand fallback (deprecated but still works in Chromium contenteditable)
    if (!editor.textContent.includes(text.slice(0, 30))) {
      document.execCommand('insertText', false, text);
    }
    await sleep(120);
  }

  // -----------------------------------------------------------------------
  // Image injection — simulate drag-and-drop (DataTransfer with File)
  // -----------------------------------------------------------------------
  async function injectImage(editor, dataUrl) {
    var resp, blob, file;
    try {
      resp = await fetch(dataUrl);
      blob = await resp.blob();
    } catch (e) {
      console.warn('[BIAIF] inject: fetch dataUrl failed', e && e.message);
      return false;
    }

    var ext  = blob.type === 'image/jpeg' ? 'jpg' : 'png';
    file = new File([blob], 'biaif-capture.' + ext, { type: blob.type || 'image/png' });

    editor.focus();
    await sleep(60);

    // Approach 1: DataTransfer drop (works when ProseMirror reads dataTransfer.files)
    try {
      var dt = new DataTransfer();
      dt.items.add(file);
      editor.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await sleep(40);
      editor.dispatchEvent(new DragEvent('dragover',  { bubbles: true, cancelable: true, dataTransfer: dt }));
      await sleep(40);
      editor.dispatchEvent(new DragEvent('drop',      { bubbles: true, cancelable: true, dataTransfer: dt }));
      await sleep(280);
      return true;
    } catch (e) {
      console.warn('[BIAIF] inject: DragEvent failed', e && e.message);
    }

    // Approach 2: write to clipboard then paste event
    try {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      editor.focus();
      await sleep(60);
      var pasteEv = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      editor.dispatchEvent(pasteEv);
      await sleep(200);
      return true;
    } catch (e) {
      console.warn('[BIAIF] inject: clipboard paste failed', e && e.message);
    }

    return false;
  }

  // -----------------------------------------------------------------------
  // Message listener
  // -----------------------------------------------------------------------
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== window.BIAIF.MSG.INJECT_TO_EDITOR) return;
    if (sender.id && sender.id !== chrome.runtime.id) return;

    (async function () {
      var editor = findEditor();
      if (!editor) { sendResponse({ error: 'editor not found' }); return; }

      var total   = (msg.text ? 1 : 0) + (Array.isArray(msg.images) ? msg.images.length : 0);
      var done    = 0;

      // 1. Text first
      if (msg.text) {
        await injectText(editor, msg.text);
        done++;
        chrome.runtime.sendMessage({
          type: window.BIAIF.MSG.CAPTURE_PROGRESS,
          current: done, total: total, label: 'Texte injecté…',
        }).catch(function () {});
        await sleep(200);
      }

      // 2. Images one by one
      var images = Array.isArray(msg.images) ? msg.images : [];
      for (var i = 0; i < images.length; i++) {
        await injectImage(editor, images[i]);
        done++;
        chrome.runtime.sendMessage({
          type: window.BIAIF.MSG.CAPTURE_PROGRESS,
          current: done, total: total, label: 'Image ' + (i + 1) + '/' + images.length + ' injectée…',
        }).catch(function () {});
        await sleep(150);
      }

      sendResponse({ ok: true, text: !!msg.text, images: images.length });
    })();

    return true; // keep channel open for async sendResponse
  });

})();
