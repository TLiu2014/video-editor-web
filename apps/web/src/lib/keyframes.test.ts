import { describe, expect, it } from 'vitest';
import type { TextOverlay } from '../types/timeline';
import { keyAt, mergeKeys, neighborKeys, removeKey, sampleCurve, upsertKey } from './keyframes';
import { motionKeyFrom, pipTransformAt } from './motion';
import { overlayAnchorAt, overlayAt } from './overlayMotion';

const keys = [{ t: 0, v: 0 }, { t: 2, v: 10 }];

describe('keyframe engine', () => {
  it('eases between keyframes and holds outside them', () => {
    expect(sampleCurve([], 1, (k: { t: number; v: number }) => k.v)).toBeNull();
    expect(sampleCurve(keys, -1, (k) => k.v)).toBe(0);
    expect(sampleCurve(keys, 1, (k) => k.v)).toBeCloseTo(5);
    expect(sampleCurve(keys, 0.5, (k) => k.v)!).toBeLessThan(2.5); // slow start
    expect(sampleCurve(keys, 9, (k) => k.v)).toBe(10);
  });
  it('upserts, finds, removes, merges and navigates', () => {
    const k = upsertKey(keys, { t: 2.001, v: 7 });
    expect(k).toHaveLength(2);
    expect(keyAt(k, 2)?.v).toBe(7);
    expect(removeKey(k, 0)).toEqual([{ t: 2.001, v: 7 }]);
    expect(mergeKeys(keys, [{ t: 1, v: 1 }]).map((x) => x.t)).toEqual([0, 1, 2]);
    expect(neighborKeys(keys, 1)).toEqual({ prev: keys[0], next: keys[1] });
  });
});

describe('PiP motion', () => {
  it('samples keyframed transform and keeps static opacity', () => {
    const file = new File(['x'], 'a.mp4', { type: 'video/mp4' });
    const clip = {
      id: 'c', kind: 'video' as const, name: 'c', file, startOffset: 0, trimStart: 0, trimEnd: 4,
      duration: 4, sourceDuration: 4, fadeIn: 0, fadeOut: 0, hasAudio: false, trackId: 'v2',
      transform: { x: 0, y: 0, scale: 0.2, opacity: 0.5 },
      motionKeyframes: [
        motionKeyFrom(1, { x: 0, y: 0, scale: 0.2 }),
        motionKeyFrom(3, { x: 0.6, y: 0.4, scale: 0.4, rotation: 90 }),
      ],
    };
    const tr = pipTransformAt(clip, 2)!;
    expect(tr.x).toBeCloseTo(0.3);
    expect(tr.y).toBeCloseTo(0.2);
    expect(tr.scale).toBeCloseTo(0.3);
    expect(tr.rotation).toBeCloseTo(45);
    expect(tr.opacity).toBe(0.5);
    expect(pipTransformAt({ ...clip, transform: undefined }, 2)).toBeUndefined();
  });
});

describe('overlay motion', () => {
  const o: TextOverlay = {
    id: 't', text: 'Hi', startOffset: 10, duration: 4,
    style: { position: { x: 0.1, y: 0.1 }, color: '#fff', size: 40 },
    motion: [{ t: 0, x: 0.1, y: 0.1 }, { t: 2, x: 0.5, y: 0.3 }],
  };
  it('samples relative to the overlay start', () => {
    expect(overlayAnchorAt(o, 11)).toEqual({ x: expect.closeTo(0.3, 6), y: expect.closeTo(0.2, 6) });
    expect(overlayAnchorAt(o, 13)).toEqual({ x: 0.5, y: 0.3 });
    expect(overlayAt(o, 13).style.position).toEqual({ x: 0.5, y: 0.3 });
  });
  it('is static without keyframes', () => {
    const still = { ...o, motion: undefined };
    expect(overlayAt(still, 11)).toBe(still);
  });
});
