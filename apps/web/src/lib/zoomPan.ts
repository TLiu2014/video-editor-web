import { clipRate } from './clipRate';
import type { VideoClip, ZoomKeyframe } from '../types/timeline';

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
/** Two keyframes closer than this (source seconds) are the same one. */
export const KEYFRAME_EPSILON = 1 / 60;

export interface ZoomView {
  zoom: number;
  /** View center as 0–1 fractions of the frame. */
  cx: number;
  cy: number;
}

export const IDENTITY_VIEW: ZoomView = { zoom: 1, cx: 0.5, cy: 0.5 };

const smoothstep = (u: number) => u * u * (3 - 2 * u);

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
  return [...(clip.zoomKeyframes ?? [])].sort((a, b) => a.t - b.t);
}

/** The view at source time `t`. */
export function sampleZoom(clip: VideoClip, t: number): ZoomView {
  const keys = keyframesOf(clip);
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) return IDENTITY_VIEW;
  if (t <= first.t) return clampView(first);
  if (t >= last.t) return clampView(last);
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!;
    const b = keys[i]!;
    if (t <= b.t) {
      const s = smoothstep((t - a.t) / (b.t - a.t));
      return clampView({
        zoom: a.zoom + (b.zoom - a.zoom) * s,
        cx: a.cx + (b.cx - a.cx) * s,
        cy: a.cy + (b.cy - a.cy) * s,
      });
    }
  }
  return clampView(last);
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
  return keyframesOf(clip).find((k) => Math.abs(k.t - t) < KEYFRAME_EPSILON) ?? null;
}

/** Insert a keyframe at `t`, or replace the one already there. */
export function upsertKeyframe(
  keys: ZoomKeyframe[],
  t: number,
  view: ZoomView,
): ZoomKeyframe[] {
  const v = clampView(view);
  const next = keys.filter((k) => Math.abs(k.t - t) >= KEYFRAME_EPSILON);
  next.push({ t, zoom: v.zoom, cx: v.cx, cy: v.cy });
  return next.sort((a, b) => a.t - b.t);
}

export function removeKeyframe(keys: ZoomKeyframe[], t: number): ZoomKeyframe[] {
  return keys.filter((k) => Math.abs(k.t - t) >= KEYFRAME_EPSILON);
}

/** Union of two keyframe sets (used when joining split pieces). */
export function mergeKeyframes(a: ZoomKeyframe[], b: ZoomKeyframe[]): ZoomKeyframe[] {
  let out = [...a];
  for (const k of b) {
    if (!out.some((o) => Math.abs(o.t - k.t) < KEYFRAME_EPSILON)) out.push(k);
  }
  out = out.sort((x, y) => x.t - y.t);
  return out;
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
  const at = keys.map((k) => (k.t - segmentStartSource) / rate);
  const num = (v: number) => v.toFixed(5);
  const curve = (pick: (k: ZoomKeyframe) => number): string => {
    let expr = num(pick(keys[keys.length - 1]!));
    for (let i = keys.length - 1; i >= 1; i--) {
      const a = keys[i - 1]!;
      const b = keys[i]!;
      const ua = at[i - 1]!;
      const ub = at[i]!;
      const u = `((in_time-${num(ua)})/${num(Math.max(1e-6, ub - ua))})`;
      const seg = `${num(pick(a))}+(${num(pick(b) - pick(a))})*${u}*${u}*(3-2*${u})`;
      expr = `if(lt(in_time,${num(ub)}),${seg},${expr})`;
    }
    return `if(lt(in_time,${num(at[0]!)}),${num(pick(keys[0]!))},${expr})`;
  };
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
