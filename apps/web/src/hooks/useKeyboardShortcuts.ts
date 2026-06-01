import { useEffect } from 'react';
import { computeProjectDuration } from '../lib/projectMetrics';
import {
  chooseMajorInterval,
  collectSnapTargets,
  findNearestTarget,
} from '../lib/snapping';
import { useHistoryStore } from '../store/useHistoryStore';
import { usePaletteStore } from '../store/usePaletteStore';
import { useTimelineStore } from '../store/useTimelineStore';
import {
  getPixelsPerSecond,
  useTimelineViewStore,
} from '../store/useTimelineViewStore';
import type {
  AnyClip,
  ClipId,
  OverlayId,
  VideoProject,
} from '../types/timeline';

/**
 * Global keyboard shortcuts.
 *   Space             play / pause
 *   S                 split active video clip at the playhead
 *   Backspace /       delete the selected clip or overlay
 *   Delete
 *   Shift+Backspace / ripple-delete (close the gap by pulling
 *   Shift+Delete      same-track clips left)
 *   ← / →             nudge selected clip/overlay by 1px (in pps),
 *                     or — if nothing's selected — the playhead by 0.1s.
 *                     Shift multiplies the step by 10×. Snaps to clip /
 *                     overlay edges, ruler-grid ticks, and the playhead
 *                     when motion brings you within one step of a target.
 *   = / +             zoom timeline in
 *   -                zoom timeline out
 *   0                reset timeline zoom
 *   I / O             set in/out point at the playhead
 *                     (Shift+I / Shift+O clear them)
 *   Cmd/Ctrl+A       select all clips
 *   Cmd/Ctrl+C       copy selected clips to the clipboard
 *   Cmd/Ctrl+V       paste clipboard at the playhead
 *   Cmd/Ctrl+Z       undo
 *   Cmd+Shift+Z /    redo
 *   Cmd/Ctrl+Y
 *
 * Non-undo bindings are skipped when any modifier (Cmd/Ctrl/Alt) is
 * pressed. Inputs, textareas, and contentEditable elements opt out
 * entirely so renames and dialogs aren't intercepted.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }

      // Command palette: special-cased BEFORE the modifier guard.
      // Triggers even if a clip/overlay is selected; works in
      // light/dark, dialog-closed, etc.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === 'KeyK') {
        e.preventDefault();
        usePaletteStore.getState().toggle();
        return;
      }

      // Select all: Cmd/Ctrl+A. Skipped if no project so we don't
      // swallow the user's text-selection shortcut on landing pages.
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.code === 'KeyA'
      ) {
        const project = useTimelineStore.getState().currentProject;
        if (!project) return;
        e.preventDefault();
        const ids = project.tracks.flatMap((t) => t.clips.map((c) => c.id));
        useTimelineStore.getState().setSelectedClipIds(ids);
        return;
      }

      // Copy: Cmd/Ctrl+C. Snapshot the current multi-selection into
      // the clipboard. Skip when nothing is selected so the user's
      // browser-level copy (e.g., on selected text) still works.
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.code === 'KeyC'
      ) {
        const s = useTimelineStore.getState();
        if (s.selectedClipIds.length === 0) return;
        e.preventDefault();
        s.copyClipsToClipboard(s.selectedClipIds);
        return;
      }

      // Paste: Cmd/Ctrl+V. Drops the clipboard at the playhead. We
      // don't preventDefault when the clipboard is empty so the
      // user's browser paste keeps working in any focused input.
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.code === 'KeyV'
      ) {
        const s = useTimelineStore.getState();
        if (s.clipboardSize === 0 || !s.currentProject) return;
        e.preventDefault();
        s.pasteClipboardAtPlayhead();
        return;
      }

      // Undo / redo: special-cased BEFORE the modifier guard so that
      // Cmd/Ctrl+Z still reaches us.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) {
          useHistoryStore.getState().redo();
        } else {
          useHistoryStore.getState().undo();
        }
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.code === 'KeyY'
      ) {
        e.preventDefault();
        useHistoryStore.getState().redo();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const state = useTimelineStore.getState();
      const view = useTimelineViewStore.getState();
      const project = state.currentProject;

      // In/Out marker shortcuts: I sets/clears the in-point at the
      // playhead, O does the same for out. Shift versions force a
      // clear regardless of current state.
      if (e.code === 'KeyI') {
        if (!project) return;
        e.preventDefault();
        if (e.shiftKey) {
          state.setInPoint(null);
        } else {
          state.setInPoint(state.playheadPosition);
        }
        return;
      }
      if (e.code === 'KeyO') {
        if (!project) return;
        e.preventDefault();
        if (e.shiftKey) {
          state.setOutPoint(null);
        } else {
          state.setOutPoint(state.playheadPosition);
        }
        return;
      }

      switch (e.code) {
        case 'Space': {
          if (!project) return;
          e.preventDefault();
          state.setPlaying(!state.isPlaying);
          return;
        }
        case 'KeyS': {
          if (!project) return;
          e.preventDefault();
          // Razor: with clips selected, split only those; with no
          // selection, split every clip the playhead crosses on
          // every track.
          state.splitClipsAtPlayhead(
            state.selectedClipIds.length > 0
              ? { onlySelectedIds: state.selectedClipIds }
              : undefined,
          );
          return;
        }
        case 'Backspace':
        case 'Delete': {
          if (state.selectedClipId) {
            e.preventDefault();
            if (e.shiftKey) {
              state.rippleDeleteClip(state.selectedClipId);
            } else {
              state.removeClip(state.selectedClipId);
            }
            return;
          }
          if (state.selectedOverlayId) {
            e.preventDefault();
            state.removeOverlay(state.selectedOverlayId);
            return;
          }
          return;
        }
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (!project) return;
          e.preventDefault();
          const direction = e.code === 'ArrowLeft' ? -1 : 1;
          nudge(direction, e.shiftKey);
          return;
        }
        case 'Equal':
        case 'NumpadAdd': {
          e.preventDefault();
          view.zoomIn();
          return;
        }
        case 'Minus':
        case 'NumpadSubtract': {
          e.preventDefault();
          view.zoomOut();
          return;
        }
        case 'Digit0':
        case 'Numpad0': {
          e.preventDefault();
          view.resetZoom();
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/**
 * Arrow-key nudge. When a clip or overlay is selected, move IT;
 * otherwise scrub the playhead. Step size is pixel-equivalent
 * (1px or 10px in shift), translated to seconds via current zoom —
 * so zoomed-in nudging is naturally finer.
 *
 * Snap: if a target lies within ±stepSec of the nudged position AND
 * is in the same direction the user is moving, the move snaps onto
 * it. The directional gate avoids "stuck-on-target" — once snapped,
 * the next nudge in the same direction can move away cleanly.
 */
