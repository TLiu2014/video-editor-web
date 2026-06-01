import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { useTimelineStore } from './useTimelineStore';
import type { VideoProject } from '../types/timeline';

/**
 * Undo/redo for the current project.
 *
 * History entries snapshot just the `VideoProject` — selection state
 * and playhead are preserved through undo so the editor doesn't jump
 * around. Pushing happens automatically via `useHistoryEngine` (a
 * subscriber on `currentProject` ref changes).
 *
 * Coalescing: rapid changes within `COALESCE_MS` of the previous
 * push don't add a new entry — they just refresh the timestamp. This
 * means a continuous slider drag collapses into a single undoable
 * step (the state before the drag began), instead of producing one
 * entry per frame.
 *
 * History does NOT persist across sessions — it's intentionally
 * scoped to the lifetime of the currently-open project.
 */

const HISTORY_LIMIT = 50;
const COALESCE_MS = 500;

interface Entry {
  project: VideoProject;
  /**
   * Snapshot of the in/out range markers at push time. They live in
   * the timeline store rather than the project, but users expect
   * Undo to put them back where they were before a destructive
   * range edit (e.g., trim/delete to range). On apply, marks past
   * the restored project's duration are clamped or nulled out.
   */
  inPoint: number | null;
  outPoint: number | null;
  timestamp: number;
}

export interface HistoryState {
  past: Entry[];
  future: Entry[];
}

export interface HistoryActions {
  push: (
    project: VideoProject,
    marks: { inPoint: number | null; outPoint: number | null },
  ) => void;
  undo: () => boolean;
  redo: () => boolean;
  clear: () => void;
}

export type HistoryStore = HistoryState & HistoryActions;

// Module-flag so the history engine can suppress its own re-entrant
// push when an undo/redo writes back into the timeline store.
let suppressNextPush = false;

export const useHistoryStore = create<HistoryStore>()(
  subscribeWithSelector((set, get) => ({
    past: [],
    future: [],

    push: (project, marks) =>
      set((state) => {
        const now = Date.now();
        const last = state.past[state.past.length - 1];
        if (last && now - last.timestamp < COALESCE_MS) {
          // Within the coalescing window — keep the older project
          // (the "real" pre-drag state) but bump the timestamp so
          // the coalesce window slides with the user's activity.
          const refreshed: Entry = {
            project: last.project,
            inPoint: last.inPoint,
            outPoint: last.outPoint,
            timestamp: now,
          };
          return {
            past: [...state.past.slice(0, -1), refreshed],
            future: [],
          };
        }
        const entry: Entry = {
          project,
          inPoint: marks.inPoint,
          outPoint: marks.outPoint,
          timestamp: now,
        };
        const past = [...state.past, entry];
        if (past.length > HISTORY_LIMIT) {
          past.splice(0, past.length - HISTORY_LIMIT);
        }
        return { past, future: [] };
      }),

    undo: () => {
      const state = get();
      const previous = state.past[state.past.length - 1];
      if (!previous) return false;
      const currentState = useTimelineStore.getState();
      const currentProject = currentState.currentProject;
      if (!currentProject) return false;
      set({
        past: state.past.slice(0, -1),
        future: [
          ...state.future,
          {
            project: currentProject,
            inPoint: currentState.inPoint,
            outPoint: currentState.outPoint,
            timestamp: Date.now(),
          },
        ],
      });
      applyToTimeline(previous.project, previous.inPoint, previous.outPoint);
      return true;
    },

    redo: () => {
      const state = get();
      const next = state.future[state.future.length - 1];
      if (!next) return false;
      const currentState = useTimelineStore.getState();
      const currentProject = currentState.currentProject;
      if (!currentProject) return false;
      set({
        future: state.future.slice(0, -1),
        past: [
          ...state.past,
          {
            project: currentProject,
            inPoint: currentState.inPoint,
            outPoint: currentState.outPoint,
            timestamp: Date.now(),
          },
        ],
      });
      applyToTimeline(next.project, next.inPoint, next.outPoint);
      return true;
    },

    clear: () => set({ past: [], future: [] }),
  })),
);

function projectDurationOf(project: VideoProject): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const e = clip.startOffset + clip.duration;
      if (e > end) end = e;
    }
  }
  for (const overlay of project.overlays) {
    const e = overlay.startOffset + overlay.duration;
    if (e > end) end = e;
  }
  return end;
}

function clampMark(
  mark: number | null,
  duration: number,
): number | null {
  if (mark === null) return null;
  if (duration <= 0) return null;
  // If the mark sat past the restored project's end, the content
  // it referred to is gone; pin to the end so the user keeps a
  // valid boundary instead of a dangling reference.
  if (mark > duration) return duration;
  return mark;
}

function applyToTimeline(
  project: VideoProject,
  inPoint: number | null,
  outPoint: number | null,
): void {
  // Selection bookkeeping: drop ids that don't exist in the
  // restored project. The playhead is preserved as-is.
  const state = useTimelineStore.getState();
  const clipStillExists =
    state.selectedClipId !== null &&
    project.tracks.some((t) =>
      t.clips.some((c) => c.id === state.selectedClipId),
    );
  const overlayStillExists =
    state.selectedOverlayId !== null &&
    project.overlays.some((o) => o.id === state.selectedOverlayId);

  const duration = projectDurationOf(project);
  const adjIn = clampMark(inPoint, duration);
  const adjOut = clampMark(outPoint, duration);
  // If both marks collapsed onto the same point after clamping,
  // there's no usable range — drop both rather than leave a zero-
  // width artifact the user can't see.
  const collapsed =
    adjIn !== null && adjOut !== null && Math.abs(adjOut - adjIn) < 1e-3;

  suppressNextPush = true;
  useTimelineStore.setState({
    currentProject: project,
    selectedClipId: clipStillExists ? state.selectedClipId : null,
    selectedOverlayId: overlayStillExists ? state.selectedOverlayId : null,
    inPoint: collapsed ? null : adjIn,
    outPoint: collapsed ? null : adjOut,
  });
  suppressNextPush = false;
}

export function isHistoryPushSuppressed(): boolean {
  return suppressNextPush;
}
