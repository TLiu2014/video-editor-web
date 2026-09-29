import { FilmIcon } from 'lucide-react';
import { GithubBrandIcon, XBrandIcon } from './BrandIcons';

const COLUMNS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Features', href: '#features' },
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Roadmap', href: '#' },
      { label: 'Changelog', href: '#' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Documentation', href: '#' },
      { label: 'Editing guide', href: '#' },
      { label: 'API & shortcuts', href: '#' },
      { label: 'Self-hosting', href: '#' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '#about' },
      { label: 'FAQ', href: '#faq' },
      { label: 'Open source', href: 'https://github.com/' },
      { label: 'Contact', href: '#' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
      { label: 'License', href: '#' },
      { label: 'Security', href: '#' },
    ],
  },
];

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-canvas">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-2 gap-10 lg:grid-cols-6">
          <div className="col-span-2">
            <a
              href="#top"
              className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink"
            >
              <span className="flex size-7 items-center justify-center rounded-md bg-accent text-white">
                <FilmIcon className="size-4" />
              </span>
              video-editor-web
            </a>
            <p className="mt-2 text-xs text-ink-subtle">
              by{' '}
              <span className="font-medium text-ink-muted">RDD Studio</span>
            </p>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-muted">
              A privacy-first, browser-native video editor. Runs entirely on
              your device. MIT licensed.
            </p>
            <div className="mt-5 flex items-center gap-2">
              <a
                href="https://github.com/"
                aria-label="GitHub"
                className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-surface text-ink-muted transition hover:text-ink"
              >
                <GithubBrandIcon className="size-4" />
              </a>
              <a
                href="https://twitter.com/"
                aria-label="X (formerly Twitter)"
                className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-surface text-ink-muted transition hover:text-ink"
              >
                <XBrandIcon className="size-4" />
              </a>
            </div>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
                {col.heading}
              </h3>
              <ul className="mt-4 space-y-3 text-sm">
                {col.links.map((l) => (
                  <li key={`${col.heading}-${l.label}`}>
                    <a
                      href={l.href}
                      className="text-ink-muted transition hover:text-ink"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-line pt-6 text-xs text-ink-subtle sm:flex-row sm:items-center">
          <p>© {year} RDD Studio. Built for the open web.</p>
          <p>
            No cookies. No analytics. No tracking. Promise.
          </p>
        </div>
      </div>
    </footer>
  );
}
