import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Sizes of the resizable main panels, in CSS pixels. Persisted to
 * localStorage so the workspace comes back the way the user left it.
 * Each value is clamped on write; `PANEL_LIMITS` is the single source
 * of truth for the bounds and the double-click reset defaults.
 */
export const PANEL_LIMITS = {
  sidebarWidth: { min: 180, max: 480, initial: 240 },
  propertiesWidth: { min: 240, max: 560, initial: 320 },
  timelineHeight: { min: 160, max: 720, initial: 320 },
} as const;

export type PanelSize = keyof typeof PANEL_LIMITS;

type LayoutState = Record<PanelSize, number> & {
  setSize: (panel: PanelSize, px: number) => void;
  resetSize: (panel: PanelSize) => void;
};

function clampSize(panel: PanelSize, px: number): number {
  const { min, max } = PANEL_LIMITS[panel];
  return Math.round(Math.max(min, Math.min(max, px)));
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarWidth: PANEL_LIMITS.sidebarWidth.initial,
      propertiesWidth: PANEL_LIMITS.propertiesWidth.initial,
      timelineHeight: PANEL_LIMITS.timelineHeight.initial,
      setSize: (panel, px) =>
        set({ [panel]: clampSize(panel, px) } as Partial<LayoutState>),
      resetSize: (panel) =>
        set({ [panel]: PANEL_LIMITS[panel].initial } as Partial<LayoutState>),
    }),
    { name: 'video-editor-web/layout' },
  ),
);
