import { beforeEach, describe, expect, it } from 'vitest';
import type { MediaAsset, VideoClip } from '../types/timeline';
import { sampleZoom } from '../lib/zoomPan';
import { useTimelineStore } from './useTimelineStore';

const file = new File(['x'], 'a.mp4', { type: 'video/mp4' });
const asset: MediaAsset = {
  id: 'm1',
  kind: 'video',
  name: 'a.mp4',
  file,
  duration: 10,
  hasAudio: true,
  importedAt: 0,
};

function v1() {
  const p = useTimelineStore.getState().currentProject;
  const track = p?.tracks.find((t) => t.type === 'video');
  if (!track) throw new Error('no video track');
  return track;
}

function clipsById() {
  return Object.fromEntries(v1().clips.map((c) => [c.id, c]));
}

beforeEach(() => {
  const s = useTimelineStore.getState();
  s.createProject('Test');
  s.addMediaAssets([asset]);
});

describe('library → timeline', () => {
  it('inserts a full-length clip and selects it', () => {
    const id = useTimelineStore.getState().insertMediaClip('m1', { startOffset: 3 });
    expect(id).not.toBeNull();
    const clip = v1().clips[0];
    expect(clip).toMatchObject({ mediaId: 'm1', startOffset: 3, duration: 10, trimEnd: 10 });
    expect(useTimelineStore.getState().selectedClipIds).toEqual([id]);
  });

  it('renaming an asset renames clips that still use its name', () => {
    const s = useTimelineStore.getState();
    s.insertMediaClip('m1', { startOffset: 0 });
    s.renameMediaAsset('m1', 'Intro');
    expect(v1().clips[0]?.name).toBe('Intro');
  });
});

describe('trimClipsToPlayhead', () => {
  beforeEach(() => {
    const s = useTimelineStore.getState();
    s.insertMediaClip('m1', { startOffset: 0 }); // [0, 10)
    s.insertMediaClip('m1', { startOffset: 10 }); // [10, 20)
    s.selectClip(null);
    s.updatePlayhead(4);
  });

  it('trims the end to the playhead and leaves a gap', () => {
    useTimelineStore.getState().trimClipsToPlayhead('end', false);
    const [a, b] = v1().clips;
    expect(a).toMatchObject({ trimEnd: 4, duration: 4 });
    expect(b?.startOffset).toBe(10);
  });

  it('ripple-trims the start and parks the playhead on the edit', () => {
    useTimelineStore.getState().trimClipsToPlayhead('start', true);
    const [a, b] = v1().clips;
    expect(a).toMatchObject({ startOffset: 0, trimStart: 4, duration: 6 });
    expect(b?.startOffset).toBe(6);
    expect(useTimelineStore.getState().playheadPosition).toBe(0);
  });
});

describe('trim bounds at non-1× speed', () => {
  it('a 2× clip can extend right up to its neighbor, not past it', () => {
    const s = useTimelineStore.getState();
    const left = s.insertMediaClip('m1', { startOffset: 0 });
    if (!left) throw new Error('insert failed');
    s.trimClipRight(left, 4); // source [0,4) at 1× → [0,4) timeline
    s.insertMediaClip('m1', { startOffset: 5 }); // neighbor at 5
    s.setClipPlaybackRate(left, 2); // now [0,2) on the timeline
    // Gap to neighbor is 3 timeline-s = 6 source-s; ask for way more.
    useTimelineStore.getState().trimClipRight(left, 100);
    const clip = clipsById()[left] as VideoClip;
    expect(clip.trimEnd).toBe(10); // capped by sourceDuration (10) first
    expect(clip.startOffset + clip.duration).toBeLessThanOrEqual(5);
  });

  it('caps by the neighbor when the source is long enough', () => {
    const s = useTimelineStore.getState();
    s.addMediaAssets([{ ...asset, id: 'm2', duration: 100 }]);
    const left = s.insertMediaClip('m2', { startOffset: 0 });
    if (!left) throw new Error('insert failed');
    s.trimClipRight(left, 4);
    s.insertMediaClip('m1', { startOffset: 5 });
    s.setClipPlaybackRate(left, 2);
    useTimelineStore.getState().trimClipRight(left, 100);
    const clip = clipsById()[left] as VideoClip;
    // Before the fix this used the 3s timeline gap as source time → trimEnd 7.
    expect(clip.trimEnd).toBeCloseTo(10);
    expect(clip.startOffset + clip.duration).toBeCloseTo(5);
  });
});

