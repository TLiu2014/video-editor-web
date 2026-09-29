import { ArrowRightIcon, ShieldCheckIcon } from 'lucide-react';
import { GithubBrandIcon } from './BrandIcons';

export function Hero({ editorUrl }: { editorUrl: string }) {
  return (
    <section
      id="top"
      className="relative isolate overflow-hidden border-b border-line"
    >
      {/* Decorative gradient backdrop — purely CSS so zero JS cost
          and it cleanly recolors per theme via the accent token. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--theme-accent-soft),_transparent_60%)]"
      />

      <div className="mx-auto flex max-w-5xl flex-col items-center px-6 py-24 text-center sm:py-32">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted">
          <ShieldCheckIcon className="size-3.5 text-accent" />
          100% client-side — your media never leaves the browser
        </span>

        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl sm:leading-[1.05]">
          Professional Video Editing.
          <br />
          <span className="bg-gradient-to-r from-accent to-accent-strong bg-clip-text text-transparent">
            100% Local. Zero Server Cost. Complete Privacy.
          </span>
        </h1>

        <p className="mt-6 max-w-2xl text-pretty text-base text-ink-muted sm:text-lg">
          A full non-linear editor that lives in your browser. No uploads, no
          accounts, no surveillance — just open a tab and edit. Your files
          stay on your device, end to end.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <a
            href={editorUrl}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Open Editor
            <ArrowRightIcon className="size-4" />
          </a>
          <a
            href="https://github.com/"
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-6 py-3 text-sm font-semibold text-ink transition hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            <GithubBrandIcon className="size-4" />
            View on GitHub
          </a>
        </div>

        <p className="mt-6 text-xs text-ink-subtle">
          Free forever · MIT licensed · No sign-up required
        </p>
      </div>
    </section>
  );
}
