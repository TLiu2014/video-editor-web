/**
 * JKL shuttle (Premiere / FCP / Resolve): L plays forward, J backward,
 * repeated presses step through these speeds; K stops. The timeline
 * clock moves at `shuttleSpeed` × real time (negative = reverse).
 *
 * Media elements can't play backwards, so in reverse they stay paused
 * and follow the playhead by seeking (picture only, no sound).
 */
export const SHUTTLE_SPEEDS = [1, 2, 4, 8] as const;

/** Next speed after pressing L (direction 1) or J (-1) at `current`. */
export function nextShuttleSpeed(
  current: number,
  playing: boolean,
  direction: 1 | -1,
): number {
  // Not playing, or playing the other way: start at 1× this way.
  if (!playing || Math.sign(current) !== direction) return direction;
  const i = SHUTTLE_SPEEDS.indexOf(Math.abs(current) as (typeof SHUTTLE_SPEEDS)[number]);
  const next = SHUTTLE_SPEEDS[Math.min(SHUTTLE_SPEEDS.length - 1, i + 1)] ?? 1;
  return next * direction;
}

/** Should media elements be running (forward playback only)? */
export function mediaShouldPlay(state: { isPlaying: boolean; shuttleSpeed: number }): boolean {
  return state.isPlaying && state.shuttleSpeed > 0;
}

/** Multiplier on each element's own playbackRate while shuttling forward. */
export function mediaRateFactor(state: { shuttleSpeed: number }): number {
  return state.shuttleSpeed > 0 ? state.shuttleSpeed : 1;
}
