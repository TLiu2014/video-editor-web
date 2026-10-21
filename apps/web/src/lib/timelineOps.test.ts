import { describe, expect, it } from 'vitest';
import type {
  AnyClip,
  MediaAsset,
  TimelineTrack,
  VideoClip,
  VideoProject,
} from '../types/timeline';
import {
  checkJoin,
  closeGaps,
  findFreeSlot,
  insertAssetClip,
  joinClips,
  mediaUsage,
  moveClipsBy,
  placeClip,
  findReorderTarget,
  reorderClip,
  removeMediaAsset,
  removeUnusedMedia,
  rippleRemoveClips,
} from './timelineOps';

const fileA = new File(['a'], 'a.mp4', { type: 'video/mp4' });
const fileB = new File(['b'], 'b.mp4', { type: 'video/mp4' });

function asset(id: string, file: File, duration = 20): MediaAsset {
  return { id, kind: 'video', name: file.name, file, duration, hasAudio: true, importedAt: 0 };
}

function clip(
  id: string,
  startOffset: number,
  duration: number,
  extra: Partial<VideoClip> = {},
): VideoClip {
  const trimStart = extra.trimStart ?? 0;
  return {
    id,
    kind: 'video',
    name: id,
    mediaId: 'mA',
    file: fileA,
    startOffset,
    trimStart,
    trimEnd: trimStart + duration * (extra.playbackRate ?? 1),
    duration,
    sourceDuration: 20,
    fadeIn: 0,
    fadeOut: 0,
    hasAudio: true,
    trackId: 'v1',
    ...extra,
  };
}

function project(v1: AnyClip[], v2: AnyClip[] = []): VideoProject {
  const tracks: TimelineTrack[] = [
    { id: 'v1', type: 'video', clips: v1 },
    { id: 'v2', type: 'video', clips: v2.map((c) => ({ ...c, trackId: 'v2' })) },
    { id: 'a1', type: 'audio', clips: [] },
  ];
  return {
    id: 'p',
    name: 'P',
    resolution: { width: 1920, height: 1080 },
    frameRate: 30,
    audioSampleRate: 48000,
    tracks,
    overlays: [],
    media: [asset('mA', fileA), asset('mB', fileB)],
  };
}

const starts = (p: VideoProject, trackIdx = 0) =>
  Object.fromEntries(
    (p.tracks[trackIdx]?.clips ?? []).map((c) => [c.id, c.startOffset]),
  );

describe('findFreeSlot', () => {
  const clips = [clip('x', 0, 5), clip('y', 8, 4)]; // gap [5, 8), tail from 12

  it('keeps the requested start when it fits', () => {
    expect(findFreeSlot(clips, 5.5, 2)).toBe(5.5);
  });
  it('slides inside a gap that is big enough', () => {
    expect(findFreeSlot(clips, 7, 2)).toBe(6); // [6, 8) is the closest fit
  });
  it('jumps past a neighbor when the gap is too small', () => {
    expect(findFreeSlot(clips, 9, 4)).toBe(12);
  });
  it('never goes below zero', () => {
    expect(findFreeSlot([], -3, 1)).toBe(0);
  });
  it('ignores excluded clips', () => {
    expect(findFreeSlot(clips, 7, 4, new Set(['y']))).toBe(7);
  });
});

describe('placeClip (single-clip move)', () => {
  it('lets a clip be dragged past its neighbor', () => {
    const p = project([clip('a', 0, 4), clip('b', 4, 4)]);
    // Drop "a" at 5 — overlapping "b" — resolves to after "b".
    expect(starts(placeClip(p, 'a', 5))).toEqual({ a: 8, b: 4 });
  });
  it('moves across tracks into a free slot instead of overlapping', () => {
    const p = project([clip('a', 0, 4)], [clip('z', 2, 4)]);
    const next = placeClip(p, 'a', 3, 'v2');
    expect(next.tracks[0]?.clips).toHaveLength(0);
    expect(starts(next, 1)).toEqual({ z: 2, a: 6 });
    expect(next.tracks[1]?.clips.find((c) => c.id === 'a')?.trackId).toBe('v2');
  });
  it('rejects a drop on a track of the other kind', () => {
    const p = project([clip('a', 0, 4)]);
    expect(placeClip(p, 'a', 3, 'a1')).toBe(p);
  });
});

describe('moveClipsBy (multi / group move)', () => {
  it('moves the set in lockstep, stopping when one member is blocked', () => {
    const p = project([clip('a', 0, 2), clip('b', 3, 2), clip('c', 7, 2)]);
    // a+b move right; b hits c at 7 after 2s, so the set moves 2s.
    expect(starts(moveClipsBy(p, ['a', 'b'], 10))).toEqual({ a: 2, b: 5, c: 7 });
  });
  it('pulls in group-mates', () => {
    const p = project([
      clip('a', 0, 2, { groupId: 'g' }),
      clip('b', 5, 2, { groupId: 'g' }),
    ]);
    expect(starts(moveClipsBy(p, ['a'], 1))).toEqual({ a: 1, b: 6 });
  });
});

describe('rippleRemoveClips', () => {
  it('closes each deleted span but keeps unrelated gaps', () => {
    const p = project([clip('a', 0, 2), clip('b', 2, 3), clip('c', 6, 1), clip('d', 7, 1)]);
    // Remove b (3s) and c (1s): d shifts by 4, the 1s gap at [5,6) survives as d's lead.
    expect(starts(rippleRemoveClips(p, new Set(['b', 'c'])))).toEqual({ a: 0, d: 3 });
  });
});

