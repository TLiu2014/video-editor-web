import { useTimelineStore } from '../store/useTimelineStore';
import { useTimelineViewStore } from '../store/useTimelineViewStore';
import type { ShapeKind, TrackId } from '../types/timeline';
import { newId } from './ids';
import { createShapeOverlay } from './shapes';
import { checkJoin } from './timelineOps';
import {
  baseTrackClips,
  DEFAULT_TRANSITION_DURATION,
  previousTouching,
} from './transitions';

/**
 * Selection-driven edit commands shared by the keyboard shortcuts,
 * the command palette and the clip context menu, so the three
 * surfaces can't drift apart. Each reads the latest store state at
 * call time.
 */

export function splitSelection(): void {
  const s = useTimelineStore.getState();
  s.splitClipsAtPlayhead(
    s.selectedClipIds.length > 0
      ? { onlySelectedIds: s.selectedClipIds }
      : undefined,
  );
}

/** Delete selected clips (or the selected overlay). */
export function deleteSelection(ripple: boolean): void {
  const s = useTimelineStore.getState();
  if (s.selectedClipIds.length > 0) {
    if (ripple) s.rippleDeleteClips(s.selectedClipIds);
    else s.removeClips(s.selectedClipIds);
    return;
  }
  if (s.selectedOverlayId && !ripple) s.removeOverlay(s.selectedOverlayId);
}

export function trimSelectionToPlayhead(
  side: 'start' | 'end',
  ripple: boolean,
): void {
  useTimelineStore.getState().trimClipsToPlayhead(side, ripple);
}

/** Why the current selection can't be joined, or null when it can. */
export function joinBlocker(): string | null {
  const s = useTimelineStore.getState();
  if (!s.currentProject) return 'No project open.';
  const check = checkJoin(s.currentProject, s.selectedClipIds);
  return check.ok ? null : check.reason;
}

export function joinSelection(): void {
  const s = useTimelineStore.getState();
  s.joinClips(s.selectedClipIds);
}

/** Tracks that hold a selected clip, or every track with no selection. */
function selectionTrackIds(): TrackId[] {
  const s = useTimelineStore.getState();
  const project = s.currentProject;
  if (!project) return [];
  if (s.selectedClipIds.length === 0) return project.tracks.map((t) => t.id);
  const selected = new Set(s.selectedClipIds);
  return project.tracks
    .filter((t) => t.clips.some((c) => selected.has(c.id)))
    .map((t) => t.id);
}

export function closeGapsForSelection(): void {
  useTimelineStore.getState().closeGaps(selectionTrackIds());
}

/** Switch the left sidebar to Media and highlight the clip's asset. */
export function revealSelectionInMedia(): void {
  const s = useTimelineStore.getState();
  const project = s.currentProject;
  if (!project || !s.selectedClipId) return;
  for (const t of project.tracks) {
    const clip = t.clips.find((c) => c.id === s.selectedClipId);
    if (clip?.mediaId) {
      useTimelineViewStore.getState().revealMedia(clip.mediaId);
      return;
    }
  }
}

/**
 * Mark In/Out around the selected clips (Premiere's "Mark Clip"), or a
 * small range around the playhead when nothing is selected.
 */
export function markSelectionRange(): void {
  const s = useTimelineStore.getState();
  const project = s.currentProject;
  if (!project) return;
  const ids = new Set(s.selectedClipIds);
  const clips = project.tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id)));
  if (clips.length === 0) {
    s.markRangeAtPlayhead();
    return;
  }
  const lo = Math.min(...clips.map((c) => c.startOffset));
  const hi = Math.max(...clips.map((c) => c.startOffset + c.duration));
  // Clear first: setInPoint/setOutPoint swap when the new value
  // crosses the existing other mark.
  s.clearInOutPoints();
  s.setInPoint(lo);
  s.setOutPoint(hi);
}

