import { isMac } from './platform';

/**
 * Display catalogue of keyboard shortcuts, grouped for the
 * Keyboard Shortcuts sheet (?). The bindings themselves live in
 * `useKeyboardShortcuts`; keep the two in sync. `origin` notes which
 * established editor a binding follows — see docs/ARCHITECTURE.md.
 */
const MOD = isMac ? '⌘' : 'Ctrl';
const ALT = isMac ? '⌥' : 'Alt';

export interface ShortcutEntry {
  keys: string[];
  label: string;
  origin?: string;
}

export const SHORTCUT_GROUPS: { title: string; items: ShortcutEntry[] }[] = [
  {
    title: 'Playback & navigation',
    items: [
      { keys: ['Space'], label: 'Play / pause', origin: 'All editors' },
      { keys: ['J', 'K', 'L'], label: 'Shuttle: reverse / stop / forward — repeat J or L for 2×, 4×, 8×', origin: 'Premiere, FCP, Resolve' },
      { keys: ['K+J', 'K+L'], label: 'Step one frame back / forward', origin: 'Premiere, FCP, Resolve' },
      { keys: ['Home', 'End'], label: 'Go to start / end', origin: 'Premiere, FCP' },
      { keys: ['↑', '↓'], label: 'Previous / next edit point', origin: 'Premiere, FCP' },
      { keys: ['←', '→'], label: 'Nudge selection (or playhead when nothing selected); ⇧ = 10×' },
      { keys: ['=', '−', '0'], label: 'Zoom in / out / reset' },
    ],
  },
  {
    title: 'Edit',
    items: [
      { keys: ['S'], label: 'Split at playhead', origin: 'Camtasia' },
      { keys: ['Q', 'W'], label: 'Trim clip start / end to playhead', origin: 'Premiere (ripples there)' },
      { keys: ['⇧Q', '⇧W'], label: 'Ripple trim start / end to playhead' },
      { keys: [`${MOD}J`], label: 'Join clips' },
      { keys: [`${MOD}D`], label: 'Add transition at the nearest cut (V1)', origin: 'Premiere' },
      { keys: ['⌫'], label: 'Delete selection' },
      { keys: ['⇧⌫'], label: 'Ripple delete selection', origin: 'Premiere' },
      { keys: [`${MOD}X`, `${MOD}C`, `${MOD}V`], label: 'Cut / copy / paste at playhead' },
      { keys: [`${MOD}G`, `⇧${MOD}G`], label: 'Group / ungroup', origin: 'Camtasia, Premiere' },
      { keys: ['T'], label: 'Add text overlay at playhead' },
      { keys: [`${MOD}Z`, `⇧${MOD}Z`], label: 'Undo / redo' },
    ],
  },
  {
    title: 'Marks & ranges',
    items: [
      { keys: ['I', 'O'], label: 'Mark in / out at playhead (⇧ clears)', origin: 'Premiere, FCP, Resolve' },
      { keys: ['X'], label: 'Mark selected clips (or a range at the playhead)', origin: 'Premiere' },
      { keys: ['⇧X'], label: `Clear in / out (Premiere: ${ALT}X)` },
      { keys: ["'"], label: 'Delete range and close the gap', origin: 'Premiere “Extract”' },
      { keys: ["⇧'"], label: 'Trim to range (keep only in → out)' },
    ],
  },
  {
    title: 'Selection',
    items: [
      { keys: ['Click', '⇧Click'], label: 'Select / add to selection' },
      { keys: [`${MOD}A`], label: 'Select all clips' },
      { keys: ['Esc'], label: 'Clear selection' },
    ],
  },
  {
    title: 'Project',
    items: [
      { keys: [`${MOD}I`], label: 'Import media', origin: 'Premiere, Camtasia' },
      { keys: [`${MOD}E`], label: 'Export video', origin: 'FCP' },
      { keys: [`${MOD}K`], label: 'Command palette' },
      { keys: ['?'], label: 'Show this sheet' },
    ],
  },
];
