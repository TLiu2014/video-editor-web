import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UsageEntry {
  count: number;
  lastUsedAt: number;
}

interface PaletteHistoryState {
  usage: Record<string, UsageEntry>;
}

interface PaletteHistoryActions {
  recordUsage: (commandId: string) => void;
  clearUsage: () => void;
}

/**
 * Tracks command-palette usage across sessions. Persisted to
 * localStorage so a returning user's frequent commands stay
 * surfaced at the top of the empty-query view.
 *
 * Schema: `{ usage: { [commandId]: { count, lastUsedAt } } }`.
 * Bounded growth: there are ~17 commands today and they're all
 * named in code, so the map is naturally small.
 */
export const usePaletteHistoryStore = create<
  PaletteHistoryState & PaletteHistoryActions
>()(
  persist(
    (set) => ({
      usage: {},
      recordUsage: (commandId) =>
        set((state) => {
          const prev = state.usage[commandId];
          const entry: UsageEntry = {
            count: (prev?.count ?? 0) + 1,
            lastUsedAt: Date.now(),
          };
          return { usage: { ...state.usage, [commandId]: entry } };
        }),
      clearUsage: () => set({ usage: {} }),
    }),
    { name: 'video-editor-web/palette-history' },
  ),
);
