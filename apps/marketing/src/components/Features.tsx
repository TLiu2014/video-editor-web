import {
  CaptionsIcon,
  CpuIcon,
  GaugeIcon,
  LayersIcon,
  LockIcon,
  ScissorsIcon,
  type LucideIcon,
} from 'lucide-react';

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: CpuIcon,
    title: 'Runs in Your Browser',
    description:
      'The full encode and decode pipeline runs locally inside your tab. No servers, no queue, no upload progress bar — just your CPU.',
  },
  {
    icon: LockIcon,
    title: 'Private by Design',
    description:
      'Your media never leaves your device. We can\'t see your files because they never touch our (non-existent) infrastructure.',
  },
  {
    icon: LayersIcon,
    title: 'Multi-Track Timeline',
    description:
      'Stack video and audio tracks with PiP overlays, rotation, opacity, fades, color effects, and group propagation.',
  },
  {
    icon: ScissorsIcon,
    title: 'Pro Editing Tools',
    description:
      'Ripple delete, ripple trim, razor, copy/paste, Mark In/Out + trim-to-range, snapping, undo with history coalescing.',
  },
  {
    icon: CaptionsIcon,
    title: 'BYOK AI Captions',
    description:
      'Auto-transcribe with your own API key. The audio is sent only to the provider you choose — never proxied through us.',
  },
  {
    icon: GaugeIcon,
    title: 'No Watermarks',
    description:
      'Free forever. Your exports look like you made them, because you did. No "Made with X" overlays, no premium tiers.',
  },
];

export function Features() {
  return (
    <section id="features" className="border-b border-line bg-canvas">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-accent">
            Features
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Everything a real editor needs. Nothing it doesn't.
          </h2>
          <p className="mt-4 text-base text-ink-muted">
            Built to feel native — the timeline behaviors and shortcuts you
            already know, in a browser tab.
          </p>
        </div>

        <ul className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li
              key={feature.title}
              className="group rounded-xl border border-line bg-surface p-6 transition hover:border-line-strong"
            >
              <div className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <feature.icon className="size-5" />
              </div>
              <h3 className="mt-5 text-base font-semibold text-ink">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                {feature.description}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
