import { computeTimelineDuration } from './clipRate';
import { newId } from './ids';
import type {
  AnyClip,
  AudioClip,
  ClipId,
  MediaAsset,
  MediaId,
  TimelineTrack,
  TrackId,
  VideoClip,
  VideoProject,
} from '../types/timeline';

/**
 * Pure timeline operations. Each takes a project (and arguments) and
 * returns a new project — no store access, no DOM — so the store
 * actions stay thin and the rules can be unit-tested directly.
 */

/** Tolerance for "these two edges touch" comparisons, in seconds. */
export const EDGE_EPSILON = 1e-4;

function clipEnd(clip: AnyClip): number {
  return clip.startOffset + clip.duration;
}

function mapClips(
  project: VideoProject,
  fn: (clip: AnyClip, track: TimelineTrack) => AnyClip,
): VideoProject {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) => fn(c, track)),
    })),
  };
}

export function findClipWithTrack(
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

// ---------------------------------------------------------------------------
// Free-slot placement
// ---------------------------------------------------------------------------

/**
 * Nearest start time to `desiredStart` (>= 0) where a span of
 * `duration` fits on `clips` without overlapping any of them. Clips in
 * `excludeIds` are treated as absent (e.g. the clip being moved).
 *
 * This is what lets a dragged clip "jump over" its neighbors: instead
 * of sticking against the next clip, the drop resolves to the closest
 * gap big enough to hold it, falling back to the end of the track.
 */
export function findFreeSlot(
  clips: AnyClip[],
  desiredStart: number,
  duration: number,
  excludeIds: ReadonlySet<ClipId> = new Set(),
): number {
  const want = Math.max(0, desiredStart);
  const occupied = clips
    .filter((c) => !excludeIds.has(c.id))
    .map((c) => [c.startOffset, clipEnd(c)] as const)
    .sort((a, b) => a[0] - b[0]);

  let best = Infinity;
  let bestDist = Infinity;
  const consider = (gapStart: number, gapEnd: number) => {
    if (gapEnd - gapStart + EDGE_EPSILON < duration) return;
    const cand = Math.min(Math.max(want, gapStart), gapEnd - duration);
    const dist = Math.abs(cand - want);
    if (dist < bestDist) {
      best = cand;
      bestDist = dist;
    }
  };

  let cursor = 0;
  for (const [s, e] of occupied) {
    if (s > cursor) consider(cursor, s);
    cursor = Math.max(cursor, e);
  }
  consider(cursor, Infinity);
  return Math.max(0, best);
}

// ---------------------------------------------------------------------------
// Moving
// ---------------------------------------------------------------------------

/**
 * Expand a set of clip ids to everything that should travel with them:
 * any clip sharing a `groupId` with a member comes along.
 */
export function expandWithGroups(
  project: VideoProject,
  ids: Iterable<ClipId>,
): Set<ClipId> {
  const out = new Set(ids);
  const groups = new Set<string>();
  for (const track of project.tracks) {
    for (const c of track.clips) {
      if (out.has(c.id) && c.groupId) groups.add(c.groupId);
    }
  }
  if (groups.size === 0) return out;
  for (const track of project.tracks) {
    for (const c of track.clips) {
      if (c.groupId && groups.has(c.groupId)) out.add(c.id);
    }
  }
  return out;
}

/**
 * The [min, max] horizontal delta the moving set can travel without any
 * member overlapping a non-moving clip on its own track or crossing t=0.
 * Members don't constrain each other (they move in lockstep).
 */
export function moveDeltaRange(
  project: VideoProject,
  movingIds: ReadonlySet<ClipId>,
): { minDelta: number; maxDelta: number } {
  let minDelta = -Infinity;
  let maxDelta = Infinity;
  for (const track of project.tracks) {
    const moving = track.clips.filter((c) => movingIds.has(c.id));
    if (moving.length === 0) continue;
    const fixed = track.clips.filter((c) => !movingIds.has(c.id));
    for (const m of moving) {
      let prevEnd = 0;
      let nextStart = Infinity;
      for (const f of fixed) {
        const fEnd = clipEnd(f);
        if (fEnd <= m.startOffset + EDGE_EPSILON) {
          prevEnd = Math.max(prevEnd, fEnd);
        } else if (f.startOffset >= clipEnd(m) - EDGE_EPSILON) {
          nextStart = Math.min(nextStart, f.startOffset);
        }
        // Already-overlapping legacy data: ignore rather than untangle.
      }
      minDelta = Math.max(minDelta, prevEnd - m.startOffset);
      maxDelta = Math.min(maxDelta, nextStart - clipEnd(m));
    }
  }
  return { minDelta: Math.min(0, minDelta), maxDelta: Math.max(0, maxDelta) };
}

/**
 * Shift every clip in `ids` (plus their group-mates) by `delta`
 * seconds, clamped so nothing overlaps or goes negative. Relative
 * spacing within the set is always preserved — when one member is
 * blocked, the whole set stops there.
 */
export function moveClipsBy(
  project: VideoProject,
  ids: Iterable<ClipId>,
  delta: number,
): VideoProject {
  const moving = expandWithGroups(project, ids);
  if (moving.size === 0 || delta === 0) return project;
  const { minDelta, maxDelta } = moveDeltaRange(project, moving);
  const applied = Math.max(minDelta, Math.min(maxDelta, delta));
  if (Math.abs(applied) < 1e-9) return project;
  return mapClips(project, (c) =>
    moving.has(c.id) ? { ...c, startOffset: c.startOffset + applied } : c,
  );
}

/**
 * Drop a single (ungrouped) clip at `desiredStart` on `targetTrackId`
 * (defaults to its own track). The clip lands in the nearest free slot,
 * so dragging past neighbors works and a cross-track drop never
 * overlaps. Kind mismatches (audio onto a video track) are rejected.
 */
export function placeClip(
  project: VideoProject,
  clipId: ClipId,
  desiredStart: number,
  targetTrackId?: TrackId,
): VideoProject {
  const located = findClipWithTrack(project, clipId);
  if (!located) return project;
  const { clip, track: source } = located;
  const target = targetTrackId
    ? project.tracks.find((t) => t.id === targetTrackId)
    : source;
  if (!target || target.type !== clip.kind) return project;

  const start = findFreeSlot(
    target.clips,
    desiredStart,
    clip.duration,
    new Set([clipId]),
  );
  if (target.id === source.id) {
    if (Math.abs(start - clip.startOffset) < 1e-9) return project;
    return mapClips(project, (c) =>
      c.id === clipId ? { ...c, startOffset: start } : c,
    );
  }
  const moved = { ...clip, trackId: target.id, startOffset: start };
  return {
    ...project,
    tracks: project.tracks.map((t) => {
      if (t.id === source.id) {
        return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
      }
      if (t.id === target.id) return { ...t, clips: [...t.clips, moved] };
      return t;
    }),
  };
}

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

export function removeClips(
  project: VideoProject,
  ids: ReadonlySet<ClipId>,
): VideoProject {
  return {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.filter((c) => !ids.has(c.id)),
    })),
  };
}

