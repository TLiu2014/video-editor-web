import { create } from 'zustand';

interface PaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

/**
 * Visibility of the global command palette. Kept in its own tiny
 * store so the Cmd+K keyboard binding can toggle it without
 * forcing a re-render of the whole AppShell.
 */
export const usePaletteStore = create<PaletteState>((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set({ open: !get().open }),
}));
