import { ffmpegCurve, sampleCurve, sortKeys } from './keyframes';
import { isTextOverlay } from './shapes';
import type { AnyOverlay, OverlayMotionKeyframe } from '../types/timeline';

/**
 * Motion paths for text and annotations: keyframed anchor position,
 * eased like every other curve. Times are relative to the overlay's
 * start; positions are frame fractions of the overlay's anchor (a text
 * box's top-left, a shape's `box.x / box.y` — an arrow's tail).
 */

export function hasOverlayMotion(o: AnyOverlay): boolean {
  return (o.motion?.length ?? 0) > 0;
}

/** The overlay's static anchor. */
export function overlayAnchor(o: AnyOverlay): { x: number; y: number } {
  return isTextOverlay(o) ? o.style.position : { x: o.box.x, y: o.box.y };
}

/** Anchor at timeline second `t`. */
export function overlayAnchorAt(o: AnyOverlay, t: number): { x: number; y: number } {
  const base = overlayAnchor(o);
  if (!hasOverlayMotion(o)) return base;
  const local = t - o.startOffset;
  return {
    x: sampleCurve(o.motion, local, (k) => k.x) ?? base.x,
    y: sampleCurve(o.motion, local, (k) => k.y) ?? base.y,
  };
}

/** A copy of `o` with its anchor moved to `p` (for drawing one instant). */
export function withAnchor<O extends AnyOverlay>(o: O, p: { x: number; y: number }): O {
  if (isTextOverlay(o)) return { ...o, style: { ...o.style, position: p } };
  return { ...o, box: { ...o.box, x: p.x, y: p.y } } as O;
}

/** The overlay as it looks at timeline second `t`. */
export function overlayAt<O extends AnyOverlay>(o: O, t: number): O {
  return hasOverlayMotion(o) ? withAnchor(o, overlayAnchorAt(o, t)) : o;
}

/**
 * ffmpeg x / y for the `overlay` filter (main clock `t`). `originOffset`
 * is the PNG's top-left minus the anchor, in pixels (constant: the
 * rasterized image only moves, it doesn't change).
 */
export function overlayMotionXY(
  o: AnyOverlay,
  frameW: number,
  frameH: number,
  originOffset: { x: number; y: number },
): { x: string; y: string } {
  const keys = sortKeys<OverlayMotionKeyframe>(o.motion);
  const toMain = (t: number) => o.startOffset + t;
  const X = ffmpegCurve(keys, (k) => k.x, 't', toMain);
  const Y = ffmpegCurve(keys, (k) => k.y, 't', toMain);
  return {
    x: `'${frameW}*(${X})+${originOffset.x.toFixed(2)}'`,
    y: `'${frameH}*(${Y})+${originOffset.y.toFixed(2)}'`,
  };
}
