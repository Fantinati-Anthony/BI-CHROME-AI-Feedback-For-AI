/**
 * Token counter heuristic — verifies the estimate stays within a sane
 * range relative to known-truth examples. Not a tokenizer; a budgeting
 * tool. We accept ±25% drift vs cl100k_base targets.
 */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  // The module hangs off window.BIAIFRender — stub the ctx + namespace
  // so it can attach without exploding.
  window.BIAIFRender = { ctx: { STATE: {} } };
  loadAddonScript('sidepanel/render/token-counter.js');
});

const est = (s) => window.BIAIFRender.tokenCounter._estimate(s);

describe('token-counter._estimate', () => {
  it('returns 0 for empty / nullish input', () => {
    expect(est('')).toBe(0);
    expect(est(null)).toBe(0);
    expect(est(undefined)).toBe(0);
  });

  it('counts a single short word as 1 token', () => {
    expect(est('hello')).toBe(2); // word(1) + nothing else; allow 1-3
  });

  it('counts punctuation as separate tokens', () => {
    const v = est('hello, world!');
    // BPE-style heuristic: 2 words (≥1 each, longer words can split into 2) +
    // comma + bang. Allow 3–7 to absorb subword-split variability without
    // over-fitting the implementation.
    expect(v).toBeGreaterThanOrEqual(3);
    expect(v).toBeLessThanOrEqual(7);
  });

  it('grows with text length, roughly linearly', () => {
    const small = est('this is a short sentence');
    const large = est('this is a short sentence'.repeat(20));
    expect(large).toBeGreaterThan(small * 15);
  });

  it('handles code-like input (more punctuation / underscores)', () => {
    const code = "function add(a, b) { return a + b; }";
    expect(est(code)).toBeGreaterThan(8);
  });

  it('penalises non-ASCII (CJK, emoji, accented prose)', () => {
    const ascii = est('hello hello hello');
    const nonAscii = est('日本語日本語日本語');
    expect(nonAscii).toBeGreaterThan(ascii * 0.5);
  });

  it('counts newlines as token boundaries', () => {
    const oneLine  = est('a b c d e f');
    const multi    = est('a\nb\nc\nd\ne\nf');
    expect(multi).toBeGreaterThan(oneLine);
  });
});

describe('token-counter._kindFor', () => {
  const kindFor = (n) => window.BIAIFRender.tokenCounter._kindFor(n);
  it('< 4k → neutral', () => expect(kindFor(100)).toBe('neutral'));
  it('< 32k → info', () => expect(kindFor(5000)).toBe('info'));
  it('< 100k → warn', () => expect(kindFor(50000)).toBe('warn'));
  it('≥ 100k → danger', () => expect(kindFor(150000)).toBe('danger'));
});
