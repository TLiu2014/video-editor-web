import type {
  TransitionKind,
  VideoClip,
  VideoProject,
} from '../types/timeline';

/**
 * Transitions between touching clips on the base video track (V1).
 *
 * A transition is stored on the INCOMING clip (`transitionIn`) and is
 * centered on the cut: it runs from `cut - d/2` to `cut + d/2`. The
 * outgoing clip keeps going past its out-point for d/2 and the
 * incoming clip starts d/2 early — using source media beyond the trim
 * when there is some, holding the edge frame when there isn't — so a
 * transition never changes the length of the timeline. This mirrors
 * Camtasia / Premiere ("center at cut" alignment).
 */

export interface TransitionSpec {
  kind: TransitionKind;
  label: string;
  /** ffmpeg `xfade` transition name used by the export. */
  xfade: string;
}

export const TRANSITIONS: TransitionSpec[] = [
  { kind: 'dissolve', label: 'Dissolve', xfade: 'fade' },
  { kind: 'fadeblack', label: 'Fade through black', xfade: 'fadeblack' },
  { kind: 'wipeleft', label: 'Wipe left', xfade: 'wipeleft' },
  { kind: 'wiperight', label: 'Wipe right', xfade: 'wiperight' },
  { kind: 'slideleft', label: 'Slide left', xfade: 'slideleft' },
  { kind: 'slideright', label: 'Slide right', xfade: 'slideright' },
];

export const DEFAULT_TRANSITION_DURATION = 1;
export const MIN_TRANSITION_DURATION = 0.1;
export const MAX_TRANSITION_DURATION = 3;

const EDGE_EPSILON = 1e-3;

export function transitionSpec(kind: TransitionKind): TransitionSpec {
  return TRANSITIONS.find((t) => t.kind === kind) ?? TRANSITIONS[0]!;
}

/** The base track's video clips, in timeline order. */
export function baseTrackClips(project: VideoProject): VideoClip[] {
  const base = project.tracks.find((t) => t.type === 'video');
  return ((base?.clips ?? []) as VideoClip[])
    .filter((c) => c.kind === 'video')
    .slice()
    .sort((a, b) => a.startOffset - b.startOffset);
}

/** The clip on the base track that ends exactly where `clip` starts. */
export function previousTouching(
  clips: VideoClip[],
  clip: VideoClip,
): VideoClip | null {
  for (const c of clips) {
    if (c.id === clip.id) continue;
    if (Math.abs(c.startOffset + c.duration - clip.startOffset) < EDGE_EPSILON) {
      return c;
    }
  }
  return null;
}

/** Longest transition that fits between `prev` and `next`. */
export function maxTransitionDuration(prev: VideoClip, next: VideoClip): number {
  return Math.max(
    MIN_TRANSITION_DURATION,
    Math.min(MAX_TRANSITION_DURATION, prev.duration, next.duration),
  );
}

export interface ActiveTransition {
  kind: TransitionKind;
  /** Effective (clamped) duration in seconds. */
  duration: number;
  outgoing: VideoClip;
  incoming: VideoClip;
  /** Timeline second of the cut (= incoming.startOffset). */
  cut: number;
}

/**
 * The transition that will actually render into `clip`, or null. A
 * stored `transitionIn` is inert while the clip doesn't touch a
 * previous clip on V1 (e.g. after it was moved away); it comes back
 * if the clips are butted together again.
 */
export function effectiveTransitionIn(
  clips: VideoClip[],
  clip: VideoClip,
): ActiveTransition | null {
  const t = clip.transitionIn;
  if (!t) return null;
  const prev = previousTouching(clips, clip);
  if (!prev) return null;
  return {
    kind: t.kind,
    duration: Math.min(t.duration, maxTransitionDuration(prev, clip)),
    outgoing: prev,
    incoming: clip,
    cut: clip.startOffset,
  };
}

/** Every effective transition on the base track, in timeline order. */
export function baseTrackTransitions(project: VideoProject): ActiveTransition[] {
  const clips = baseTrackClips(project);
  const out: ActiveTransition[] = [];
  for (const c of clips) {
    const t = effectiveTransitionIn(clips, c);
    if (t) out.push(t);
  }
  return out;
}

/**
 * The transition the playhead is inside, with progress 0 → 1 across
 * its window, or null.
 */
export function transitionAt(
  project: VideoProject,
  playhead: number,
): (ActiveTransition & { progress: number }) | null {
  for (const t of baseTrackTransitions(project)) {
    const start = t.cut - t.duration / 2;
    if (playhead >= start && playhead < start + t.duration) {
      return { ...t, progress: (playhead - start) / t.duration };
    }
  }
  return null;
}