/**
 * Delete clips and close the space they occupied on their own track.
 * Each downstream clip shifts left by the total duration of deleted
 * clips that ended before it — so deleting two clips with a gap
 * between them keeps that gap.
 */
export function rippleRemoveClips(
  project: VideoProject,
  ids: ReadonlySet<ClipId>,
): VideoProject {
  return {
    ...project,
    tracks: project.tracks.map((t) => {
      const removed = t.clips.filter((c) => ids.has(c.id));
      if (removed.length === 0) return t;
      return {
        ...t,
        clips: t.clips
          .filter((c) => !ids.has(c.id))
          .map((c) => {
            let shift = 0;
            for (const r of removed) {
              if (clipEnd(r) <= c.startOffset + EDGE_EPSILON) shift += r.duration;
            }
            return shift === 0
              ? c
              : { ...c, startOffset: Math.max(0, c.startOffset - shift) };
          }),
      };
    }),
  };
}

/**
 * Remove the empty space between clips on each listed track, so every
 * clip butts against the previous one. The first clip keeps its start
 * (a deliberate lead-in, e.g. a PiP that appears at 0:10, survives).
 */
export function closeGaps(
  project: VideoProject,
  trackIds: ReadonlySet<TrackId>,
): VideoProject {
  return {
    ...project,
    tracks: project.tracks.map((t) => {
      if (!trackIds.has(t.id) || t.clips.length < 2) return t;
      const sorted = [...t.clips].sort((a, b) => a.startOffset - b.startOffset);
      const first = sorted[0];
      if (!first) return t;
      const nextStart = new Map<ClipId, number>();
      let cursor = first.startOffset;
      for (const c of sorted) {
        nextStart.set(c.id, cursor);
        cursor += c.duration;
      }
      return {
        ...t,
        clips: t.clips.map((c) => {
          const s = nextStart.get(c.id) ?? c.startOffset;
          return s === c.startOffset ? c : { ...c, startOffset: s };
        }),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Joining (the inverse of split)
// ---------------------------------------------------------------------------

export type JoinCheck =
  | { ok: true; ordered: AnyClip[] }
  | { ok: false; reason: string };

/**
 * Can these clips be joined back into one? They must be on the same
 * track, cut from the same media at the same speed, and continuous in
 * both timeline and source time — i.e. exactly what a split produces.
 * (Premiere calls this "Join Through Edits"; FCP "Join Clip".)
 */
export function checkJoin(project: VideoProject, ids: ClipId[]): JoinCheck {
  if (ids.length < 2) return { ok: false, reason: 'Select two or more clips.' };
  const found = ids
    .map((id) => findClipWithTrack(project, id))
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (found.length !== ids.length) return { ok: false, reason: 'Clip not found.' };
  const trackId = found[0]?.track.id;
  if (found.some((f) => f.track.id !== trackId)) {
    return { ok: false, reason: 'Clips must be on the same track.' };
  }
  const ordered = found
    .map((f) => f.clip)
    .sort((a, b) => a.startOffset - b.startOffset);
  const head = ordered[0];
  if (!head) return { ok: false, reason: 'Select two or more clips.' };
  const source = head.mediaId ?? head.file;
  const rate = head.playbackRate ?? 1;
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (!prev || !cur) continue;
    if ((cur.mediaId ?? cur.file) !== source) {
      return { ok: false, reason: 'Clips must come from the same media.' };
    }
    if ((cur.playbackRate ?? 1) !== rate) {
      return { ok: false, reason: 'Clips must have the same speed.' };
    }
    if (Math.abs(clipEnd(prev) - cur.startOffset) > EDGE_EPSILON) {
      return { ok: false, reason: 'Clips must be adjacent (no gap).' };
    }
    if (Math.abs(prev.trimEnd - cur.trimStart) > EDGE_EPSILON) {
      return {
        ok: false,
        reason: 'Clips must be continuous in the source (a split, not a re-cut).',
      };
    }
  }
  return { ok: true, ordered };
}

/**
 * Join clips that pass `checkJoin` into the leftmost one. The result
 * keeps the left clip's id and settings (volume, effects, transform…)
 * and takes the right clip's out-point and fade-out.
 */
export function joinClips(
  project: VideoProject,
  ids: ClipId[],
): { project: VideoProject; joinedId: ClipId } | null {
  const check = checkJoin(project, ids);
  if (!check.ok) return null;
  const head = check.ordered[0];
  const tail = check.ordered[check.ordered.length - 1];
  if (!head || !tail) return null;
  const joined = {
    ...head,
    trimEnd: tail.trimEnd,
    duration: computeTimelineDuration(head.trimStart, tail.trimEnd, head.playbackRate),
    fadeOut: tail.fadeOut,
  } as AnyClip;
  const drop = new Set(check.ordered.slice(1).map((c) => c.id));
  return {
    project: {
      ...project,
      tracks: project.tracks.map((t) => ({
        ...t,
        clips: t.clips
          .filter((c) => !drop.has(c.id))
          .map((c) => (c.id === head.id ? joined : c)),
      })),
    },
    joinedId: head.id,
  };
}

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

/** How many timeline clips use each asset. Assets with no uses are absent. */
export function mediaUsage(
  project: Pick<VideoProject, 'tracks'>,
): Map<MediaId, number> {
  const out = new Map<MediaId, number>();
  for (const t of project.tracks) {
    for (const c of t.clips) {
      if (c.mediaId) out.set(c.mediaId, (out.get(c.mediaId) ?? 0) + 1);
    }
  }
  return out;
}

/** Build a fresh full-length timeline clip from a library asset. */
export function clipFromAsset(
  asset: MediaAsset,
  trackId: TrackId,
  startOffset: number,
): AnyClip {
  const base = {
    id: newId(),
    name: asset.name,
    mediaId: asset.id,
    file: asset.file,
    startOffset,
    trimStart: 0,
    trimEnd: asset.duration,
    duration: asset.duration,
    sourceDuration: asset.duration,
    fadeIn: 0,
    fadeOut: 0,
    trackId,
  };
  if (asset.kind === 'video') {
    const clip: VideoClip = { ...base, kind: 'video', hasAudio: asset.hasAudio };
    return clip;
  }
  const clip: AudioClip = { ...base, kind: 'audio', volume: 1 };
  return clip;
}

/**
 * Put a library asset on the timeline. Tries `opts.trackId` (or the
 * first track of the asset's kind) at `opts.startOffset`; if that spot
 * is taken, tries the other same-kind tracks at the same time, and
 * finally falls back to the nearest free slot on the preferred track.
 */
export function insertAssetClip(
  project: VideoProject,
  asset: MediaAsset,
  opts: { trackId?: TrackId; startOffset: number },
): { project: VideoProject; clip: AnyClip } | null {
  const sameKind = project.tracks.filter((t) => t.type === asset.kind);
  const preferred =
    sameKind.find((t) => t.id === opts.trackId) ?? sameKind[0];
  if (!preferred) return null;
  const want = Math.max(0, opts.startOffset);
  const ordered = [preferred, ...sameKind.filter((t) => t !== preferred)];
  let target = preferred;
  let start: number | null = null;
  for (const t of ordered) {
    if (Math.abs(findFreeSlot(t.clips, want, asset.duration) - want) < 1e-9) {
      target = t;
      start = want;
      break;
    }
  }
  if (start === null) start = findFreeSlot(preferred.clips, want, asset.duration);
  const clip = clipFromAsset(asset, target.id, start);
  return {
    project: {
      ...project,
      tracks: project.tracks.map((t) =>
        t.id === target.id ? { ...t, clips: [...t.clips, clip] } : t,
      ),
    },
    clip,
  };
}

/** Drop an asset from the library along with every clip that uses it. */
export function removeMediaAsset(
  project: VideoProject,
  mediaId: MediaId,
): VideoProject {
  return {
    ...project,
    media: project.media.filter((m) => m.id !== mediaId),
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.filter((c) => c.mediaId !== mediaId),
    })),
  };
}

/** Remove every library asset that no timeline clip references. */
export function removeUnusedMedia(project: VideoProject): VideoProject {
  const used = mediaUsage(project);
  const media = project.media.filter((m) => used.has(m.id));
  return media.length === project.media.length ? project : { ...project, media };
}

// ---------------------------------------------------------------------------
// Reordering (drag a clip onto another clip)
// ---------------------------------------------------------------------------

export interface ReorderTarget {
  trackId: TrackId;
  /** The clip the dragged clip is dropped onto. */
  targetClipId: ClipId;
  /** Insert before or after it — decided by which half the pointer is over. */
  side: 'before' | 'after';
  /** Where the insertion marker belongs in the CURRENT layout (seconds). */
  markerAt: number;
}

/**
 * Is dropping `clipId` with the pointer at `pointerTime` over
 * `trackId` a reorder? It is when the pointer sits on another clip of
 * the same kind; the pointer's half of that clip picks the side.
 * Grouped clips don't reorder (it would break their relative timing).
 */
export function findReorderTarget(
  project: VideoProject,
  clipId: ClipId,
  trackId: TrackId,
  pointerTime: number,
): ReorderTarget | null {
  const located = findClipWithTrack(project, clipId);
  const track = project.tracks.find((t) => t.id === trackId);
  if (!located || !track || track.type !== located.clip.kind) return null;
  if (located.clip.groupId) return null;
  const hovered = track.clips.find(
    (c) =>
      c.id !== clipId && pointerTime >= c.startOffset && pointerTime < clipEnd(c),
  );
  if (!hovered) return null;
  const side =
    pointerTime < hovered.startOffset + hovered.duration / 2 ? 'before' : 'after';
  return {
    trackId,
    targetClipId: hovered.id,
    side,
    markerAt: side === 'before' ? hovered.startOffset : clipEnd(hovered),
  };
}

/**
 * Move a clip to sit directly before / after another clip, like a
 * rearrange edit: its old spot closes up (ripple) and clips at and
 * after the insertion point on the target track shift right to make
 * room. Works within a track and across same-kind tracks.
 */
export function reorderClip(
  project: VideoProject,
  clipId: ClipId,
  target: Pick<ReorderTarget, 'trackId' | 'targetClipId' | 'side'>,
): VideoProject {
  const located = findClipWithTrack(project, clipId);
  if (!located || target.targetClipId === clipId) return project;
  const { clip } = located;
  const without = rippleRemoveClips(project, new Set([clipId]));
  const anchor = findClipWithTrack(without, target.targetClipId);
  if (!anchor || anchor.track.id !== target.trackId) return project;
  if (anchor.track.type !== clip.kind) return project;
  const insertAt =
    target.side === 'before' ? anchor.clip.startOffset : clipEnd(anchor.clip);
  const placed = { ...clip, trackId: target.trackId, startOffset: insertAt };
  return {
    ...without,
    tracks: without.tracks.map((t) => {
      if (t.id !== target.trackId) return t;
      return {
        ...t,
        clips: [
          ...t.clips.map((c) =>
            c.startOffset >= insertAt - EDGE_EPSILON
              ? { ...c, startOffset: c.startOffset + clip.duration }
              : c,
          ),
          placed,
        ],
      };
    }),
  };
}
