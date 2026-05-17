import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/scrub.js');
});

describe('MyFbScrub.scrubText', () => {
  it('masks email addresses', () => {
    expect(window.MyFbScrub.scrubText('Contact me at john.doe@example.com today'))
      .toBe('Contact me at [email] today');
  });

  it('masks JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(window.MyFbScrub.scrubText('Authorization: ' + jwt))
      .toBe('Authorization: [jwt]');
  });

  it('masks Bearer tokens', () => {
    expect(window.MyFbScrub.scrubText('Bearer abc123def456ghi789jklmnop'))
      .toBe('[token]');
  });

  it('masks sk- and pk- API keys', () => {
    expect(window.MyFbScrub.scrubText('OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz'))
      .toBe('OPENAI_API_KEY=[token]');
  });

  it('masks GitHub tokens (ghp_ etc.)', () => {
    expect(window.MyFbScrub.scrubText('GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyzAB'))
      .toBe('GH_TOKEN=[token]');
  });

  it('masks valid Luhn credit card numbers', () => {
    // 4111 1111 1111 1111 is the standard Visa test card (Luhn-valid)
    expect(window.MyFbScrub.scrubText('Card: 4111 1111 1111 1111'))
      .toBe('Card: [card]');
    expect(window.MyFbScrub.scrubText('Card: 4111-1111-1111-1111'))
      .toBe('Card: [card]');
  });

  it('does NOT mask numbers that fail Luhn', () => {
    expect(window.MyFbScrub.scrubText('Order id: 1234567890123456'))
      .toBe('Order id: 1234567890123456');
  });

  it('masks IBAN', () => {
    expect(window.MyFbScrub.scrubText('Wire to FR1420041010050500013M02606 please'))
      .toBe('Wire to [iban] please');
  });

  it('combines multiple patterns in one pass', () => {
    const input  = 'Email: test@x.com  Card: 4111111111111111  Token: Bearer abcdefghijklmnopqrstuvwxyz';
    const output = window.MyFbScrub.scrubText(input);
    expect(output).toContain('[email]');
    expect(output).toContain('[card]');
    expect(output).toContain('[token]');
    expect(output).not.toContain('test@x.com');
    expect(output).not.toContain('4111111111111111');
  });

  it('passes through text with no PII', () => {
    expect(window.MyFbScrub.scrubText('Refactor this function please'))
      .toBe('Refactor this function please');
  });

  it('handles empty/null input gracefully', () => {
    expect(window.MyFbScrub.scrubText('')).toBe('');
    expect(window.MyFbScrub.scrubText(null)).toBe(null);
    expect(window.MyFbScrub.scrubText(undefined)).toBe(undefined);
  });
});

describe('MyFbScrub._luhnOk', () => {
  it.each([
    ['4111111111111111', true],
    ['4111-1111-1111-1111', true],
    ['1234567890123456', false],
    ['4242424242424242', true],
    ['', false],
  ])('Luhn(%s) = %s', (n, expected) => {
    expect(window.MyFbScrub._luhnOk(n)).toBe(expected);
  });
});

describe('MyFbScrub.scrubRef / scrubDemande', () => {
  it('cleans every text field of a ref', () => {
    const ref = { type: 'element', text: 'a@b.com', outerHTML: '<x>a@b.com</x>', dataUrl: 'data:image/png;base64,XXX' };
    window.MyFbScrub.scrubRef(ref);
    expect(ref.text).toBe('[email]');
    expect(ref.outerHTML).toBe('<x>[email]</x>');
    expect(ref.dataUrl).toBe('data:image/png;base64,XXX'); // dataUrl is binary, not scrubbed
  });

  it('cleans demande.text and every nested ref', () => {
    const d = { text: 'see a@b.com', refs: [{ type: 't', text: 'sk-abcdef0123456789' }] };
    window.MyFbScrub.scrubDemande(d);
    expect(d.text).toBe('see [email]');
    expect(d.refs[0].text).toBe('[token]');
  });
});

describe('MyFbScrub.isEnabled', () => {
  it('defaults to true (opt-out)', () => {
    expect(window.MyFbScrub.isEnabled({})).toBe(true);
    expect(window.MyFbScrub.isEnabled(undefined)).toBe(true);
  });
  it('honours STATE.privacyScrub === false', () => {
    expect(window.MyFbScrub.isEnabled({ privacyScrub: false })).toBe(false);
  });
});
