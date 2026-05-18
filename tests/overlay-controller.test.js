import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/constants.js');
  loadAddonScript('sidepanel/overlay-controller.js');
});

const OC = () => window.MyFbOverlayController;

describe('OverlayController._urlMatches', () => {
  it('exact match', () => {
    expect(OC()._urlMatches('https://a.com/x', 'https://a.com/x')).toBe(true);
  });
  it('matches when hashes differ (SPA tolerance)', () => {
    expect(OC()._urlMatches('https://a.com/x#foo', 'https://a.com/x#bar')).toBe(true);
    expect(OC()._urlMatches('https://a.com/x',     'https://a.com/x#bar')).toBe(true);
  });
  it('does NOT match across different paths', () => {
    expect(OC()._urlMatches('https://a.com/x', 'https://a.com/y')).toBe(false);
  });
  it('does NOT match across hosts', () => {
    expect(OC()._urlMatches('https://a.com/x', 'https://b.com/x')).toBe(false);
  });
  it('returns false when either side is empty', () => {
    expect(OC()._urlMatches(null, 'https://a.com')).toBe(false);
    expect(OC()._urlMatches('https://a.com', null)).toBe(false);
    expect(OC()._urlMatches('', '')).toBe(false);
  });
});

describe('OverlayController._collectEntriesForUrl', () => {
  it('returns empty when no demandes', () => {
    expect(OC()._collectEntriesForUrl([], 'https://a.com')).toEqual([]);
  });

  it('extracts refs whose tabUrl matches the active URL', () => {
    const demandes = [
      {
        id: 'd1', url: 'https://a.com/page', text: 'Demande one',
        refs: [
          { id: 'r1', type: 'element', selector: '.btn', tabUrl: 'https://a.com/page', box: { x: 0, y: 0, w: 10, h: 10 } },
          { id: 'r2', type: 'screenshot', tabUrl: 'https://other.com', box: { x: 0, y: 0, w: 10, h: 10 } },
        ],
      },
      {
        id: 'd2', url: 'https://other.com', text: 'Demande two',
        refs: [
          { id: 'r3', type: 'element', selector: '.menu', tabUrl: 'https://a.com/page', box: { x: 1, y: 1, w: 5, h: 5 } },
        ],
      },
    ];
    const out = OC()._collectEntriesForUrl(demandes, 'https://a.com/page');
    expect(out.length).toBe(2);
    const ids = out.map((e) => e.ref.id).sort();
    expect(ids).toEqual(['r1', 'r3']);
  });

  it('uses demande.url as fallback when ref has no tabUrl', () => {
    const demandes = [
      {
        id: 'd1', url: 'https://a.com/x', text: 'd1',
        refs: [{ id: 'r1', type: 'element', selector: '.x' /* no tabUrl */ }],
      },
    ];
    const out = OC()._collectEntriesForUrl(demandes, 'https://a.com/x');
    expect(out.length).toBe(1);
    expect(out[0].demandeIndex).toBe(1);
    expect(out[0].demandeId).toBe('d1');
  });

  it('attaches the 1-based demande index + truncated text snippet', () => {
    const demandes = [
      { id: 'd1', url: 'https://a.com', text: 'first', refs: [] },
      { id: 'd2', url: 'https://a.com', text: '  many   spaces  ', refs: [
        { id: 'r1', type: 'element', selector: '.x', tabUrl: 'https://a.com' },
      ] },
    ];
    const out = OC()._collectEntriesForUrl(demandes, 'https://a.com');
    expect(out.length).toBe(1);
    expect(out[0].demandeIndex).toBe(2);
    expect(out[0].demandeText).toBe('many spaces');
  });

  it('skips ref entries that are missing/invalid', () => {
    const demandes = [
      { id: 'd1', url: 'https://a.com', text: '', refs: [null, undefined,
        { id: 'r1', type: 'element', selector: '.btn', tabUrl: 'https://a.com' }] },
    ];
    const out = OC()._collectEntriesForUrl(demandes, 'https://a.com');
    expect(out.length).toBe(1);
    expect(out[0].ref.id).toBe('r1');
  });
});
