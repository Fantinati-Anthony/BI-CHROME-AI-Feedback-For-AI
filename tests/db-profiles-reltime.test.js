import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';

beforeAll(() => {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    globalThis.crypto = crypto.webcrypto;
  }
  // i18n provides the {n} placeholder substitution that _relTime relies on.
  loadAddonScript('shared/constants.js');
  loadAddonScript('shared/i18n.js');
  loadAddonScript('shared/utils.js');
  loadAddonScript('sidepanel/db-secret-crypto.js');
  loadAddonScript('sidepanel/db-profiles-ui.js');
});

describe('MyFbDbProfilesUi._relTime', () => {
  const rel = (ts, now) => window.MyFbDbProfilesUi._relTime(ts, now);
  const NOW = 1716000000000;

  it('returns empty string for falsy / non-number ts', () => {
    expect(rel(0)).toBe('');
    expect(rel(null)).toBe('');
    expect(rel(undefined)).toBe('');
    expect(rel('notnumber')).toBe('');
  });

  it('< 5 s → "just now" bucket', () => {
    expect(rel(NOW - 0,     NOW)).toMatch(/instant|now/i);
    expect(rel(NOW - 4000,  NOW)).toMatch(/instant|now/i);
  });

  it('5–59 s → seconds bucket', () => {
    expect(rel(NOW - 5000,  NOW)).toMatch(/5/);
    expect(rel(NOW - 30000, NOW)).toMatch(/30/);
    expect(rel(NOW - 59999, NOW)).toMatch(/59/);
  });

  it('1–59 min → minutes bucket', () => {
    expect(rel(NOW - 60_000,      NOW)).toMatch(/1/);
    expect(rel(NOW - 5 * 60_000,  NOW)).toMatch(/5/);
    expect(rel(NOW - 59 * 60_000, NOW)).toMatch(/59/);
  });

  it('1–23 h → hours bucket', () => {
    expect(rel(NOW - 60 * 60_000,        NOW)).toMatch(/1/);
    expect(rel(NOW - 12 * 60 * 60_000,   NOW)).toMatch(/12/);
    expect(rel(NOW - 23 * 60 * 60_000,   NOW)).toMatch(/23/);
  });

  it('1–6 days → days bucket', () => {
    expect(rel(NOW - 24 * 60 * 60_000,      NOW)).toMatch(/1/);
    expect(rel(NOW - 6  * 24 * 60 * 60_000, NOW)).toMatch(/6/);
  });

  it('≥ 7 days → falls back to YYYY-MM-DD', () => {
    const out = rel(NOW - 8 * 24 * 60 * 60_000, NOW);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('handles future ts by clamping to 0 ("just now")', () => {
    // Don't blow up if the clock skewed backwards — show "just now".
    expect(rel(NOW + 10000, NOW)).toMatch(/instant|now/i);
  });
});
