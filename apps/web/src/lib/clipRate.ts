import type { BaseClip } from '../types/timeline';

/**
 * Resolved playback rate for a clip — `undefined` collapses to 1
 * so all consumers can treat the field as always present.
 */
export function clipRate(clip: Pick<BaseClip, 'playbackRate'>): number {
  return clip.playbackRate ?? 1;
}

/**
 * Effective timeline duration given a clip's trim window and
 * playback rate. The clip occupies `(trimEnd - trimStart) / rate`
 * seconds on the timeline (fast rates compress, slow rates
 * stretch). Source-time spans (trimStart, trimEnd) stay in raw
 * file seconds — only the timeline projection is rate-scaled.
 */
export function computeTimelineDuration(
  trimStart: number,
  trimEnd: number,
  playbackRate?: number,
): number {
  const rate = playbackRate ?? 1;
  return Math.max(0, (trimEnd - trimStart) / rate);
}

/**
 * Build the audio-tempo filter chain for FFmpeg. Single `atempo`
 * is limited to [0.5, 100]; we chain two stages to cover the
 * editor's full [0.25, 4] range without pitch drift.
 */
export function ffmpegAtempoChain(rate: number): string {
  if (rate === 1) return '';
  if (rate >= 0.5 && rate <= 2) return `,atempo=${rate.toFixed(3)}`;
  if (rate < 0.5) {
    // Down to 0.25: 0.5 × (rate/0.5)
    return `,atempo=0.500,atempo=${(rate / 0.5).toFixed(3)}`;
  }
  // Up to 4: 2 × (rate/2)
  return `,atempo=2.000,atempo=${(rate / 2).toFixed(3)}`;
}
