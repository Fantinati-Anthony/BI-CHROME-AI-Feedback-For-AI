import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  loadAddonScript('shared/core/events/lamport.js');
});

describe('MyFb.core.lamport', () => {
  it('starts at 0 by default', () => {
    const c = window.MyFb.core.lamport.create();
    expect(c.now()).toBe(0);
  });

  it('starts at the provided initial value', () => {
    const c = window.MyFb.core.lamport.create(42);
    expect(c.now()).toBe(42);
  });

  it('tick() increments monotonically', () => {
    const c = window.MyFb.core.lamport.create();
    expect(c.tick()).toBe(1);
    expect(c.tick()).toBe(2);
    expect(c.tick()).toBe(3);
    expect(c.now()).toBe(3);
  });

  it('observe(remote) bumps to remote + 1 when remote is ahead', () => {
    const c = window.MyFb.core.lamport.create(5);
    c.observe(10);
    expect(c.now()).toBe(11);
    // Subsequent tick continues from there
    expect(c.tick()).toBe(12);
  });

  it('observe(remote) keeps local when local is ahead', () => {
    const c = window.MyFb.core.lamport.create(100);
    c.observe(5);
    expect(c.now()).toBe(100);
  });

  it('observe() ignores non-numbers and negative values', () => {
    const c = window.MyFb.core.lamport.create(5);
    // @ts-expect-error testing bad input
    c.observe('nope');
    c.observe(-1);
    expect(c.now()).toBe(5);
  });

  it('hydrate() only moves forward, never backward', () => {
    const c = window.MyFb.core.lamport.create(50);
    c.hydrate(100);
    expect(c.now()).toBe(100);
    c.hydrate(10);
    expect(c.now()).toBe(100);
  });

  it('two clocks observing each other converge', () => {
    const a = window.MyFb.core.lamport.create();
    const b = window.MyFb.core.lamport.create();
    // A emits 3 events
    const aTs1 = a.tick(); // 1
    const aTs2 = a.tick(); // 2
    const aTs3 = a.tick(); // 3
    // B receives them all
    b.observe(aTs1);
    b.observe(aTs2);
    b.observe(aTs3);
    // B's next tick must be > all of A's
    const bTs = b.tick();
    expect(bTs).toBeGreaterThan(aTs3);
  });
});
