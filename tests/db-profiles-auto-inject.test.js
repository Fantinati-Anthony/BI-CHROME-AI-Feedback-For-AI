import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import crypto from 'node:crypto';

beforeAll(() => {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    globalThis.crypto = crypto.webcrypto;
  }
  // db-profiles-ui requires the crypto helper at init for legacy migration.
  loadAddonScript('sidepanel/db-secret-crypto.js');
  loadAddonScript('sidepanel/db-profiles-ui.js');
});

function _state(profiles, draftOverrides) {
  return {
    dbProfiles: profiles,
    currentDemande: Object.assign({ text: '', refs: [], pageUrl: null }, draftOverrides || {}),
  };
}

describe('MyFbDbProfilesUi.autoInjectForSession', () => {
  it('injects schemaMd of every autoInject profile into an empty draft', () => {
    const st = _state([
      { id: 'a', label: 'WP prod',     schemaMd: 'TABLE wp_posts (id int, title text)', autoInject: true, mode: 'paste' },
      { id: 'b', label: 'Stripe data', schemaMd: 'TABLE customers (id int, email)',     autoInject: true, mode: 'paste' },
    ]);
    const changed = window.MyFbDbProfilesUi.autoInjectForSession(st);
    expect(changed).toBe(true);
    expect(st.currentDemande.text).toMatch(/myfb-db-context/);
    expect(st.currentDemande.text).toMatch(/WP prod/);
    expect(st.currentDemande.text).toMatch(/Stripe data/);
    expect(st.currentDemande.text).toMatch(/wp_posts/);
  });

  it('does not inject when no profile has autoInject', () => {
    const st = _state([
      { id: 'x', label: 'Other', schemaMd: 'TABLE foo', autoInject: false, mode: 'paste' },
    ]);
    expect(window.MyFbDbProfilesUi.autoInjectForSession(st)).toBe(false);
    expect(st.currentDemande.text).toBe('');
  });

  it('skips profiles with empty schemaMd even if autoInject is on', () => {
    const st = _state([
      { id: 'a', label: 'Empty', schemaMd: '', autoInject: true, mode: 'bridge' },
    ]);
    expect(window.MyFbDbProfilesUi.autoInjectForSession(st)).toBe(false);
    expect(st.currentDemande.text).toBe('');
  });

  it('skips when the draft already has text', () => {
    const st = _state(
      [{ id: 'a', label: 'X', schemaMd: 'TABLE foo', autoInject: true, mode: 'paste' }],
      { text: 'déjà commencé à taper' },
    );
    expect(window.MyFbDbProfilesUi.autoInjectForSession(st)).toBe(false);
    expect(st.currentDemande.text).toBe('déjà commencé à taper');
  });

  it('skips when the draft already has refs', () => {
    const st = _state(
      [{ id: 'a', label: 'X', schemaMd: 'TABLE foo', autoInject: true, mode: 'paste' }],
      { refs: [{ type: 'screenshot', dataUrl: 'data:,' }] },
    );
    expect(window.MyFbDbProfilesUi.autoInjectForSession(st)).toBe(false);
    expect(st.currentDemande.text).toBe('');
  });

  it('does not re-inject if the sentinel is already present', () => {
    const st = _state(
      [{ id: 'a', label: 'X', schemaMd: 'TABLE foo', autoInject: true, mode: 'paste' }],
      { text: '<!-- myfb-db-context --> stale block <!-- /myfb-db-context -->' },
    );
    expect(window.MyFbDbProfilesUi.autoInjectForSession(st)).toBe(false);
  });

  it('handles missing dbProfiles array gracefully', () => {
    const st = { currentDemande: { text: '', refs: [], pageUrl: null } };
    expect(window.MyFbDbProfilesUi.autoInjectForSession(st)).toBe(false);
    expect(st.currentDemande.text).toBe('');
  });

  it('handles missing currentDemande gracefully', () => {
    const st = { dbProfiles: [{ id: 'a', schemaMd: 'X', autoInject: true }] };
    expect(window.MyFbDbProfilesUi.autoInjectForSession(st)).toBe(false);
  });
});
