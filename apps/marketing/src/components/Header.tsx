import { FilmIcon } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

const NAV_ITEMS: { label: string; href: string }[] = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'About', href: '#about' },
  { label: 'FAQ', href: '#faq' },
];

/**
 * Top sticky header. Logo + in-page nav + theme toggle + primary
 * CTA. Server component — the only client island is the
 * `<ThemeToggle />` button.
 */
export function Header({ editorUrl }: { editorUrl: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a
          href="#top"
          className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink"
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-accent text-white">
            <FilmIcon className="size-4" />
          </span>
          video-editor-web
        </a>

        <nav className="hidden items-center gap-7 text-sm text-ink-muted md:flex">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="transition hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <a
            href={editorUrl}
            className="hidden items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:inline-flex"
          >
            Open Editor
          </a>
        </div>
      </div>
    </header>
  );
}