function nudge(direction: 1 | -1, shift: boolean): void {
  const state = useTimelineStore.getState();
  const project = state.currentProject;
  if (!project) return;

  const pps = getPixelsPerSecond();
  const stepPx = shift ? 10 : 1;
  const stepSec = stepPx / pps;
  const delta = stepSec * direction;

  if (state.selectedClipId) {
    const clip = findClipById(project.tracks, state.selectedClipId);
    if (clip) {
      const { position, snapped } = nudgeWithSnap(
        clip.startOffset,
        delta,
        direction,
        stepSec,
        project,
        { excludeClipId: clip.id },
      );
      state.moveClip(clip.id, position);
      if (snapped) flashSnap(position);
      return;
    }
  }
  if (state.selectedOverlayId) {
    const overlay = project.overlays.find(
      (o) => o.id === state.selectedOverlayId,
    );
    if (overlay) {
      const { position, snapped } = nudgeWithSnap(
        overlay.startOffset,
        delta,
        direction,
        stepSec,
        project,
        { excludeOverlayId: overlay.id },
      );
      state.updateOverlay(overlay.id, {
        startOffset: Math.max(0, position),
      });
      if (snapped) flashSnap(position);
      return;
    }
  }

  // Fallback: scrub the playhead. Existing semantics — 0.1s / 1s —
  // unchanged so users without a selection see no behavior shift.
  const fallbackStep = shift ? 1 : 0.1;
  state.updatePlayhead(
    Math.max(0, state.playheadPosition + fallbackStep * direction),
  );
}

interface NudgeOpts {
  excludeClipId?: ClipId;
  excludeOverlayId?: OverlayId;
}

function nudgeWithSnap(
  currentPos: number,
  delta: number,
  direction: 1 | -1,
  stepSec: number,
  project: VideoProject,
  opts: NudgeOpts,
): { position: number; snapped: boolean } {
  const target = currentPos + delta;
  const pps = getPixelsPerSecond();
  const playhead = useTimelineStore.getState().playheadPosition;
  const targets = collectSnapTargets(project, {
    ...opts,
    playhead,
    gridInterval: chooseMajorInterval(pps),
    gridLimitSec: Math.max(60, computeProjectDuration(project) + 30),
  });
  const snap = findNearestTarget(target, targets, stepSec);
  if (snap === null) return { position: target, snapped: false };
  // Directional gate: only snap if motion is *toward* the target.
  const dirToSnap = Math.sign(snap - currentPos);
  if (dirToSnap !== direction) {
    return { position: target, snapped: false };
  }
  return { position: snap, snapped: true };
}

let snapFlashTimer: ReturnType<typeof setTimeout> | null = null;
function flashSnap(position: number): void {
  useTimelineViewStore.getState().setSnapPosition(position);
  if (snapFlashTimer !== null) clearTimeout(snapFlashTimer);
  snapFlashTimer = setTimeout(() => {
    useTimelineViewStore.getState().setSnapPosition(null);
    snapFlashTimer = null;
  }, 600);
}

function findClipById(
  tracks: { clips: AnyClip[] }[],
  clipId: string,
): AnyClip | null {
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.id === clipId) return clip;
    }
  }
  return null;
}
