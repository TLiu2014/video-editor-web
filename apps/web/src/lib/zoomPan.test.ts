import { describe, expect, it } from 'vitest';
import type { VideoClip } from '../types/timeline';
import {
  clampView,
  keyframeAt,
  mergeKeyframes,
  removeKeyframe,
  sampleZoom,
  sourceTimeAt,
  timelineTimeOf,
  upsertKeyframe,
  zoomCssTransform,
  zoomPanFilter,
} from './zoomPan';

const file = new File(['x'], 'a.mp4', { type: 'video/mp4' });
const clip = (extra: Partial<VideoClip> = {}): VideoClip => ({
  id: 'c', kind: 'video', name: 'c', file, startOffset: 10, trimStart: 2, trimEnd: 8,
  duration: 6, sourceDuration: 20, fadeIn: 0, fadeOut: 0, hasAudio: true, trackId: 'v1', ...extra,
});
const keys = [
  { t: 3, zoom: 1, cx: 0.5, cy: 0.5 },
  { t: 5, zoom: 3, cx: 0.7, cy: 0.4 },
];

describe('zoom & pan', () => {
  it('is identity without keyframes', () => {
    expect(sampleZoom(clip(), 4)).toEqual({ zoom: 1, cx: 0.5, cy: 0.5 });
    expect(zoomPanFilter(clip(), 2, 1920, 1080, 30)).toBe('');
    expect(zoomCssTransform(sampleZoom(clip(), 4))).toBe('');
  });

  it('holds before / after and eases between keyframes', () => {
    const c = clip({ zoomKeyframes: keys });
    expect(sampleZoom(c, 2).zoom).toBe(1);
    expect(sampleZoom(c, 7).zoom).toBe(3);
    expect(sampleZoom(c, 4).zoom).toBeCloseTo(2); // smoothstep(0.5) = 0.5
    expect(sampleZoom(c, 3.5).zoom).toBeLessThan(1.5); // eased: slow start
  });

  it('clamps the center so the view never leaves the frame', () => {
    expect(clampView({ zoom: 2, cx: 0.95, cy: 0.05 })).toEqual({ zoom: 2, cx: 0.75, cy: 0.25 });
    expect(clampView({ zoom: 9, cx: 0.5, cy: 0.5 }).zoom).toBe(5);
  });

  it('maps between timeline and source time with speed', () => {
    const c = clip({ playbackRate: 2 });
    expect(sourceTimeAt(c, 11)).toBe(4);
    expect(timelineTimeOf(c, 4)).toBe(11);
  });

  it('upserts, finds and removes keyframes by time', () => {
    let k = upsertKeyframe([], 4, { zoom: 2, cx: 0.5, cy: 0.5 });
    k = upsertKeyframe(k, 4.001, { zoom: 3, cx: 0.5, cy: 0.5 }); // same slot
    expect(k).toHaveLength(1);
    expect(keyframeAt(clip({ zoomKeyframes: k }), 4)?.zoom).toBe(3);
    expect(removeKeyframe(k, 4)).toHaveLength(0);
    expect(mergeKeyframes(keys, [{ t: 3, zoom: 9, cx: 0, cy: 0 }, { t: 6, zoom: 2, cx: 0.5, cy: 0.5 }]).map((x) => x.t)).toEqual([3, 5, 6]);
  });

  it('builds a zoompan expression on segment-local time', () => {
    const f = zoomPanFilter(clip({ zoomKeyframes: keys }), 2, 1920, 1080, 30);
    expect(f).toMatch(/^,zoompan=z='/);
    expect(f).toContain('in_time');
    expect(f).toContain(':d=1:s=1920x1080:fps=30');
    // Keyframe at source 3 with the segment starting at source 2 → 1s in.
    expect(f).toContain('lt(in_time,1.00000)');
  });
});
