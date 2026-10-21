/** Anything with a time span and optional fades — clips and overlays. */
interface Faded {
  startOffset: number;
  duration: number;
  fadeIn?: number;
  fadeOut?: number;
}

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
export function fadeEnvelope(clip: Faded, playheadSec: number): number {
  const { fadeIn = 0, fadeOut = 0 } = clip;
  const local = playheadSec - clip.startOffset;
  if (local < 0 || local > clip.duration) return 0;

  let multiplier = 1;
  if (fadeIn > 0 && local < fadeIn) {
    multiplier = local / fadeIn;
  }
  if (fadeOut > 0 && local > clip.duration - fadeOut) {
    const remaining = clip.duration - local;
    multiplier = Math.min(multiplier, remaining / fadeOut);
  }
  return Math.max(0, Math.min(1, multiplier));
}
