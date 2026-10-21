import type { TimelineTrack, TrackHeight } from '../../types/timeline';

/**
 * Timeline geometry that's independent of zoom. Pixels-per-second
 * lives in `useTimelineViewStore` so the ruler, clips, and playhead
 * can scale together. Pull it via `usePixelsPerSecond()` in render
 * paths or `getPixelsPerSecond()` inside imperative subscriptions.
 */
export const RULER_HEIGHT = 36;
export const TRACK_HEIGHT_VIDEO = 80;
export const TRACK_HEIGHT_AUDIO = 56;

const TRACK_HEIGHTS: Record<TrackHeight, { video: number; audio: number }> = {
  compact: { video: 44, audio: 36 },
  normal: { video: TRACK_HEIGHT_VIDEO, audio: TRACK_HEIGHT_AUDIO },
  tall: { video: 132, audio: 96 },
};

/** Pixel height of a track row for its type and height preset. */
export function trackHeightPx(track: Pick<TimelineTrack, 'type' | 'height'>): number {
  return TRACK_HEIGHTS[track.height ?? 'normal'][track.type];
}

const HEIGHT_CYCLE: TrackHeight[] = ['normal', 'tall', 'compact'];

/** The preset after `h` when cycling with the track's height button. */
export function nextTrackHeight(h: TrackHeight | undefined): TrackHeight {
  const i = HEIGHT_CYCLE.indexOf(h ?? 'normal');
  return HEIGHT_CYCLE[(i + 1) % HEIGHT_CYCLE.length] ?? 'normal';
}
export const TRACK_GAP = 4;
export const TIMELINE_HORIZONTAL_PADDING = 24;

/** Minimum visible duration: keeps the timeline usable when empty. */
export const MIN_TIMELINE_SECONDS = 30;

/** How close (in pixels) a drag must come to a snap target to engage. */
export const SNAP_THRESHOLD_PX = 8;
