/**
 * Singleton AudioContext shared by the playback engine (A-track
 * clips) and the preview pane (V-track embedded audio), so a
 * single master `AnalyserNode` can meter everything the user
 * hears.
 *
 * Created lazily on the first caller — browsers refuse to allocate
 * an AudioContext before the page has handled a user gesture, and
 * useAudioEngine already wires up gesture-driven resumes.
 */

interface AudioGraph {
  ctx: AudioContext;
  analyser: AnalyserNode;
}

let graph: AudioGraph | null = null;

export function ensureAudioGraph(): AudioGraph | null {
  if (graph) return graph;
  try {
    type Win = typeof window & {
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor =
      window.AudioContext ?? (window as Win).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const analyser = ctx.createAnalyser();
    // 1024 samples is plenty for an amplitude meter and keeps the
    // RAF read cheap.
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;
    analyser.connect(ctx.destination);
    graph = { ctx, analyser };
    return graph;
  } catch {
    return null;
  }
}

export function getAnalyser(): AnalyserNode | null {
  return graph?.analyser ?? null;
}

export function getAudioContext(): AudioContext | null {
  return graph?.ctx ?? null;
}

/**
 * Track which media elements have already been routed through the
 * graph — `createMediaElementSource` can only be called once per
 * element, and subsequent attempts throw.
 */
const sourcedElements = new WeakSet<HTMLMediaElement>();

export function routeMediaElement(
  el: HTMLMediaElement,
): MediaElementAudioSourceNode | null {
  if (sourcedElements.has(el)) return null;
  const g = ensureAudioGraph();
  if (!g) return null;
  try {
    const source = g.ctx.createMediaElementSource(el);
    source.connect(g.analyser);
    sourcedElements.add(el);
    return source;
  } catch {
    return null;
  }
}

export function resumeAudioGraph(): void {
  const g = graph;
  if (!g) return;
  if (g.ctx.state === 'suspended') void g.ctx.resume();
}
