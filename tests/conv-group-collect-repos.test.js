/**
 * Tests for MyFbRender.convGroups._collectRepoIds — the helper that
 * aggregates the union of `repoId` across a group of segments (+ their
 * refs) for the conversation header badge row (PR #145).
 *
 * Loading the IIFE requires the MyFbRender + ctx scaffolding ; we stub
 * a minimal version so the module finds what it needs on the window.
 */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  // The module attaches to window.MyFbRender.* — provide the ctx
  // singleton + a fake icons stub so the import side-effects are no-ops.
  window.MyFbRender = window.MyFbRender || {};
  window.MyFbRender.ctx = window.MyFbRender.ctx || { STATE: {} };
  window.MyFbRender.icons = window.MyFbRender.icons || {
    repo: () => '<svg/>',
    chat: () => '<svg/>',
    chevronDn: () => '<svg/>',
  };
  loadAddonScript('sidepanel/render/conversation-group.js');
});

const collect = (items) => window.MyFbRender.convGroups._collectRepoIds(items);

function _item(repoId, refRepos) {
  return {
    dem: {
      repoId: repoId || null,
      refs: (refRepos || []).map((r) => ({ repoId: r })),
    },
  };
}

describe('MyFbRender.convGroups._collectRepoIds', () => {
  it('returns empty array for empty input', () => {
    expect(collect([])).toEqual([]);
  });

  it('returns empty array when no items have a repoId anywhere', () => {
    expect(collect([_item(null, []), _item(null, [])])).toEqual([]);
  });

  it('extracts a single segment-level repoId', () => {
    expect(collect([_item('owner/repo', [])])).toEqual(['owner/repo']);
  });

  it('extracts repoIds from refs even when dem.repoId is null', () => {
    expect(collect([_item(null, ['owner/A', 'owner/B'])])).toEqual(['owner/A', 'owner/B']);
  });

  it('mixes segment-level and ref-level repoIds, segment-level first', () => {
    expect(collect([_item('owner/main', ['owner/dep'])])).toEqual(['owner/main', 'owner/dep']);
  });

  it('deduplicates across items (first occurrence wins)', () => {
    expect(collect([
      _item('owner/A', []),
      _item('owner/B', []),
      _item('owner/A', []),
    ])).toEqual(['owner/A', 'owner/B']);
  });

  it('deduplicates when same repoId appears at both dem.repoId and ref.repoId', () => {
    expect(collect([_item('owner/A', ['owner/A', 'owner/B'])])).toEqual(['owner/A', 'owner/B']);
  });

  it('preserves first-occurrence order across many items', () => {
    expect(collect([
      _item('z', []),
      _item('a', []),
      _item('m', []),
    ])).toEqual(['z', 'a', 'm']);
  });

  it('handles missing refs array gracefully (no crash)', () => {
    expect(collect([{ dem: { repoId: 'owner/X' } }])).toEqual(['owner/X']);
  });

  it('handles falsy item gracefully', () => {
    expect(collect([{ dem: null }, _item('owner/Y', [])])).toEqual(['owner/Y']);
  });

  it('ignores empty-string and null repoIds inside refs', () => {
    expect(collect([_item('owner/A', ['', null, 'owner/B', undefined])])).toEqual(['owner/A', 'owner/B']);
  });
});
