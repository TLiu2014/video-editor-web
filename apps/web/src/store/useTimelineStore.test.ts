import { beforeEach, describe, expect, it } from 'vitest';
import type { MediaAsset, VideoClip } from '../types/timeline';
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
