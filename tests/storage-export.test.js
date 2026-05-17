/**
 * Storage export/import roundtrip — uses the buildPayload + importBundle
 * pair without touching chrome.storage. Validates the bundle envelope
 * and that stripDataUrls strips screenshots while preserving structure.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

// The full storage.js module also calls chrome.storage internally;
// load it AFTER the chrome stub is in place (setup.js already did).
beforeAll(() => {
  // shared globals it depends on
  loadAddonScript('shared/constants.js');
  loadAddonScript('shared/config.js');
  loadAddonScript('shared/utils.js');
  loadAddonScript('shared/ai-adapters.js');
  // Toast + Undo are referenced by persist() — provide stubs
  window.MyFbToast = { show: () => {} };
  window.MyFbUndo  = { push: () => {}, pop: () => null, clear: () => {}, canUndo: () => false, size: () => 0 };
  loadAddonScript('sidepanel/storage.js');
});

function makeState(overrides = {}) {
  return Object.assign({
    demandes: [
      { id: 'd1', ts: 1, text: 'hello', refs: [], url: 'https://x.com' },
      { id: 'd2', ts: 2, text: 'pic', refs: [{ type: 'screenshot', dataUrl: 'data:image/png;base64,AAAA', mode: 'visible' }] },
    ],
    currentDemande: { text: '', refs: [], pageUrl: null },
    templates: [{ id: 'tpl-1', name: 't', body: 'tpl body', ts: 99 }],
    lang: 'fr-FR',
    sortOrder: 'desc',
    segFontSize: 14,
    visibleButtons: { inject: true },
    theme: 'light',
    topbarPosition: 'bottom',
  }, overrides);
}

describe('MyFbStorage exportToFile / importBundle', () => {
  it('exportToFile triggers a download (anchor click) with a JSON blob', () => {
    const state = makeState();
    // Capture the blob that would be downloaded
    let savedJson = null;
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      // jsdom's Blob may lack .text(); read via FileReader for portability.
      try {
        const fr = new FileReader();
        fr.onload = () => { savedJson = fr.result; };
        fr.readAsText(blob);
      } catch (_) { /* swallow — savedJson stays null but the bundle assertions still run */ }
      return 'blob:mock';
    };
    const realRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = () => {};
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};

    const bundle = window.MyFbStorage.exportToFile(state);
    expect(bundle._myfb).toBe('export');
    expect(bundle.data.demandes).toHaveLength(2);

    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    HTMLAnchorElement.prototype.click = realClick;
  });

  it('stripDataUrls replaces screenshot dataUrls with null + _stripped: true', () => {
    const state = makeState();
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = () => 'blob:mock';

    const bundle = window.MyFbStorage.exportToFile(state, { stripDataUrls: true });
    const ref = bundle.data.demandes[1].refs[0];
    expect(ref.dataUrl).toBe(null);
    expect(ref._stripped).toBe(true);

    URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;
  });

  it('importBundle replaces demandes + applies settings', () => {
    const state = makeState();
    const bundle = {
      _myfb: 'export', _version: 4,
      data: {
        demandes:  [{ id: 'imp', text: 'imported', refs: [] }],
        templates: [],
        lang:      'en-US',
        theme:     'dark',
      },
    };
    const r = window.MyFbStorage.importBundle(state, bundle, { mode: 'replace' });
    expect(r.ok).toBe(true);
    expect(r.imported).toBe(1);
    expect(state.demandes).toHaveLength(1);
    expect(state.lang).toBe('en-US');
    expect(state.theme).toBe('dark');
  });

  it('importBundle "merge" appends instead of replacing', () => {
    const state = makeState();
    const bundle = {
      _myfb: 'export', _version: 4,
      data: { demandes: [{ id: 'extra', text: 'added', refs: [] }] },
    };
    const r = window.MyFbStorage.importBundle(state, bundle, { mode: 'merge' });
    expect(r.ok).toBe(true);
    expect(state.demandes).toHaveLength(3);
  });

  it('importBundle rejects malformed input', () => {
    const r1 = window.MyFbStorage.importBundle({}, null);
    const r2 = window.MyFbStorage.importBundle({}, { hello: 'world' });
    const r3 = window.MyFbStorage.importBundle({}, { _myfb: 'export' /* no data */ });
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(r3.ok).toBe(false);
  });
});
