import { MIN_CLIP_DURATION } from '../store/useTimelineStore';
import type {
  AnyClip,
  ClipId,
  TimelineTrack,
  VideoProject,
} from '../types/timeline';

export type DragMode = 'move' | 'trim-left' | 'trim-right';

export interface DeltaRange {
  minDelta: number;
  maxDelta: number;
}

function findClipAndTrack(
  project: VideoProject,
  clipId: ClipId,
): { clip: AnyClip; track: TimelineTrack } | null {
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.id === clipId) return { clip, track };
    }
  }
  return null;
}

/**
 * For a given clip, find the end of the nearest non-overlapping
 * preceding sibling on the same track and the start of the nearest
 * non-overlapping following sibling. Already-overlapping siblings
 * (legacy data, race conditions) are ignored — we don't try to
 * "untangle" the timeline implicitly.
 */
function findNeighborBounds(
  track: TimelineTrack,
  clip: AnyClip,
): { prevEnd: number; nextStart: number } {
  const clipEnd = clip.startOffset + clip.duration;
  let prevEnd = 0;
  let nextStart = Infinity;
  for (const other of track.clips) {
    if (other.id === clip.id) continue;
    const otherEnd = other.startOffset + other.duration;
    if (otherEnd <= clip.startOffset) {
      if (otherEnd > prevEnd) prevEnd = otherEnd;
    } else if (other.startOffset >= clipEnd) {
      if (other.startOffset < nextStart) nextStart = other.startOffset;
    }
    // overlapping: skip
  }
  return { prevEnd, nextStart };
}

/**
 * Compute the valid range of drag delta (in seconds) for a clip
 * given its current position, the drag mode, and the project's
 * other clips. The returned range bakes together:
 *   - data-model constraints (trim ≥ 0, end ≤ sourceDuration, min
 *     clip duration, can't push start below zero)
 *   - same-track neighbor constraints (no overlap on commit)
 *
 * `Clip` uses this for the live drag preview so the user feels the
 * handle "stick" against neighbors; the store actions use it
 * defensively so non-UI callers can't violate the invariants.
 */
export function computeDeltaRange(
  clip: AnyClip,
  mode: DragMode,
  project: VideoProject,
): DeltaRange {
  const located = findClipAndTrack(project, clip.id);
  if (!located) {
    return { minDelta: 0, maxDelta: 0 };
  }
  const { prevEnd, nextStart } = findNeighborBounds(located.track, located.clip);

  if (mode === 'move') {
    return {
      minDelta: prevEnd - clip.startOffset,
      maxDelta: nextStart - clip.duration - clip.startOffset,
    };
  }
  if (mode === 'trim-left') {
    const minDeltaFromTrim = -clip.trimStart;
    const maxDeltaFromTrim = clip.trimEnd - clip.trimStart - MIN_CLIP_DURATION;
    const minDeltaFromNeighbor = prevEnd - clip.startOffset;
    return {
      minDelta: Math.max(minDeltaFromTrim, minDeltaFromNeighbor),
      maxDelta: maxDeltaFromTrim,
    };
  }
  // trim-right
  const minDeltaFromTrim =
    MIN_CLIP_DURATION - (clip.trimEnd - clip.trimStart);
  const maxDeltaFromTrim = clip.sourceDuration - clip.trimEnd;
  const maxDeltaFromNeighbor = nextStart - (clip.startOffset + clip.duration);
  return {
    minDelta: minDeltaFromTrim,
    maxDelta: Math.min(maxDeltaFromTrim, maxDeltaFromNeighbor),
  };
}

export function clampDelta(range: DeltaRange, deltaSec: number): number {
  return Math.max(range.minDelta, Math.min(range.maxDelta, deltaSec));
}
