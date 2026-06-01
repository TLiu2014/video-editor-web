import type { VideoClip, VideoClipEffects } from '../types/timeline';

/**
 * Build the CSS `filter` string for a video clip's color effects.
 * Returns `none` when no effect is meaningfully applied so the
 * browser's compositor doesn't pay for an identity filter pass.
 */
export function clipCssFilter(clip: VideoClip): string {
  const e = clip.effects;
  if (!e) return 'none';
  const parts: string[] = [];
  if (e.brightness !== undefined && e.brightness !== 1) {
    parts.push(`brightness(${e.brightness})`);
  }
  if (e.contrast !== undefined && e.contrast !== 1) {
    parts.push(`contrast(${e.contrast})`);
  }
  if (e.saturation !== undefined && e.saturation !== 1) {
    parts.push(`saturate(${e.saturation})`);
  }
  if (e.blur !== undefined && e.blur > 0) {
    parts.push(`blur(${e.blur}px)`);
  }
  return parts.length === 0 ? 'none' : parts.join(' ');
}

/**
 * FFmpeg filter snippet for a clip's effects, suitable to append
 * onto the per-clip video chain (after fade). Returns an empty
 * string when no effect needs to apply.
 *
 * CSS↔FFmpeg mapping:
 *   - CSS brightness X (1 = identity) → eq:brightness=(X-1)
 *     (FFmpeg uses [-1, 1] offset, default 0)
 *   - CSS contrast/saturate map onto eq:contrast / eq:saturation
 *     with the same scale (default 1)
 *   - CSS blur(px) → gblur:sigma=px/2 (approximate)
 *
 * The mapping isn't pixel-exact — CSS filters and FFmpeg `eq` use
 * different reference curves. But it's close enough that what the
 * user sees in preview is what they get on export, within typical
 * editing tolerances.
 */
export function ffmpegEffectFilters(effects: VideoClipEffects): string {
  const parts: string[] = [];
  const eqArgs: string[] = [];
  if (effects.brightness !== undefined && effects.brightness !== 1) {
    eqArgs.push(`brightness=${(effects.brightness - 1).toFixed(3)}`);
  }
  if (effects.contrast !== undefined && effects.contrast !== 1) {
    eqArgs.push(`contrast=${effects.contrast.toFixed(3)}`);
  }
  if (effects.saturation !== undefined && effects.saturation !== 1) {
    eqArgs.push(`saturation=${effects.saturation.toFixed(3)}`);
  }
  if (eqArgs.length > 0) parts.push(`eq=${eqArgs.join(':')}`);
  if (effects.blur !== undefined && effects.blur > 0) {
    parts.push(`gblur=sigma=${(effects.blur / 2).toFixed(3)}`);
  }
  return parts.length === 0 ? '' : ',' + parts.join(',');
}

export function hasNonTrivialEffects(clip: VideoClip): boolean {
  return clipCssFilter(clip) !== 'none';
}
