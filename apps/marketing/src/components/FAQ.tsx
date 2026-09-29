const QUESTIONS: { q: string; a: string }[] = [
  {
    q: 'Where does my video go when I upload it?',
    a: 'Nowhere. There is no "upload." Your file is loaded into the browser tab via a File object and stays in RAM. When you export, the rendered MP4 is created in the browser and saved to your disk via a normal download.',
  },
  {
    q: 'Is this really free? Where\'s the catch?',
    a: 'No catch. The runtime cost of serving a static page is negligible because the heavy lifting (encoding, decoding, rendering) all happens on your machine. We pay for a domain and not much else.',
  },
  {
    q: 'How does it perform vs. a desktop NLE?',
    a: 'For most short-form work — social clips, vlogs, screencasts, tutorials — comparable. For long-form 4K timeline scrubbing it\'s slower than a native app, because browsers cap memory and threading. We\'re working on it.',
  },
  {
    q: 'What formats are supported?',
    a: 'Import: most common video and audio containers — MP4, MOV, WebM, MKV, MP3, WAV, FLAC, and more. Export: MP4 (H.264 + AAC) optimized for instant playback. Additional export formats are on the roadmap.',
  },
  {
    q: 'Can I self-host this?',
    a: 'Yes. The editor is a static SPA — drop the build output behind any static host (Cloudflare Pages, Netlify, S3+CloudFront, your own nginx). No runtime dependencies on our end whatsoever.',
  },
  {
    q: 'What about AI features — do you train on my data?',
    a: 'We can\'t. Your data never reaches us. AI captions use BYOK (Bring Your Own Key) — you provide an API key and the request goes directly from your browser to the provider you chose.',
  },
];

export function FAQ() {
  return (
    <section id="faq" className="border-b border-line bg-canvas-soft">
      <div className="mx-auto max-w-4xl px-6 py-20 sm:py-28">
        <div className="text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-accent">
            FAQ
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Questions you'd actually ask.
          </h2>
        </div>

        <dl className="mt-14 space-y-4">
          {QUESTIONS.map(({ q, a }) => (
            <details
              key={q}
              className="group rounded-xl border border-line bg-surface p-5 transition open:border-line-strong"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium text-ink">
                {q}
                <span
                  aria-hidden
                  className="ml-4 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-line text-ink-muted transition group-open:rotate-45 group-open:border-accent group-open:text-accent"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                {a}
              </p>
            </details>
          ))}
        </dl>
      </div>
    </section>
  );
}
