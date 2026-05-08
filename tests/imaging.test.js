import { describe, it, expect, beforeAll } from 'vitest';

// Load the IIFE module under test.
beforeAll(() => {
  loadAddonScript('sidepanel/imaging.js');
});

describe('BIAIFImaging.bytes', () => {
  it('returns 0 for empty input', () => {
    expect(window.BIAIFImaging.bytes('')).toBe(0);
    expect(window.BIAIFImaging.bytes(null)).toBe(0);
  });

  it('approximates base64 byte length', () => {
    const dataUrl = 'data:image/png;base64,' + 'A'.repeat(100);
    // 100 chars of base64 ≈ 75 bytes
    expect(window.BIAIFImaging.bytes(dataUrl)).toBe(75);
  });
});

describe('BIAIFImaging.compressDataUrl', () => {
  it('returns the original on bogus input', async () => {
    const out = await window.BIAIFImaging.compressDataUrl(null);
    expect(out).toBe(null);
  });

  it('returns the original when Image fails to load', async () => {
    // jsdom's <canvas> isn't fully wired up — Image.onerror fires for
    // invalid base64 — the module falls back to the original dataUrl.
    const dataUrl = 'data:image/png;base64,not-a-real-image';
    const out = await window.BIAIFImaging.compressDataUrl(dataUrl);
    expect(out).toBe(dataUrl);
  });
});
