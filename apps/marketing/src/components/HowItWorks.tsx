import { DownloadIcon, FilmIcon, UploadIcon } from 'lucide-react';

const STEPS = [
  {
    icon: UploadIcon,
    label: 'Step 1',
    title: 'Drop in your media',
    description:
      'Drag video and audio files straight onto the timeline. Nothing uploads — files stay on your machine.',
  },
  {
    icon: FilmIcon,
    label: 'Step 2',
    title: 'Cut, layer, polish',
    description:
      'Split, trim, ripple-delete, stack PiP overlays, drop fades and color effects. Everything happens locally at full quality.',
  },
  {
    icon: DownloadIcon,
    label: 'Step 3',
    title: 'Export an MP4',
    description:
      'Render directly in the browser. Save the result straight to your device — no waiting room, no quota, no queue.',
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="border-b border-line bg-canvas-soft"
    >
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-accent">
            How it works
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            From import to export, all in one tab.
          </h2>
        </div>

        <ol className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {STEPS.map((step, idx) => (
            <li
              key={step.title}
              className="relative rounded-xl border border-line bg-surface p-6"
            >
              <div className="flex items-center justify-between">
                <div className="flex size-10 items-center justify-center rounded-lg bg-accent text-white">
                  <step.icon className="size-5" />
                </div>
                <span className="font-mono text-3xl font-bold text-ink-subtle/30">
                  0{idx + 1}
                </span>
              </div>
              <p className="mt-4 text-xs font-medium uppercase tracking-wider text-accent">
                {step.label}
              </p>
              <h3 className="mt-1 text-lg font-semibold text-ink">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
