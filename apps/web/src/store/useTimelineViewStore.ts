import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

/**
 * Discrete zoom steps in pixels per second. Multiplicative spacing
 * (×2) so each press of `=`/`-` produces a clearly perceivable change
 * without overshooting useful working ranges.
 *
 *   20 — overview, fits a few minutes on a 1440px screen
 *   40 — short edit overview
 *   80 — default working zoom
 *  160 — frame-level adjustments on ~5s clips
 *  320 — sub-second / sample-accurate adjustments
 */
export const ZOOM_LEVELS_PPS = [20, 40, 80, 160, 320] as const;
export const DEFAULT_ZOOM_INDEX = 2;

export interface TimelineViewState {
  zoomLevel: number;
  /**
   * Timeline-seconds position of the live snap-line during a drag.
   * Set by the Clip while dragging, cleared on commit. Rendered by
   * `SnapIndicator`.
   */
  snapPosition: number | null;
  /**
   * Rendered pixel width of the preview's video frame. Published
   * by Preview via a ResizeObserver and consumed by Transport so
   * its controls sit under the visible video instead of stretching
   * to the panel's full width.
   */
  previewContentWidth: number;
  /**
   * Edit toolbar detachment state. `null` = docked inline in the
   * timeline header; an `{ x, y }` pair = floating at that
   * page-coordinate origin.
   */
  editToolbarFloat: { x: number; y: number } | null;
}

export interface TimelineViewActions {
  zoomIn: () => void;
  zoomOut: () => void;
  setZoomLevel: (level: number) => void;
  resetZoom: () => void;
  setSnapPosition: (position: number | null) => void;
  setPreviewContentWidth: (px: number) => void;
  setEditToolbarFloat: (pos: { x: number; y: number } | null) => void;
}

export type TimelineViewStore = TimelineViewState & TimelineViewActions;

export const useTimelineViewStore = create<TimelineViewStore>()(
  subscribeWithSelector((set) => ({
    zoomLevel: DEFAULT_ZOOM_INDEX,
    snapPosition: null,
    previewContentWidth: 0,
    editToolbarFloat: null,

    zoomIn: () =>
      set((s) => ({
        zoomLevel: Math.min(ZOOM_LEVELS_PPS.length - 1, s.zoomLevel + 1),
      })),
    zoomOut: () =>
      set((s) => ({ zoomLevel: Math.max(0, s.zoomLevel - 1) })),
    setZoomLevel: (level) =>
      set({
        zoomLevel: Math.max(0, Math.min(ZOOM_LEVELS_PPS.length - 1, level)),
      }),
    resetZoom: () => set({ zoomLevel: DEFAULT_ZOOM_INDEX }),
    setSnapPosition: (position) => set({ snapPosition: position }),
    setPreviewContentWidth: (px) => set({ previewContentWidth: px }),
    setEditToolbarFloat: (pos) => set({ editToolbarFloat: pos }),
  })),
);

function ppsAtLevel(level: number): number {
  // Defensive: clamp the index in case a stale value sneaks in. The
  // store actions clamp on write, but `noUncheckedIndexedAccess`
  // still types the lookup as `T | undefined`.
  const safe = Math.max(0, Math.min(ZOOM_LEVELS_PPS.length - 1, level));
  return ZOOM_LEVELS_PPS[safe] ?? ZOOM_LEVELS_PPS[DEFAULT_ZOOM_INDEX] ?? 80;
}

export function usePixelsPerSecond(): number {
  return useTimelineViewStore((s) => ppsAtLevel(s.zoomLevel));
}

/** Imperative read for use inside subscription callbacks. */
export function getPixelsPerSecond(): number {
  return ppsAtLevel(useTimelineViewStore.getState().zoomLevel);
}
