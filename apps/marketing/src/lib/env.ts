/**
 * Resolve the editor app URL. Read once from
 * `NEXT_PUBLIC_EDITOR_URL`; fall back to the local Vite dev port
 * so a fresh `pnpm dev` in this app still produces a working CTA
 * even without a populated .env.local.
 */
export function getEditorUrl(): string {
  return process.env.NEXT_PUBLIC_EDITOR_URL ?? 'http://localhost:5173';
}
