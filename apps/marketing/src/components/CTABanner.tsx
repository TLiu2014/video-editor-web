import { ArrowRightIcon } from 'lucide-react';

export function CTABanner({ editorUrl }: { editorUrl: string }) {
  return (
    <section className="border-b border-line bg-canvas">
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
        <div className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-accent to-accent-strong px-8 py-14 text-center shadow-lg shadow-accent/20 sm:px-12 sm:py-16">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.18),_transparent_55%)]"
          />
          <h2 className="relative text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Open a tab. Edit a film.
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-base text-white/85">
            That's the whole workflow. No installer, no account, no upload bar.
          </p>
          <a
            href={editorUrl}
            className="relative mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-accent shadow-md transition hover:bg-white/95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-accent"
          >
            Launch the editor
            <ArrowRightIcon className="size-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
