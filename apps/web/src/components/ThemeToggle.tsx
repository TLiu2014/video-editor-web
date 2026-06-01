import { MoonIcon, SunIcon } from 'lucide-react';
import { useThemeStore } from '../store/useThemeStore';
import { Button } from './ui/Button';

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  const target = theme === 'light' ? 'dark' : 'light';
  return (
    <Button
      variant="ghost"
      size="md"
      iconOnly
      icon={theme === 'light' ? <MoonIcon /> : <SunIcon />}
      onClick={toggleTheme}
      title={`Switch to ${target} theme`}
      aria-label={`Switch to ${target} theme`}
    />
  );
}
