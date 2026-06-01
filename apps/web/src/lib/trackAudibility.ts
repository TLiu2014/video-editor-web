import type { TimelineTrack } from '../types/timeline';

/**
 * Decide whether a track's audio contribution should be heard or
 * skipped, based on the project-wide mute/solo state.
 *
 *   - If ANY track has `solo: true`, only solo'd tracks are audible;
 *     everything else is muted.
 *   - Otherwise, individually-muted tracks are silenced.
 *
 * Used by both `useAudioEngine` (preview gain) and `filterGraph`
 * (export filter chain) so what the user hears matches what the
 * MP4 contains.
 */
export function isTrackAudible(
  track: TimelineTrack,
  allTracks: TimelineTrack[],
): boolean {
  if (track.muted) return false;
  const anySolo = allTracks.some((t) => t.solo);
  if (anySolo) return !!track.solo;
  return true;
}
