import { CodeIcon, HeartIcon, ShieldCheckIcon } from 'lucide-react';

const PRINCIPLES = [
  {
    icon: ShieldCheckIcon,
    title: 'Privacy is the product',
    description:
      'There is no backend. There is no analytics pixel. There is no telemetry. The page you\'re looking at right now is the entire third-party surface we ever touch — and even that ends here.',
  },
  {
    icon: CodeIcon,
    title: 'Open source, end-to-end',
    description:
      'Every line of the editor is MIT-licensed and on GitHub. Fork it, audit it, self-host it. The code is the spec.',
  },
  {
    icon: HeartIcon,
    title: 'Free, no asterisks',
    description:
      'No watermarks. No tiers. No "free for personal use, contact us for commercial." If you can open the page, you can ship a film with it.',
  },
];

export function About() {
  return (
    <section id="about" className="border-b border-line bg-canvas">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-accent">
              About
            </span>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              A video editor that respects you.
            </h2>
            <p className="mt-6 text-base leading-relaxed text-ink-muted">
              Almost every "free" online editor pays for itself by harvesting
              your data, your content, or your attention. We thought that was
              an absurd price for editing a 30-second clip.
            </p>
            <p className="mt-4 text-base leading-relaxed text-ink-muted">
              video-editor-web is what happens when you remove the server and
              just let the browser do the work. Your CPU is already powerful
              enough. Your files are already on your disk. Why ship them
              halfway across the planet to a stranger's data center?
            </p>
          </div>

          <ul className="space-y-5">
            {PRINCIPLES.map((p) => (
              <li
                key={p.title}
                className="rounded-xl border border-line bg-surface p-6"
              >
                <div className="flex items-start gap-4">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <p.icon className="size-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-ink">
                      {p.title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                      {p.description}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
