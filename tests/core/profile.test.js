import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/core/profile.js');
});

function memStorage() {
  const mem = {};
  return {
    get:    (k) => Promise.resolve(mem[k] !== undefined ? { [k]: mem[k] } : {}),
    set:    (o) => { Object.assign(mem, o); return Promise.resolve(); },
    remove: (k) => { delete mem[k]; return Promise.resolve(); },
    _mem:   mem,
  };
}

const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('MyFb.core.profile — create', () => {
  it('builds a profile from a uuid + role', () => {
    const p = window.MyFb.core.profile.create({ uuid: UUID, role: 'admin', displayName: 'Alice' });
    expect(p.uuid).toBe(UUID);
    expect(p.role).toBe('admin');
    expect(p.displayName).toBe('Alice');
    expect(p.email).toBeNull();
    expect(typeof p.createdAt).toBe('number');
    expect(p.consent.includeDeviceUuid).toBe(true);
    expect(p.consent.includeBreadcrumbs).toBe(true); // admin default
    expect(p.consent.acceptedAt).toBeNull();
  });

  it('defaults role to null for unknown values', () => {
    const p = window.MyFb.core.profile.create({ uuid: UUID, role: 'wat' });
    expect(p.role).toBeNull();
  });

  it('client role gets restrictive default consent (no breadcrumbs)', () => {
    const p = window.MyFb.core.profile.create({ uuid: UUID, role: 'client' });
    expect(p.consent.includeBreadcrumbs).toBe(false);
    expect(p.consent.includeDeviceMeta).toBe(true);
  });

  it('throws without uuid', () => {
    expect(() => window.MyFb.core.profile.create({})).toThrow(/uuid/);
  });
});

describe('MyFb.core.profile — validate', () => {
  it('accepts a well-formed profile', () => {
    const p = window.MyFb.core.profile.create({ uuid: UUID, role: 'admin' });
    expect(window.MyFb.core.profile.validate(p)).not.toBeNull();
  });

  it('normalizes missing consent fields with safe defaults', () => {
    const raw = { uuid: UUID, role: 'admin', createdAt: 100 };
    const v = window.MyFb.core.profile.validate(raw);
    expect(v.consent.includeDeviceUuid).toBe(true);
    expect(v.consent.includeBreadcrumbs).toBe(false); // missing → safe default
  });

  it('rejects garbage', () => {
    expect(window.MyFb.core.profile.validate(null)).toBeNull();
    expect(window.MyFb.core.profile.validate(undefined)).toBeNull();
    expect(window.MyFb.core.profile.validate('hello')).toBeNull();
    expect(window.MyFb.core.profile.validate({})).toBeNull(); // no uuid
    expect(window.MyFb.core.profile.validate({ uuid: UUID, role: 'unknown' })).toBeNull();
  });
});

describe('MyFb.core.profile — update & consent', () => {
  it('update() merges and re-validates', () => {
    const p = window.MyFb.core.profile.create({ uuid: UUID, role: 'admin' });
    const p2 = window.MyFb.core.profile.update(p, { displayName: 'Bob' });
    expect(p2.displayName).toBe('Bob');
    expect(p2.uuid).toBe(UUID);
    expect(p2.role).toBe('admin');
  });

  it('update() deeply merges consent', () => {
    const p = window.MyFb.core.profile.create({ uuid: UUID, role: 'admin' });
    const p2 = window.MyFb.core.profile.update(p, { consent: { includeErrors: false } });
    expect(p2.consent.includeErrors).toBe(false);
    expect(p2.consent.includeDeviceMeta).toBe(true); // preserved
  });

  it('update() throws if the patch makes the profile invalid', () => {
    const p = window.MyFb.core.profile.create({ uuid: UUID, role: 'admin' });
    expect(() => window.MyFb.core.profile.update(p, { role: 'banana' })).toThrow();
  });

  it('acceptConsent() stamps acceptedAt and applies choices', () => {
    const p = window.MyFb.core.profile.create({ uuid: UUID, role: 'client' });
    expect(p.consent.acceptedAt).toBeNull();
    const p2 = window.MyFb.core.profile.acceptConsent(p, { includeBreadcrumbs: true });
    expect(p2.consent.acceptedAt).not.toBeNull();
    expect(p2.consent.includeBreadcrumbs).toBe(true);
  });
});

describe('MyFb.core.profile — onboarded heuristic', () => {
  it('hasOnboarded is false on a fresh profile', () => {
    const p = window.MyFb.core.profile.create({ uuid: UUID, role: 'admin' });
    expect(window.MyFb.core.profile.hasOnboarded(p)).toBe(false);
  });

  it('hasOnboarded becomes true after acceptConsent', () => {
    let p = window.MyFb.core.profile.create({ uuid: UUID, role: 'admin' });
    p = window.MyFb.core.profile.acceptConsent(p, {});
    expect(window.MyFb.core.profile.hasOnboarded(p)).toBe(true);
  });

  it('hasOnboarded is false without role even if consent was accepted', () => {
    let p = window.MyFb.core.profile.create({ uuid: UUID, role: null });
    p = { ...p, consent: { ...p.consent, acceptedAt: Date.now() } };
    expect(window.MyFb.core.profile.hasOnboarded(p)).toBe(false);
  });
});

describe('MyFb.core.profile — persistence', () => {
  let storage;
  beforeEach(() => {
    storage = memStorage();
    window.MyFb.core.profile.__setStorageImpl(storage);
  });

  it('load() returns null when nothing is stored', async () => {
    expect(await window.MyFb.core.profile.load()).toBeNull();
  });

  it('save() persists and load() round-trips', async () => {
    const p = window.MyFb.core.profile.create({ uuid: UUID, role: 'admin', displayName: 'X' });
    await window.MyFb.core.profile.save(p);
    const loaded = await window.MyFb.core.profile.load();
    expect(loaded).not.toBeNull();
    expect(loaded.uuid).toBe(UUID);
    expect(loaded.displayName).toBe('X');
  });

  it('save() rejects invalid profiles', async () => {
    await expect(window.MyFb.core.profile.save({ role: 'admin' })).rejects.toThrow(/invalid/);
  });

  it('clear() removes the stored profile', async () => {
    const p = window.MyFb.core.profile.create({ uuid: UUID, role: 'admin' });
    await window.MyFb.core.profile.save(p);
    await window.MyFb.core.profile.clear();
    expect(await window.MyFb.core.profile.load()).toBeNull();
  });

  it('load() returns null when the stored shape is garbage', async () => {
    await storage.set({ 'myfb:profile:v1': { not: 'a profile' } });
    expect(await window.MyFb.core.profile.load()).toBeNull();
  });
});
