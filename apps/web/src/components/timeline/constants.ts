/**
 * Timeline geometry that's independent of zoom. Pixels-per-second
 * lives in `useTimelineViewStore` so the ruler, clips, and playhead
 * can scale together. Pull it via `usePixelsPerSecond()` in render
 * paths or `getPixelsPerSecond()` inside imperative subscriptions.
 */
export const RULER_HEIGHT = 36;
export const TRACK_HEIGHT_VIDEO = 80;
export const TRACK_HEIGHT_AUDIO = 56;
export const TRACK_GAP = 4;
export const TIMELINE_HORIZONTAL_PADDING = 24;

/** Minimum visible duration: keeps the timeline usable when empty. */
export const MIN_TIMELINE_SECONDS = 30;

/** How close (in pixels) a drag must come to a snap target to engage. */
export const SNAP_THRESHOLD_PX = 8;
