import type { AnyClip } from '../types/timeline';

/**
 * The current 0–1 fade multiplier for a clip given the global
 * playhead. Returns 1.0 when the playhead is well inside the body
 * of the clip, 0.0 outside it, and a linear ramp during the fade-in
 * or fade-out windows.
 *
 * Used by:
 *   - Preview: applied as video element `opacity`
 *   - useAudioEngine: combined with `clip.volume` for GainNode value
 */
export function fadeEnvelope(clip: AnyClip, playheadSec: number): number {
  const local = playheadSec - clip.startOffset;
  if (local < 0 || local > clip.duration) return 0;

  let multiplier = 1;
  if (clip.fadeIn > 0 && local < clip.fadeIn) {
    multiplier = local / clip.fadeIn;
  }
  if (clip.fadeOut > 0 && local > clip.duration - clip.fadeOut) {
    const remaining = clip.duration - local;
    multiplier = Math.min(multiplier, remaining / clip.fadeOut);
  }
  return Math.max(0, Math.min(1, multiplier));
}
