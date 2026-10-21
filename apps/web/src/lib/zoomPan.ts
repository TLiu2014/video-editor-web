import { clipRate } from './clipRate';
import {
  ffmpegCurve,
  keyAt,
  KEYFRAME_EPSILON,
  mergeKeys,
  removeKey,
  sampleCurve,
  sortKeys,
  upsertKey,
} from './keyframes';
import type { VideoClip, ZoomKeyframe } from '../types/timeline';

export { KEYFRAME_EPSILON };

/**
 * Keyframed zoom & pan for V1 clips (Camtasia's "Zoom-n-Pan").
 *
 * Keyframes are stored in SOURCE time, so they stay attached to the
 * footage: moving, trimming, splitting or re-timing a clip needs no
 * keyframe bookkeeping — each piece just evaluates the same curve over
 * its own source range. Between keyframes values ease in and out
 * (smoothstep); before the first / after the last they hold.
 *
 * The preview applies the sampled view as a CSS transform; the export
 * compiles the same curve into a `zoompan` expression, so both follow
 * one definition.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;

export interface ZoomView {
  zoom: number;
  /** View center as 0–1 fractions of the frame. */
  cx: number;
  cy: number;
}

export const IDENTITY_VIEW: ZoomView = { zoom: 1, cx: 0.5, cy: 0.5 };

/** Keep the view inside the frame: no black edges at any zoom. */
export function clampView(v: ZoomView): ZoomView {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom));
  const half = 0.5 / zoom;
  return {
    zoom,
    cx: Math.max(half, Math.min(1 - half, v.cx)),
    cy: Math.max(half, Math.min(1 - half, v.cy)),
  };
}

/** Sorted copy of a clip's keyframes (empty when it has none). */
export function keyframesOf(clip: VideoClip): ZoomKeyframe[] {
  return sortKeys(clip.zoomKeyframes);
}

/** The view at source time `t`. */
export function sampleZoom(clip: VideoClip, t: number): ZoomView {
  const keys = clip.zoomKeyframes;
  const zoom = sampleCurve(keys, t, (k) => k.zoom);
  if (zoom === null) return IDENTITY_VIEW;
  return clampView({
    zoom,
    cx: sampleCurve(keys, t, (k) => k.cx) ?? 0.5,
    cy: sampleCurve(keys, t, (k) => k.cy) ?? 0.5,
  });
}

/** Source time shown at timeline second `playhead` (may lie outside the clip). */
export function sourceTimeAt(clip: VideoClip, playhead: number): number {
  return clip.trimStart + (playhead - clip.startOffset) * clipRate(clip);
}

/** Timeline second at which source time `t` plays. */
export function timelineTimeOf(clip: VideoClip, t: number): number {
  return clip.startOffset + (t - clip.trimStart) / clipRate(clip);
}

/** Keyframes inside the clip's current trim window. */
export function visibleKeyframes(clip: VideoClip): ZoomKeyframe[] {
  return keyframesOf(clip).filter(
    (k) => k.t >= clip.trimStart - KEYFRAME_EPSILON && k.t <= clip.trimEnd + KEYFRAME_EPSILON,
  );
}

export function keyframeAt(clip: VideoClip, t: number): ZoomKeyframe | null {
  return keyAt(clip.zoomKeyframes, t);
}

/** Insert a keyframe at `t`, or replace the one already there. */
export function upsertKeyframe(
  keys: ZoomKeyframe[],
  t: number,
  view: ZoomView,
): ZoomKeyframe[] {
  const v = clampView(view);
  return upsertKey(keys, { t, zoom: v.zoom, cx: v.cx, cy: v.cy });
}

export function removeKeyframe(keys: ZoomKeyframe[], t: number): ZoomKeyframe[] {
  return removeKey(keys, t);
}

/** Union of two keyframe sets (used when joining split pieces). */
export function mergeKeyframes(a: ZoomKeyframe[], b: ZoomKeyframe[]): ZoomKeyframe[] {
  return mergeKeys(a, b);
}

/** True when the clip's keyframes ever move the view off identity. */
export function hasZoomPan(clip: VideoClip): boolean {
  return keyframesOf(clip).some(
    (k) => Math.abs(k.zoom - 1) > 1e-3 || Math.abs(k.cx - 0.5) > 1e-3 || Math.abs(k.cy - 0.5) > 1e-3,
  );
}

/**
 * CSS transform showing view `v` of an element that fills the frame
 * (transform-origin: center). Moves the view center to the middle,
 * then scales about it.
 */
export function zoomCssTransform(v: ZoomView): string {
  if (v.zoom === 1 && v.cx === 0.5 && v.cy === 0.5) return '';
  const tx = ((0.5 - v.cx) * 100).toFixed(3);
  const ty = ((0.5 - v.cy) * 100).toFixed(3);
  return `scale(${v.zoom.toFixed(4)}) translate(${tx}%, ${ty}%)`;
}

/**
 * `zoompan` filter reproducing the clip's curve, or '' for none.
 * `segmentStartSource` is the source time of the segment's first frame
 * (the clip's in-point, minus any transition pre-roll) — `zoompan`'s
 * `in_time` counts from there.
 */
export function zoomPanFilter(
  clip: VideoClip,
  segmentStartSource: number,
  width: number,
  height: number,
  fps: number,
): string {
  if (!hasZoomPan(clip)) return '';
  const rate = clipRate(clip);
  const keys = keyframesOf(clip);
  // Keyframe times as segment-local timeline seconds (what in_time is).
  const curve = (pick: (k: ZoomKeyframe) => number) =>
    ffmpegCurve(keys, pick, 'in_time', (t) => (t - segmentStartSource) / rate);
  const z = `clip(${curve((k) => k.zoom)},${MIN_ZOOM},${MAX_ZOOM})`;
  // zoompan's x / y are the crop's top-left in input pixels; clamp the
  // center exactly like clampView so preview and export agree.
  const cx = `clip(${curve((k) => k.cx)},0.5/zoom,1-0.5/zoom)`;
  const cy = `clip(${curve((k) => k.cy)},0.5/zoom,1-0.5/zoom)`;
  return (
    `,zoompan=z='${z}':x='iw*${cx}-iw/zoom/2':y='ih*${cy}-ih/zoom/2'` +
    `:d=1:s=${width}x${height}:fps=${fps}`
  );
}
