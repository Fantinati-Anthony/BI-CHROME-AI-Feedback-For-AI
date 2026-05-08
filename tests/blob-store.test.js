import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
  loadAddonScript('sidepanel/blob-store.js');
});

// Reset the IndexedDB instance before each test so we get an isolated DB.
async function _wipe() {
  const all = await window.BIAIFBlobStore.size().catch(() => 0); // touch to ensure DB exists
  // No public reset; gc() with empty active list deletes everything.
  await window.BIAIFBlobStore.gc([]);
  return all;
}

describe('BIAIFBlobStore.put / get / remove', () => {
  beforeEach(async () => { await _wipe(); });

  it('put returns an id, get returns the same dataUrl', async () => {
    const url = 'data:image/png;base64,AAA';
    const id  = await window.BIAIFBlobStore.put(url);
    expect(typeof id).toBe('string');
    expect(id.startsWith('blob-')).toBe(true);
    const out = await window.BIAIFBlobStore.get(id);
    expect(out).toBe(url);
  });

  it('returns null when getting an unknown id', async () => {
    const out = await window.BIAIFBlobStore.get('nope');
    expect(out).toBe(null);
  });

  it('returns null when getting a falsy id', async () => {
    expect(await window.BIAIFBlobStore.get('')).toBe(null);
    expect(await window.BIAIFBlobStore.get(null)).toBe(null);
  });

  it('put returns null when input is empty', async () => {
    expect(await window.BIAIFBlobStore.put('')).toBe(null);
  });

  it('remove deletes a blob and get returns null afterwards', async () => {
    const id = await window.BIAIFBlobStore.put('data:image/png;base64,X');
    expect(await window.BIAIFBlobStore.remove(id)).toBe(true);
    expect(await window.BIAIFBlobStore.get(id)).toBe(null);
  });

  it('remove returns false on empty input', async () => {
    expect(await window.BIAIFBlobStore.remove('')).toBe(false);
    expect(await window.BIAIFBlobStore.remove(null)).toBe(false);
  });
});

describe('BIAIFBlobStore.gc', () => {
  beforeEach(async () => { await _wipe(); });

  it('removes blobs not in the active list', async () => {
    const a = await window.BIAIFBlobStore.put('A');
    const b = await window.BIAIFBlobStore.put('B');
    const c = await window.BIAIFBlobStore.put('C');
    const removed = await window.BIAIFBlobStore.gc([a, c]);
    expect(removed).toBe(1);
    expect(await window.BIAIFBlobStore.get(a)).toBe('A');
    expect(await window.BIAIFBlobStore.get(b)).toBe(null);
    expect(await window.BIAIFBlobStore.get(c)).toBe('C');
  });

  it('removes everything when active list is empty', async () => {
    await window.BIAIFBlobStore.put('X');
    await window.BIAIFBlobStore.put('Y');
    const removed = await window.BIAIFBlobStore.gc([]);
    expect(removed).toBe(2);
  });

  it('removes nothing when all blobs are referenced', async () => {
    const a = await window.BIAIFBlobStore.put('A');
    const b = await window.BIAIFBlobStore.put('B');
    expect(await window.BIAIFBlobStore.gc([a, b])).toBe(0);
  });
});

describe('BIAIFBlobStore.size', () => {
  beforeEach(async () => { await _wipe(); });

  it('returns 0 on an empty store', async () => {
    expect(await window.BIAIFBlobStore.size()).toBe(0);
  });

  it('sums byte length across all blobs', async () => {
    await window.BIAIFBlobStore.put('hello');
    await window.BIAIFBlobStore.put('world!');
    expect(await window.BIAIFBlobStore.size()).toBe(11);
  });
});

describe('BIAIFBlobStore.rehydrateRefs', () => {
  beforeEach(async () => { await _wipe(); });

  it('resolves blobIds in refs to inline dataUrls', async () => {
    const url = 'data:image/png;base64,Z';
    const id  = await window.BIAIFBlobStore.put(url);
    const refs = [{ type: 'screenshot', blobId: id }];
    await window.BIAIFBlobStore.rehydrateRefs(refs);
    expect(refs[0].dataUrl).toBe(url);
  });

  it('keeps refs that already have a dataUrl untouched', async () => {
    const refs = [{ type: 'screenshot', blobId: 'fake', dataUrl: 'INLINE' }];
    await window.BIAIFBlobStore.rehydrateRefs(refs);
    expect(refs[0].dataUrl).toBe('INLINE');
  });

  it('skips refs with no blobId', async () => {
    const refs = [{ type: 'element' }];
    await window.BIAIFBlobStore.rehydrateRefs(refs);
    expect(refs[0].dataUrl).toBeUndefined();
  });

  it('returns the input as-is when given a non-array', async () => {
    expect(await window.BIAIFBlobStore.rehydrateRefs(null)).toBe(null);
    expect(await window.BIAIFBlobStore.rehydrateRefs('x')).toBe('x');
  });
});
