function pad(n: number, width = 2): string {
  return n.toString().padStart(width, '0');
}

/**
 * Inverse of `formatTime` for user input. Accepts the same shapes
 * the formatter emits — `ss(.cc)`, `mm:ss(.cc)`, `h:mm:ss(.cc)` —
 * plus a plain number of seconds. Returns null on anything we
 * can't parse so callers can keep the prior value rather than
 * snapping the playhead to 0 on a typo.
 */
export function parseTime(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const parts = trimmed.split(':');
  if (parts.length > 3) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d+(\.\d+)?$/.test(p)) return null;
    nums.push(Number(p));
  }
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (nums.length === 1) return nums[0] ?? null;
  if (nums.length === 2) return (nums[0] ?? 0) * 60 + (nums[1] ?? 0);
  return (nums[0] ?? 0) * 3600 + (nums[1] ?? 0) * 60 + (nums[2] ?? 0);
}

/**
 * Render a non-negative number of seconds as `mm:ss.cc` or `h:mm:ss.cc`
 * when the duration exceeds one hour. Centiseconds can be suppressed for
 * ruler tick labels where they'd be visual noise.
 */
export function formatTime(seconds: number, withCentis = true): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total - Math.floor(total)) * 100);
  const hms = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return withCentis ? `${hms}.${pad(cs)}` : hms;
}
