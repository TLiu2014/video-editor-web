/**
 * Generate a fresh string id. Uses `crypto.randomUUID()` which is
 * available in all modern browsers and Node 19+. We don't need the
 * UUID guarantees specifically — any opaque unique string is fine —
 * but the API is already there and is collision-safe.
 */
export function newId(): string {
  return crypto.randomUUID();
}
