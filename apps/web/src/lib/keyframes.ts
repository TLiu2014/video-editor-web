/**
 * Generic keyframe curves: eased (smoothstep) interpolation between
 * keyframes, holding before the first and after the last, plus the
 * same curve compiled to an ffmpeg expression so preview and export
 * agree. Used by zoom & pan, PiP motion and overlay motion paths.
 */

export interface Keyframe {
  /** Time in the curve's own clock (source time or overlay time). */
  t: number;
}

/** Two keyframes closer than this are the same one. */
export const KEYFRAME_EPSILON = 1 / 60;

const smoothstep = (u: number) => u * u * (3 - 2 * u);

export function sortKeys<K extends Keyframe>(keys: readonly K[] | undefined): K[] {
  return [...(keys ?? [])].sort((a, b) => a.t - b.t);
}

/** Eased value of `pick` at time `t`, or null with no keyframes. */
export function sampleCurve<K extends Keyframe>(
  keys: readonly K[] | undefined,
  t: number,
  pick: (k: K) => number,
): number | null {
  const sorted = sortKeys(keys);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return null;
  if (t <= first.t) return pick(first);
  if (t >= last.t) return pick(last);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (t <= b.t) {
      const s = smoothstep((t - a.t) / (b.t - a.t));
      return pick(a) + (pick(b) - pick(a)) * s;
    }
  }
  return pick(last);
}

/**
 * The same curve as an ffmpeg expression in variable `timeVar`.
 * `toTime` maps a keyframe's time to the expression's clock (e.g.
 * source time → timeline seconds for overlay `t`).
 */
export function ffmpegCurve<K extends Keyframe>(
  keys: readonly K[],
  pick: (k: K) => number,
  timeVar: string,
  toTime: (t: number) => number = (t) => t,
): string {
  const sorted = sortKeys(keys);
  const num = (v: number) => v.toFixed(5);
  if (sorted.length === 0) return '0';
  const at = sorted.map((k) => toTime(k.t));
  let expr = num(pick(sorted[sorted.length - 1]!));
  for (let i = sorted.length - 1; i >= 1; i--) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    const ua = at[i - 1]!;
    const ub = at[i]!;
    const u = `((${timeVar}-${num(ua)})/${num(Math.max(1e-6, ub - ua))})`;
    const seg = `${num(pick(a))}+(${num(pick(b) - pick(a))})*${u}*${u}*(3-2*${u})`;
    expr = `if(lt(${timeVar},${num(ub)}),${seg},${expr})`;
  }
  return `if(lt(${timeVar},${num(at[0]!)}),${num(pick(sorted[0]!))},${expr})`;
}

export function keyAt<K extends Keyframe>(keys: readonly K[] | undefined, t: number): K | null {
  return sortKeys(keys).find((k) => Math.abs(k.t - t) < KEYFRAME_EPSILON) ?? null;
}

/** Insert `key`, replacing any keyframe at (about) the same time. */
export function upsertKey<K extends Keyframe>(keys: readonly K[] | undefined, key: K): K[] {
  return sortKeys([
    ...(keys ?? []).filter((k) => Math.abs(k.t - key.t) >= KEYFRAME_EPSILON),
    key,
  ]);
}

export function removeKey<K extends Keyframe>(keys: readonly K[] | undefined, t: number): K[] {
  return sortKeys((keys ?? []).filter((k) => Math.abs(k.t - t) >= KEYFRAME_EPSILON));
}

/** Union of two sets; on a time collision the first set wins. */
export function mergeKeys<K extends Keyframe>(a: readonly K[], b: readonly K[]): K[] {
  const out = [...a];
  for (const k of b) {
    if (!out.some((o) => Math.abs(o.t - k.t) < KEYFRAME_EPSILON)) out.push(k);
  }
  return sortKeys(out);
}

/** Previous / next keyframe strictly before / after `t`. */
export function neighborKeys<K extends Keyframe>(
  keys: readonly K[] | undefined,
  t: number,
): { prev: K | undefined; next: K | undefined } {
  const sorted = sortKeys(keys);
  return {
    prev: [...sorted].reverse().find((k) => k.t < t - KEYFRAME_EPSILON),
    next: sorted.find((k) => k.t > t + KEYFRAME_EPSILON),
  };
}
