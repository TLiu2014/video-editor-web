import { computeProjectDuration } from './projectMetrics';
import type { ClipId, OverlayId, VideoProject } from '../types/timeline';

/**
 * Major tick interval (seconds) for a given pixels-per-second zoom.
 * Used by both the ruler's tick rendering and the snap engine, so
 * the user "feels" snaps at the same intervals they see on the ruler.
 *
 * Candidates are the standard scale steps used by professional
 * timelines; we pick the smallest one that yields ~80px between
 * majors at the current zoom.
 */
export function chooseMajorInterval(pps: number): number {
  const targetPx = 80;
  const idealSec = targetPx / pps;
  const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
  for (const c of candidates) {
    if (c >= idealSec) return c;
  }
  return 300;
}

export interface SnapTargetOptions {
  /** Don't snap to this clip's own start/end while it's being dragged. */
  excludeClipId?: ClipId;
  /** Don't snap to this overlay's own edges while it's being moved. */
  excludeOverlayId?: OverlayId;
  /** Include the playhead as a snap target. */
  playhead?: number;
  /**
   * When set, emit grid ticks every `gridInterval` seconds up to
   * `gridLimitSec`. Pair with `chooseMajorInterval(pps)` to align
   * snap behavior with the visible ruler.
   */
  gridInterval?: number;
  gridLimitSec?: number;
}

/**
 * Build the snap target set for the timeline. Includes:
 *   - origin (0)
 *   - every clip's startOffset and end (minus excludeClipId)
 *   - every overlay's startOffset and end
 *   - the playhead (when supplied)
 *   - the project's overall end
 *   - optional ruler-grid ticks (chooseMajorInterval-aligned)
 */
export function collectSnapTargets(
  project: VideoProject,
  options: SnapTargetOptions = {},
): number[] {
  const {
    excludeClipId,
    excludeOverlayId,
    playhead,
    gridInterval,
    gridLimitSec,
  } = options;
  const targets: number[] = [0];

  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue;
      targets.push(clip.startOffset);
      targets.push(clip.startOffset + clip.duration);
    }
  }

  for (const overlay of project.overlays) {
    if (overlay.id === excludeOverlayId) continue;
    targets.push(overlay.startOffset);
    targets.push(overlay.startOffset + overlay.duration);
  }

  if (playhead !== undefined) targets.push(playhead);

  // Project end is technically covered by the last clip's end, but
  // emit it explicitly so an empty project (or one with overlay-only
  // content past the last clip) still snaps cleanly.
  targets.push(computeProjectDuration(project));

  if (gridInterval && gridInterval > 0) {
    const limit = gridLimitSec ?? 3600;
    for (let t = 0; t <= limit; t += gridInterval) {
      targets.push(t);
    }
  }

  return targets;
}

/**
 * Find the nearest target within `thresholdSec`, or null if nothing
 * is in range. Ties go to the first target encountered — the loop's
 * strict `<` keeps it.
 */
export function findNearestTarget(
  positionSec: number,
  targets: number[],
  thresholdSec: number,
): number | null {
  let bestDelta = Infinity;
  let bestTarget: number | null = null;
  for (const t of targets) {
    const d = Math.abs(t - positionSec);
    if (d <= thresholdSec && d < bestDelta) {
      bestDelta = d;
      bestTarget = t;
    }
  }
  return bestTarget;
}
