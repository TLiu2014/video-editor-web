/**
 * Tiny platform helpers for displaying keyboard shortcut hints. We
 * only care about Mac vs everyone-else — that's the split that
 * matters for "⌘" vs "Ctrl" in menu items and tooltips.
 */
export const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export const MOD_KEY = isMac ? '⌘' : 'Ctrl+';

export function shortcut(...keys: string[]): string {
  return keys
    .map((k) => (k === 'Mod' ? MOD_KEY.replace(/\+$/, '') : k))
    .join(isMac ? '' : '+');
}
