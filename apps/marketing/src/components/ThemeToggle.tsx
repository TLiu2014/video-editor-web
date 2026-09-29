'use client';

import { MoonIcon, SunIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_THEME, THEME_STORAGE_KEY, type Theme } from '@/lib/theme';

/**
 * Toggle button that swaps `html[data-theme]` and persists the
 * choice to localStorage. The initial value is whatever the inline
 * boot script in layout.tsx already applied to the html element —
 * we read from there so the button reflects reality on mount
 * (avoids an SSR hydration mismatch).
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const initial =
      (document.documentElement.dataset.theme as Theme | undefined) ??
      DEFAULT_THEME;
    setTheme(initial);
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    // Enable transition class only for this swap so the rest of
    // the page isn't subject to color transitions during normal
    // interaction (hover states, etc.).
    document.documentElement.classList.add('theme-transition');
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // localStorage may be unavailable in private/embed contexts.
    }
    window.setTimeout(() => {
      document.documentElement.classList.remove('theme-transition');
    }, 250);
  };

  // Render the icon-less shell on the server pass so React doesn't
  // hydrate a mismatched icon. Once mounted we know the real theme.
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
      title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
      className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-surface text-ink-muted transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      {mounted ? (
        theme === 'light' ? (
          <MoonIcon className="size-4" />
        ) : (
          <SunIcon className="size-4" />
        )
      ) : (
        <span className="size-4" aria-hidden />
      )}
    </button>
  );
}
