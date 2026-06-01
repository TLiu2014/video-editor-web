import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'video-editor-web/theme';

interface ThemeState {
  theme: Theme;
}

interface ThemeActions {
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export type ThemeStore = ThemeState & ThemeActions;

/**
 * UI theme — light is the default. Persisted to localStorage under
 * `THEME_STORAGE_KEY`. The synchronous read in `main.tsx` uses the
 * same key so the `data-theme` attribute is set before React mounts.
 */
export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: 'light',
      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
    }),
    { name: THEME_STORAGE_KEY },
  ),
);

export function applyThemeToDocument(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
}

/**
 * Read the persisted theme synchronously from localStorage. Called
 * from `main.tsx` before React renders so the initial paint is in
 * the correct theme — no light/dark flash on reload.
 */
export function readPersistedTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return 'light';
    const parsed = JSON.parse(raw) as { state?: { theme?: Theme } };
    return parsed.state?.theme === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