describe('closeGaps', () => {
  it('packs clips but keeps the first clip start', () => {
    const p = project([clip('a', 1, 2), clip('b', 5, 2), clip('c', 10, 1)]);
    expect(starts(closeGaps(p, new Set(['v1'])))).toEqual({ a: 1, b: 3, c: 5 });
  });
});

describe('join', () => {
  const left = clip('l', 0, 3, { trimStart: 2 }); // source [2, 5)
  const right = clip('r', 3, 4, { trimStart: 5, fadeOut: 0.5 }); // source [5, 9)

  it('joins the two halves of a split', () => {
    const result = joinClips(project([left, right]), ['r', 'l']);
    expect(result?.joinedId).toBe('l');
    const joined = result?.project.tracks[0]?.clips;
    expect(joined).toHaveLength(1);
    expect(joined?.[0]).toMatchObject({ trimStart: 2, trimEnd: 9, duration: 7, fadeOut: 0.5 });
  });
  it('refuses clips from different media', () => {
    const other = { ...right, mediaId: 'mB', file: fileB };
    expect(checkJoin(project([left, other]), ['l', 'r'])).toMatchObject({ ok: false });
  });
  it('refuses a gap or a source jump', () => {
    expect(checkJoin(project([left, { ...right, startOffset: 4 }]), ['l', 'r']).ok).toBe(false);
    expect(checkJoin(project([left, { ...right, trimStart: 6, trimEnd: 10 }]), ['l', 'r']).ok).toBe(false);
  });
  it('respects playback rate when rebuilding duration', () => {
    const l = clip('l', 0, 2, { playbackRate: 2 }); // source [0, 4)
    const r = clip('r', 2, 2, { trimStart: 4, playbackRate: 2 }); // source [4, 8)
    const joined = joinClips(project([l, r]), ['l', 'r'])?.project.tracks[0]?.clips[0];
    expect(joined).toMatchObject({ trimStart: 0, trimEnd: 8, duration: 4 });
  });
});

describe('media library', () => {
  it('counts uses per asset', () => {
    const p = project([clip('a', 0, 2), clip('b', 2, 2)]);
    expect(mediaUsage(p).get('mA')).toBe(2);
    expect(mediaUsage(p).has('mB')).toBe(false);
  });
  it('removes unused assets only', () => {
    const p = project([clip('a', 0, 2)]);
    expect(removeUnusedMedia(p).media.map((m) => m.id)).toEqual(['mA']);
  });
  it('removing an asset removes its clips', () => {
    const p = project([clip('a', 0, 2)], [clip('z', 0, 2)]);
    const next = removeMediaAsset(p, 'mA');
    expect(next.media.map((m) => m.id)).toEqual(['mB']);
    expect(next.tracks.every((t) => t.clips.length === 0)).toBe(true);
  });
  it('inserts on another same-kind track when the spot is taken', () => {
    const p = project([clip('a', 0, 30)]);
    const res = insertAssetClip(p, asset('mB', fileB, 5), { startOffset: 2 });
    expect(res?.clip).toMatchObject({ trackId: 'v2', startOffset: 2, mediaId: 'mB', duration: 5 });
  });
  it('falls back to the nearest free slot when every track is busy', () => {
    const p = project([clip('a', 0, 30)], [clip('z', 0, 30)]);
    const res = insertAssetClip(p, asset('mB', fileB, 5), { startOffset: 2, trackId: 'v1' });
    expect(res?.clip).toMatchObject({ trackId: 'v1', startOffset: 30 });
  });
});

describe('reorder', () => {
  // a[0,2) b[2,5) c[5,6)
  const base = () => project([clip('a', 0, 2), clip('b', 2, 3), clip('c', 5, 1)]);
  const order = (p: VideoProject) =>
    [...(p.tracks[0]?.clips ?? [])]
      .sort((x, y) => x.startOffset - y.startOffset)
      .map((c) => `${c.id}@${c.startOffset}`);

  it('picks the side from the pointer half of the hovered clip', () => {
    expect(findReorderTarget(base(), 'a', 'v1', 3)).toMatchObject({ targetClipId: 'b', side: 'before', markerAt: 2 });
    expect(findReorderTarget(base(), 'a', 'v1', 4.5)).toMatchObject({ side: 'after', markerAt: 5 });
    expect(findReorderTarget(base(), 'a', 'v1', 8)).toBeNull();
  });
  it('moves a clip later in the sequence', () => {
    const p = reorderClip(base(), 'a', { trackId: 'v1', targetClipId: 'b', side: 'after' });
    expect(order(p)).toEqual(['b@0', 'a@3', 'c@5']);
  });
  it('moves a clip earlier in the sequence', () => {
    const p = reorderClip(base(), 'c', { trackId: 'v1', targetClipId: 'a', side: 'before' });
    expect(order(p)).toEqual(['c@0', 'a@1', 'b@3']);
  });
  it('inserts into another track and closes the source', () => {
    const p = reorderClip(project([clip('a', 0, 2), clip('b', 2, 3)], [clip('z', 0, 4)]), 'a', {
      trackId: 'v2',
      targetClipId: 'z',
      side: 'before',
    });
    expect(order(p)).toEqual(['b@0']);
    expect(starts(p, 1)).toEqual({ z: 2, a: 0 });
  });
  it('does not reorder grouped clips', () => {
    const p = project([clip('a', 0, 2, { groupId: 'g' }), clip('b', 2, 3)]);
    expect(findReorderTarget(p, 'a', 'v1', 3)).toBeNull();
  });
});
