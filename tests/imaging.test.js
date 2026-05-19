import { describe, it, expect, beforeAll } from 'vitest';

// Load the IIFE module under test.
beforeAll(() => {
  loadAddonScript('sidepanel/imaging.js');
});

describe('MyFbImaging.bytes', () => {
  it('returns 0 for empty input', () => {
    expect(window.MyFbImaging.bytes('')).toBe(0);
    expect(window.MyFbImaging.bytes(null)).toBe(0);
  });

  it('approximates base64 byte length', () => {
    const dataUrl = 'data:image/png;base64,' + 'A'.repeat(100);
    // 100 chars of base64 ≈ 75 bytes
    expect(window.MyFbImaging.bytes(dataUrl)).toBe(75);
  });
});

describe('MyFbImaging.compressDataUrl', () => {
  it('returns the original on bogus input', async () => {
    const out = await window.MyFbImaging.compressDataUrl(null);
    expect(out).toBe(null);
  });

  it('returns the original when Image fails to load', async () => {
    // jsdom's <canvas> isn't fully wired up — Image neither fires
    // onload nor onerror for synthetic data URLs. We stub it with a
    // version that calls onerror on the next tick so the module's
    // fallback path is exercised deterministically.
    const RealImage = window.Image;
    window.Image = function () {
      const img = {
        set src(_) { setTimeout(() => { img.onerror && img.onerror(); }, 0); },
        onload: null, onerror: null,
      };
      return img;
    };
    try {
      const dataUrl = 'data:image/png;base64,not-a-real-image';
      const out = await window.MyFbImaging.compressDataUrl(dataUrl);
      expect(out).toBe(dataUrl);
    } finally {
      window.Image = RealImage;
    }
  });
});
