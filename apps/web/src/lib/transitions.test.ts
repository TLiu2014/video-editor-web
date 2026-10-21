import { describe, expect, it } from 'vitest';
import type { VideoClip, VideoProject } from '../types/timeline';
import {
  baseTrackTransitions,
  effectiveTransitionIn,
  transitionAt,
} from './transitions';

const file = new File(['x'], 'a.mp4', { type: 'video/mp4' });
const clip = (id: string, start: number, dur: number, extra: Partial<VideoClip> = {}): VideoClip => ({
  id, kind: 'video', name: id, file, startOffset: start, trimStart: 0, trimEnd: dur,
  duration: dur, sourceDuration: 10, fadeIn: 0, fadeOut: 0, hasAudio: true, trackId: 'v1', ...extra,
});
const project = (v1: VideoClip[], v2: VideoClip[] = []): VideoProject => ({
  id: 'p', name: 'P', resolution: { width: 1920, height: 1080 }, frameRate: 30,
  audioSampleRate: 48000, overlays: [], media: [],
  tracks: [
    { id: 'v1', type: 'video', clips: v1 },
    { id: 'v2', type: 'video', clips: v2 },
  ],
});
const dissolve = (duration: number) => ({ transitionIn: { kind: 'dissolve' as const, duration } });

describe('transitions', () => {
  it('applies only when the clip touches a previous V1 clip', () => {
    const a = clip('a', 0, 3);
    const b = clip('b', 3, 3, dissolve(1));
    expect(effectiveTransitionIn([a, b], b)).toMatchObject({ outgoing: { id: 'a' }, duration: 1, cut: 3 });
    const moved = { ...b, startOffset: 4 };
    expect(effectiveTransitionIn([a, moved], moved)).toBeNull();
  });

  it('clamps to the shorter neighbor', () => {
    const a = clip('a', 0, 0.6);
    const b = clip('b', 0.6, 3, dissolve(2));
    expect(effectiveTransitionIn([a, b], b)?.duration).toBeCloseTo(0.6);
  });

  it('ignores transitions on overlay tracks', () => {
    const p = project([clip('a', 0, 3)], [clip('x', 0, 2), clip('y', 2, 2, dissolve(1))]);
    expect(baseTrackTransitions(p)).toHaveLength(0);
  });

  it('reports progress across the centered window', () => {
    const p = project([clip('a', 0, 3), clip('b', 3, 3, dissolve(2))]);
    expect(transitionAt(p, 1.9)).toBeNull();
    expect(transitionAt(p, 2)?.progress).toBeCloseTo(0);
    expect(transitionAt(p, 3)?.progress).toBeCloseTo(0.5);
    expect(transitionAt(p, 3.9)?.progress).toBeCloseTo(0.95);
    expect(transitionAt(p, 4)).toBeNull();
  });
});
