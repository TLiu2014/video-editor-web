import { clipRate } from './clipRate';
import { ffmpegCurve, sampleCurve, sortKeys } from './keyframes';
import type {
  MotionKeyframe,
  VideoClip,
  VideoClipTransform,
} from '../types/timeline';

/**
 * Keyframed picture-in-picture motion: position, scale and rotation of
 * a V2+ layer over time (Camtasia's animations / Premiere's Motion).
 * Opacity stays a static value (plus fades) — animating it would need
 * a per-pixel `geq` in the export, which is far too slow in wasm.
 */

/** The layer's transform at source time `t` (undefined = full frame). */
export function pipTransformAt(
  clip: VideoClip,
  t: number,
): VideoClipTransform | undefined {
  const base = clip.transform;
  if (!base) return undefined;
  const keys = clip.motionKeyframes;
  if (!keys || keys.length === 0) return base;
  return {
    ...base,
    x: sampleCurve(keys, t, (k) => k.x) ?? base.x,
    y: sampleCurve(keys, t, (k) => k.y) ?? base.y,
    scale: Math.max(0.05, Math.min(1, sampleCurve(keys, t, (k) => k.scale) ?? base.scale)),
    rotation: sampleCurve(keys, t, (k) => k.rotation) ?? base.rotation,
  };
}

export function hasMotion(clip: VideoClip): boolean {
  return !!clip.transform && (clip.motionKeyframes?.length ?? 0) > 0;
}

/** A keyframe capturing `tr` at source time `t`. */
export function motionKeyFrom(t: number, tr: VideoClipTransform): MotionKeyframe {
  return { t, x: tr.x, y: tr.y, scale: tr.scale, rotation: tr.rotation ?? 0 };
}

/**
 * ffmpeg pieces for a PiP layer, static or animated, in the overlay
 * chain's clock (`t` = timeline seconds, since the chain's PTS are
 * shifted by the clip's start).
 *
 *  - `fixedScale` sizes the layer once, at its largest scale.
 *  - `rotate` (optional) rotates at that constant size — `rotate`
 *    fixes its output size at init, so it must never see a varying
 *    input.
 *  - `finalScale` (optional) is the only varying-size step, applied
 *    last so nothing but `overlay` (which copes) sees it.
 *  - `x` / `y` place the layer by its CENTER, matching the preview's
 *    CSS rotate-about-center (the rotated bounding box is larger than
 *    the layer, so a top-left placement would shift it).
 */
export function pipFilterParts(
  clip: VideoClip,
  frameW: number,
): { fixedScale: string; rotate: string; finalScale: string; x: string; y: string } {
  const tr = clip.transform!;
  const keys = sortKeys(clip.motionKeyframes);
  const animated = keys.length > 0;
  const toTimeline = (t: number) =>
    clip.startOffset + (t - clip.trimStart) / clipRate(clip);
  const curve = (pick: (k: MotionKeyframe) => number, fallback: number) =>
    animated ? `(${ffmpegCurve(keys, pick, 't', toTimeline)})` : fallback.toFixed(5);

  const scales = animated ? keys.map((k) => k.scale) : [tr.scale];
  const maxScale = Math.max(0.05, Math.min(1, Math.max(...scales)));
  const scaleAnimated = animated && keys.some((k) => Math.abs(k.scale - maxScale) > 1e-4);
  const rotations = animated ? keys.map((k) => k.rotation) : [tr.rotation ?? 0];
  const rotates = rotations.some((r) => Math.abs(r) > 1e-3);

  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const S = curve((k) => k.scale, tr.scale);
  const fixedScale = `scale=${even(frameW * maxScale)}:-2`;
  const rotate = rotates
    ? `format=rgba,rotate='${curve((k) => k.rotation, tr.rotation ?? 0)}*PI/180'` +
      // c=black@0 paints the corners transparent. (c=none means "don't
      // paint them at all" — they then keep stale buffer contents,
      // which shows as an opaque box once the angle changes.)
      `:ow='hypot(iw,ih)':oh='hypot(iw,ih)':c=black@0`
    : '';
  const finalScale = scaleAnimated
    ? `scale=w='max(2,trunc(iw*${S}/${maxScale.toFixed(5)}/2)*2)':h=-2:eval=frame`
    : '';
  const X = curve((k) => k.x, tr.x);
  const Y = curve((k) => k.y, tr.y);
  if (!rotates) {
    return { fixedScale, rotate, finalScale, x: `'W*${X}'`, y: `'H*${Y}'` };
  }
  // Unrotated layer width at this frame; the rotated box is
  // hypot(SW, SH) square, so SH = sqrt(box² − SW²).
  const SW = `(W*${S})`;
  return {
    fixedScale,
    rotate,
    finalScale,
    x: `'W*${X}+${SW}/2-w/2'`,
    y: `'H*${Y}+sqrt(max(0,w*w-${SW}*${SW}))/2-h/2'`,
  };
}
