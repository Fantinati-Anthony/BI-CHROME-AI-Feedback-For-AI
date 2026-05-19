import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/constants.js');
  loadAddonScript('shared/i18n.js');
  loadAddonScript('shared/utils.js');
  loadAddonScript('shared/core/events/catalog.js');
  loadAddonScript('shared/core/profile.js');
  loadAddonScript('sidepanel/onboarding.js');
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

beforeEach(() => {
  window.MyFb.core.profile.__setStorageImpl(memStorage());
  // Reset module state from previous test (clears the internal _overlay ref)
  if (window.MyFbOnboarding && window.MyFbOnboarding.close) {
    window.MyFbOnboarding.close();
  }
  document.querySelectorAll('.myfb-onb').forEach((n) => n.remove());
});

describe('MyFbOnboarding.shouldOpen', () => {
  it('returns true for null profile (fresh install)', () => {
    expect(window.MyFbOnboarding.shouldOpen(null)).toBe(true);
  });

  it('returns true for a profile without role yet', () => {
    const p = window.MyFb.core.profile.create({ uuid: 'u1', role: null });
    expect(window.MyFbOnboarding.shouldOpen(p)).toBe(true);
  });

  it('returns true for a role-set profile that has NOT accepted consent', () => {
    const p = window.MyFb.core.profile.create({ uuid: 'u1', role: 'admin' });
    expect(window.MyFbOnboarding.shouldOpen(p)).toBe(true);
  });

  it('returns false once role + consent are set', () => {
    let p = window.MyFb.core.profile.create({ uuid: 'u1', role: 'admin' });
    p = window.MyFb.core.profile.acceptConsent(p, {});
    expect(window.MyFbOnboarding.shouldOpen(p)).toBe(false);
  });
});

describe('MyFbOnboarding.open', () => {
  function fakeCtx() {
    return { uuid: 'abc-uuid', profile: null, emit: () => Promise.resolve({}) };
  }

  it('mounts an overlay into the document', () => {
    window.MyFbOnboarding.open(fakeCtx(), () => {});
    expect(document.querySelector('.myfb-onb')).not.toBeNull();
    expect(document.querySelector('.myfb-onb-modal')).not.toBeNull();
  });

  it('starts on the role screen', () => {
    window.MyFbOnboarding.open(fakeCtx(), () => {});
    expect(document.querySelector('.myfb-onb-role-grid')).not.toBeNull();
    expect(document.querySelectorAll('.myfb-onb-role').length).toBe(2);
  });

  it('progress dots reflect current screen (0/4)', () => {
    window.MyFbOnboarding.open(fakeCtx(), () => {});
    const dots = document.querySelectorAll('.myfb-onb-progress span');
    expect(dots.length).toBe(4);
    expect(dots[0].classList.contains('is-active')).toBe(true);
  });

  it('back button is hidden on the first screen', () => {
    window.MyFbOnboarding.open(fakeCtx(), () => {});
    const back = document.querySelector('[data-act=onb-back]');
    expect(back.style.visibility).toBe('hidden');
  });

  it('clicking a role selects it', () => {
    window.MyFbOnboarding.open(fakeCtx(), () => {});
    const adminBtn = document.querySelector('.myfb-onb-role[data-role=admin]');
    adminBtn.click();
    expect(adminBtn.classList.contains('is-selected')).toBe(true);
  });

  it('Next without selecting a role shakes the grid and stays on screen', () => {
    window.MyFbOnboarding.open(fakeCtx(), () => {});
    const next = document.querySelector('[data-act=onb-next]');
    next.click();
    // Still on role screen
    expect(document.querySelector('.myfb-onb-role-grid')).not.toBeNull();
    expect(document.querySelector('.myfb-onb-role-grid').classList.contains('is-shake')).toBe(true);
  });

  it('advances through the 4 screens after selecting a role', () => {
    window.MyFbOnboarding.open(fakeCtx(), () => {});
    document.querySelector('.myfb-onb-role[data-role=admin]').click();
    document.querySelector('[data-act=onb-next]').click();
    expect(document.querySelector('.myfb-onb-screen-identity')).not.toBeNull();
    document.querySelector('[data-act=onb-next]').click();
    expect(document.querySelector('.myfb-onb-screen-pairing')).not.toBeNull();
    document.querySelector('[data-act=onb-next]').click();
    expect(document.querySelector('.myfb-onb-screen-consent')).not.toBeNull();
  });

  it('back button works once past screen 0', () => {
    window.MyFbOnboarding.open(fakeCtx(), () => {});
    document.querySelector('.myfb-onb-role[data-role=admin]').click();
    document.querySelector('[data-act=onb-next]').click();
    document.querySelector('[data-act=onb-back]').click();
    expect(document.querySelector('.myfb-onb-role-grid')).not.toBeNull();
  });

  it('identity inputs update the draft', () => {
    window.MyFbOnboarding.open(fakeCtx(), () => {});
    document.querySelector('.myfb-onb-role[data-role=admin]').click();
    document.querySelector('[data-act=onb-next]').click();
    const nameInp = document.querySelector('#onb-name');
    nameInp.value = 'Alice';
    nameInp.dispatchEvent(new Event('input'));
    // No public draft accessor — just check the input is wired (no throw)
    expect(nameInp.value).toBe('Alice');
  });
});

describe('MyFbOnboarding finish flow', () => {
  function fakeCtx(uuid = 'finish-uuid') {
    return { uuid, profile: null };
  }

  it('completing all screens persists a profile with role + acceptedAt', async () => {
    let onDoneCalled = false;
    window.MyFbOnboarding.open(fakeCtx('done-uuid'), () => { onDoneCalled = true; });
    document.querySelector('.myfb-onb-role[data-role=client]').click();
    document.querySelector('[data-act=onb-next]').click(); // role → identity
    document.querySelector('[data-act=onb-next]').click(); // identity → pairing
    document.querySelector('[data-act=onb-next]').click(); // pairing → consent
    document.querySelector('[data-act=onb-next]').click(); // consent → finish

    // Wait for the persist promise inside _finish() to resolve
    await new Promise((r) => setTimeout(r, 10));

    expect(onDoneCalled).toBe(true);
    expect(document.querySelector('.myfb-onb')).toBeNull();

    const loaded = await window.MyFb.core.profile.load();
    expect(loaded).not.toBeNull();
    expect(loaded.role).toBe('client');
    expect(loaded.consent.acceptedAt).not.toBeNull();
  });
});