describe('multi-selection delete', () => {
  it('ripple-deletes every selected clip', () => {
    const s = useTimelineStore.getState();
    const a = s.insertMediaClip('m1', { startOffset: 0 });
    const b = s.insertMediaClip('m1', { startOffset: 10 });
    const c = s.insertMediaClip('m1', { startOffset: 20 });
    if (!a || !b || !c) throw new Error('insert failed');
    useTimelineStore.getState().rippleDeleteClips([a, b]);
    expect(v1().clips.map((x) => [x.id, x.startOffset])).toEqual([[c, 0]]);
    // `c` was selected by its insert and survives; a and b are pruned.
    expect(useTimelineStore.getState().selectedClipIds).toEqual([c]);
  });
});

describe('transitions in the store', () => {
  it('clamps duration to what fits and keeps it on the left half of a split', () => {
    const s = useTimelineStore.getState();
    const a = s.insertMediaClip('m1', { startOffset: 0 }); // [0,10)
    const b = s.insertMediaClip('m1', { startOffset: 10 }); // [10,20)
    if (!a || !b) throw new Error('insert failed');
    s.setClipTransitionIn(b, { kind: 'wipeleft', duration: 99 });
    expect((clipsById()[b] as VideoClip).transitionIn).toEqual({ kind: 'wipeleft', duration: 3 });
    // Split b in its middle: only the left half (still id b) keeps it.
    s.updatePlayhead(15);
    useTimelineStore.getState().splitClipsAtPlayhead();
    const pieces = v1().clips.filter((c) => c.startOffset >= 10) as VideoClip[];
    expect(pieces).toHaveLength(2);
    expect(pieces.find((c) => c.id === b)?.transitionIn?.kind).toBe('wipeleft');
    expect(pieces.find((c) => c.id !== b)?.transitionIn).toBeUndefined();
    useTimelineStore.getState().setClipTransitionIn(b, null);
    expect((clipsById()[b] as VideoClip).transitionIn).toBeUndefined();
  });
});

describe('still images', () => {
  it('places a still with the default length and a long trim cap', () => {
    const s = useTimelineStore.getState();
    const png = new File(['p'], 'logo.png', { type: 'image/png' });
    s.addMediaAssets([{ id: 'img', kind: 'video', name: 'logo.png', file: png, duration: 5, hasAudio: false, still: true, importedAt: 0 }]);
    const id = s.insertMediaClip('img', { startOffset: 0 });
    const clip = clipsById()[id ?? ''] as VideoClip;
    expect(clip).toMatchObject({ still: true, duration: 5, hasAudio: false });
    useTimelineStore.getState().trimClipRight(clip.id, 60);
    expect((clipsById()[clip.id] as VideoClip).duration).toBe(60);
  });
});

describe('zoom keyframes through edits', () => {
  it('split keeps the animation continuous on both halves', () => {
    const s = useTimelineStore.getState();
    const id = s.insertMediaClip('m1', { startOffset: 0 }); // [0,10), source [0,10)
    if (!id) throw new Error('insert failed');
    s.setZoomKeyframes(id, [
      { t: 2, zoom: 1, cx: 0.5, cy: 0.5 },
      { t: 8, zoom: 3, cx: 0.6, cy: 0.5 },
    ]);
    s.updatePlayhead(5);
    useTimelineStore.getState().splitClipsAtPlayhead();
    const [left, right] = v1().clips as VideoClip[];
    // Same curve evaluated at the cut from either side.
    expect(sampleZoom(left!, 5).zoom).toBeCloseTo(sampleZoom(right!, 5).zoom);
    expect(sampleZoom(right!, 5).zoom).toBeCloseTo(2);
    useTimelineStore.getState().setZoomKeyframes(id, null);
    expect((clipsById()[id] as VideoClip).zoomKeyframes).toBeUndefined();
  });
});