/** Copy the selected clips, then delete them (leaving a gap). */
export function cutSelection(): void {
  const s = useTimelineStore.getState();
  if (s.selectedClipIds.length === 0) return;
  s.copyClipsToClipboard(s.selectedClipIds);
  s.removeClips(s.selectedClipIds);
}

export function groupSelection(): void {
  const s = useTimelineStore.getState();
  if (s.selectedClipIds.length > 1) s.groupClips(s.selectedClipIds);
}

export function ungroupSelection(): void {
  const s = useTimelineStore.getState();
  const project = s.currentProject;
  if (!project) return;
  const ids = new Set(s.selectedClipIds);
  const groups = new Set<string>();
  for (const t of project.tracks) {
    for (const c of t.clips) if (ids.has(c.id) && c.groupId) groups.add(c.groupId);
  }
  for (const g of groups) s.ungroupClips(g);
}

/**
 * Move the playhead to the previous / next edit point — any clip
 * start or end on any track, or 0 (Premiere / FCP ↑ ↓).
 */
export function jumpToEditPoint(direction: 1 | -1): void {
  const s = useTimelineStore.getState();
  const project = s.currentProject;
  if (!project) return;
  const points = new Set<number>([0]);
  for (const t of project.tracks) {
    for (const c of t.clips) {
      points.add(c.startOffset);
      points.add(c.startOffset + c.duration);
    }
  }
  const eps = 1e-4;
  const here = s.playheadPosition;
  const sorted = [...points].sort((a, b) => a - b);
  const next =
    direction > 0
      ? sorted.find((p) => p > here + eps)
      : [...sorted].reverse().find((p) => p < here - eps);
  if (next === undefined) return;
  s.updatePlayhead(next);
  window.dispatchEvent(
    new CustomEvent('timeline:scroll-to-time', { detail: { seconds: next } }),
  );
}

/** Add a default text overlay at the playhead. */
export function addTextAtPlayhead(): void {
  const s = useTimelineStore.getState();
  if (!s.currentProject) return;
  s.addOverlay({
    id: newId(),
    text: 'Sample text',
    startOffset: s.playheadPosition,
    duration: 3,
    style: {
      position: { x: 0.1, y: 0.85 },
      color: '#ffffff',
      size: 64,
    },
  });
}

/**
 * Add a default (Dissolve, 1s) transition at the V1 cut nearest the
 * playhead, or into the selected clip if it touches a previous clip
 * (Premiere's ⌘D "Apply Default Video Transition"). Selects the
 * incoming clip so Properties shows the transition.
 */
export function addTransitionAtPlayhead(): void {
  const s = useTimelineStore.getState();
  const project = s.currentProject;
  if (!project) return;
  const clips = baseTrackClips(project);
  const touching = clips.filter((c) => previousTouching(clips, c));
  if (touching.length === 0) return;
  const selected = touching.find((c) => c.id === s.selectedClipId);
  const target =
    selected ??
    touching.reduce((best, c) =>
      Math.abs(c.startOffset - s.playheadPosition) <
      Math.abs(best.startOffset - s.playheadPosition)
        ? c
        : best,
    );
  addTransitionInto(target.id);
}

/** Give `clipId` a default transition (keeping an existing one). */
export function addTransitionInto(clipId: string): void {
  const s = useTimelineStore.getState();
  const clip = s.currentProject
    ? baseTrackClips(s.currentProject).find((c) => c.id === clipId)
    : undefined;
  if (!clip) return;
  if (!clip.transitionIn) {
    s.setClipTransitionIn(clipId, {
      kind: 'dissolve',
      duration: DEFAULT_TRANSITION_DURATION,
    });
  }
  s.selectClip(clipId);
}

/** Add an annotation shape at the playhead and select it. */
export function addShapeAtPlayhead(kind: ShapeKind): void {
  const s = useTimelineStore.getState();
  const project = s.currentProject;
  if (!project) return;
  s.addOverlay(
    createShapeOverlay(kind, s.playheadPosition, project.resolution.height),
  );
}
