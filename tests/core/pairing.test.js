import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/core/pairing.js');
});

const UUID_A = 'a3f2c1b8-1234-4abc-9def-0123456789ab';
const UUID_B = 'b7e9d2c0-9876-4fed-8cba-fedcba987654';

describe('pairing.generateCode', () => {
  it('produces a code in MYFB-XXXXXX format', () => {
    const code = window.MyFb.core.pairing.generateCode({ uuid: UUID_A });
    expect(code).toMatch(/^MYFB-[A-Z2-7]{6}$/);
  });

  it('is deterministic for the same uuid', () => {
    const c1 = window.MyFb.core.pairing.generateCode({ uuid: UUID_A });
    const c2 = window.MyFb.core.pairing.generateCode({ uuid: UUID_A });
    expect(c2).toBe(c1);
  });

  it('produces different codes for different uuids', () => {
    const c1 = window.MyFb.core.pairing.generateCode({ uuid: UUID_A });
    const c2 = window.MyFb.core.pairing.generateCode({ uuid: UUID_B });
    expect(c1).not.toBe(c2);
  });

  it('throws without a uuid', () => {
    expect(() => window.MyFb.core.pairing.generateCode({})).toThrow(/uuid/);
    expect(() => window.MyFb.core.pairing.generateCode(null)).toThrow(/uuid/);
  });
});

describe('pairing.parseCode', () => {
  it('accepts a freshly generated code (round-trip)', () => {
    const code = window.MyFb.core.pairing.generateCode({ uuid: UUID_A });
    const out  = window.MyFb.core.pairing.parseCode(code);
    expect(out.ok).toBe(true);
    expect(out.fingerprint).toBe(window.MyFb.core.pairing.fingerprintOf(UUID_A));
  });

  it('accepts the code with surrounding whitespace + mixed case', () => {
    const code = window.MyFb.core.pairing.generateCode({ uuid: UUID_A });
    const messy = '  ' + code.toLowerCase() + '  ';
    expect(window.MyFb.core.pairing.parseCode(messy).ok).toBe(true);
  });

  it('rejects codes with bad checksum', () => {
    // Pick a code with a corrupted last char that's clearly not the checksum
    const code = 'MYFB-AAAAAB'; // payload AAAAA → checksum should be different
    const out = window.MyFb.core.pairing.parseCode(code);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('checksum');
  });

  it('rejects malformed codes', () => {
    expect(window.MyFb.core.pairing.parseCode('').ok).toBe(false);
    expect(window.MyFb.core.pairing.parseCode('MYFB-XYZ').ok).toBe(false);
    expect(window.MyFb.core.pairing.parseCode('NOPE-AAAAAA').ok).toBe(false);
    expect(window.MyFb.core.pairing.parseCode('myfb-aaaa').ok).toBe(false); // too short
    expect(window.MyFb.core.pairing.parseCode(123).ok).toBe(false);
    expect(window.MyFb.core.pairing.parseCode(null).ok).toBe(false);
  });

  it('handles colon, dash, and space separators between prefix and code', () => {
    const code = window.MyFb.core.pairing.generateCode({ uuid: UUID_A });
    const body = code.replace('MYFB-', '');
    expect(window.MyFb.core.pairing.parseCode('MYFB ' + body).ok).toBe(true);
    expect(window.MyFb.core.pairing.parseCode('MYFB:' + body).ok).toBe(true);
  });
});

describe('pairing.fingerprintOf', () => {
  it('returns a 5-char base32 string', () => {
    const fp = window.MyFb.core.pairing.fingerprintOf(UUID_A);
    expect(fp).toMatch(/^[A-Z2-7]{5}$/);
  });

  it('matches the payload embedded in generateCode', () => {
    const code = window.MyFb.core.pairing.generateCode({ uuid: UUID_A });
    const fp   = window.MyFb.core.pairing.fingerprintOf(UUID_A);
    expect(code).toBe('MYFB-' + fp + window.MyFb.core.pairing._checksum(fp));
  });
});

describe('pairing._hashUuid', () => {
  it('produces a 32-bit unsigned integer', () => {
    const h = window.MyFb.core.pairing._hashUuid(UUID_A);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xFFFFFFFF);
  });

  it('produces different hashes for similar inputs', () => {
    const h1 = window.MyFb.core.pairing._hashUuid('aaaaaaaa-1');
    const h2 = window.MyFb.core.pairing._hashUuid('aaaaaaaa-2');
    expect(h1).not.toBe(h2);
  });
});
