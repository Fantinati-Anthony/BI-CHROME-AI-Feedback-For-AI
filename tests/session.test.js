/**
 * Tests for the pure logic in sidepanel/session.js — finalizeDemande,
 * mergeDemandes, reorderDemande, syncCurrentDemandeFromEditor.
 *
 * These don't exercise the UI layer (renderer is stubbed). They verify
 * that the state transitions are correct, deterministic and idempotent.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Stub all DOM-touching collaborators that session.js calls.
const noop = () => {};
window.BIAIFStorage = { persist: noop };
window.BIAIFToast   = { show: noop, showAction: noop };
window.BIAIFSpeech  = { clearInterimGhost: noop, startMic: noop, stopMic: noop, getMicState: () => ({}) };

// Renderer stub
window.BIAIFRenderer = {
  renderDemandeEditor:    noop,
  renderDemandeRefsStrip: noop,
  renderSegments:         noop,
  appendChipToEditor:     noop,
  updateMasterBtnLabel:   noop,
  updateArmedUi:          noop,
  updateEditorContext:    noop,
};

beforeAll(() => {
  loadAddonScript('shared/constants.js');
  loadAddonScript('shared/utils.js');
  loadAddonScript('shared/scrub.js');
  loadAddonScript('sidepanel/session.js');
});

function makeState() {
  return {
    armed:                false,
    pickerActive:         false,
    micActive:            false,
    currentInterim:       '',
    currentDemande:       { text: '', refs: [], pageUrl: null },
    demandes:             [],
    editingDemandeIdx:    null,
    dictationTarget:      'current',
    modalTarget:          'current',
    pendingConversationUrl: null,
    pendingRepoId:        null,
    visibleButtons:       {},
    privacyScrub:         false,
    templates:            [],
  };
}

function makeRefs() {
  const ed = document.createElement('div');
  ed.contentEditable = 'true';
  document.body.appendChild(ed);
  return { demandeEditor: ed, masterBtn: document.createElement('button') };
}

describe('mergeDemandes', () => {
  let state, refs;
  beforeEach(() => {
    state = makeState();
    refs  = makeRefs();
    state.demandes = [
      { id: 'a', ts: 1, text: 'first', refs: [], url: 'u1' },
      { id: 'b', ts: 2, text: 'second', refs: [{ type: 'el', selector: '.btn' }], url: 'u2' },
      { id: 'c', ts: 3, text: 'third', refs: [], url: 'u3' },
    ];
    window.BIAIFSession.init(state, refs);
  });

  it('drops src and concatenates text + refs into dst', () => {
    window.BIAIFSession.mergeDemandes(0, 1);
    expect(state.demandes).toHaveLength(2);
    // mergeDemandes(src=0, dst=1) → dst (was 'second' at idx 1) absorbs
    // src text. Order is dst.text first, then src.text appended.
    // After splice src=0, indices shift — dst is now at idx 0.
    expect(state.demandes[0].text).toBe('second first');
    expect(state.demandes[0].refs).toHaveLength(1);
  });

  it('shifts ref placeholders correctly when src has {{ref:n}}', () => {
    state.demandes = [
      { id: 'a', ts: 1, text: 'see {{ref:0}}', refs: [{ type: 't', selector: 'a' }] },
      { id: 'b', ts: 2, text: 'has {{ref:0}}', refs: [{ type: 't', selector: 'b' }] },
    ];
    window.BIAIFSession.mergeDemandes(0, 1);
    expect(state.demandes).toHaveLength(1);
    // Source merged in: its {{ref:0}} should be remapped to {{ref:1}}
    // because dst already had refs[0].
    expect(state.demandes[0].text).toBe('has {{ref:0}} see {{ref:1}}');
    expect(state.demandes[0].refs).toHaveLength(2);
  });

  it('is a noop when src === dst', () => {
    const before = JSON.stringify(state.demandes);
    window.BIAIFSession.mergeDemandes(1, 1);
    expect(JSON.stringify(state.demandes)).toBe(before);
  });
});

describe('reorderDemande', () => {
  let state;
  beforeEach(() => {
    state = makeState();
    window.BIAIFSession.init(state, makeRefs());
    state.demandes = [
      { id: 'a', text: 'A', refs: [] },
      { id: 'b', text: 'B', refs: [] },
      { id: 'c', text: 'C', refs: [] },
    ];
  });

  it('moves a segment forward (0 → end)', () => {
    window.BIAIFSession.reorderDemande(0, 3);
    expect(state.demandes.map(d => d.id)).toEqual(['b', 'c', 'a']);
  });

  it('moves a segment backward (2 → 0)', () => {
    window.BIAIFSession.reorderDemande(2, 0);
    expect(state.demandes.map(d => d.id)).toEqual(['c', 'a', 'b']);
  });

  it('is a noop when dst is the same logical position', () => {
    const before = state.demandes.map(d => d.id).join(',');
    window.BIAIFSession.reorderDemande(0, 0);
    window.BIAIFSession.reorderDemande(0, 1); // would put it where it already is
    expect(state.demandes.map(d => d.id).join(',')).toBe(before);
  });

  it('updates editingDemandeIdx when the edited segment is moved', () => {
    state.editingDemandeIdx = 0;
    window.BIAIFSession.reorderDemande(0, 3);
    expect(state.editingDemandeIdx).toBe(2);
  });

  it('decrements editingDemandeIdx when a previous segment moves past it', () => {
    state.editingDemandeIdx = 1;
    window.BIAIFSession.reorderDemande(0, 3);
    // 'a' moved from 0 to end → 'b' (was idx 1) is now idx 0
    expect(state.editingDemandeIdx).toBe(0);
  });
});

describe('finalizeDemande (new segment)', () => {
  let state, refs;
  beforeEach(() => {
    state = makeState();
    refs  = makeRefs();
    refs.demandeEditor.textContent = 'Hello world';
    state.armed = true;
    state.currentDemande = { text: 'Hello world', refs: [], pageUrl: 'u' };
    window.BIAIFSession.init(state, refs);
  });

  it('appends to demandes and clears the current draft', () => {
    window.BIAIFSession.finalizeDemande(true);
    expect(state.demandes).toHaveLength(1);
    expect(state.demandes[0].text).toBe('Hello world');
    expect(state.currentDemande.text).toBe('');
    expect(state.currentDemande.refs).toEqual([]);
  });

  it('disarms after a save (back-to-history flow)', () => {
    state.armed = true;
    window.BIAIFSession.finalizeDemande(true);
    expect(state.armed).toBe(false);
  });
});

describe('enterEditMode / exitEditMode roundtrip', () => {
  let state, refs;
  beforeEach(() => {
    state = makeState();
    refs  = makeRefs();
    state.demandes = [{ id: 'a', text: 'old text', refs: [{ type: 'x' }], url: 'u' }];
    window.BIAIFSession.init(state, refs);
  });

  it('backs up the current draft and loads the segment', () => {
    state.currentDemande = { text: 'draft', refs: [{ type: 'y' }], pageUrl: null };
    window.BIAIFSession.enterEditMode(0);
    expect(state.editingDemandeIdx).toBe(0);
    expect(state.currentDemande.text).toBe('old text');
    expect(state.armed).toBe(true);
  });

  it('exitEditMode restores the previous draft', () => {
    state.currentDemande = { text: 'my work in progress', refs: [], pageUrl: null };
    window.BIAIFSession.enterEditMode(0);
    window.BIAIFSession.exitEditMode({ silent: true });
    expect(state.editingDemandeIdx).toBe(null);
    expect(state.currentDemande.text).toBe('my work in progress');
  });
});
