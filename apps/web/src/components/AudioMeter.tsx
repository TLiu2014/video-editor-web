import { useEffect, useRef } from 'react';
import { ensureAudioGraph, getAnalyser } from '../lib/audioGraph';

/**
 * Live audio level indicator. Reads time-domain samples from the
 * shared master `AnalyserNode` (owned by `lib/audioGraph.ts`) on
 * every animation frame and renders the peak as a horizontal bar.
 *
 * Both the A-track playback engine and the Preview's V-track
 * video element are wired through that analyser, so this bar
 * shows everything the user hears — not just one source.
 *
 * The DOM updates imperatively (transform width) to avoid a React
 * render on every frame.
 */
export function AudioMeter() {
  const fillRef = useRef<HTMLDivElement>(null);
  const peakHoldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Lazily ensure the graph exists so this component works even
    // when no clip has been added yet (and useAudioEngine hasn't
    // touched the graph).
    ensureAudioGraph();

    let raf = 0;
    let holdPeak = 0;
    let holdDecay = 0;
    const data = new Uint8Array(1024);

    const tick = () => {
      const analyser = getAnalyser();
      if (analyser) {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
          const v = Math.abs((data[i] ?? 128) - 128) / 128;
          if (v > peak) peak = v;
        }
        // Slow decay on the hold marker so a brief loud transient
        // stays visible for ~500ms.
        if (peak > holdPeak) {
          holdPeak = peak;
          holdDecay = 0;
        } else {
          holdDecay += 1;
          if (holdDecay > 30) {
            holdPeak = Math.max(0, holdPeak - 0.02);
          }
        }
        if (fillRef.current) {
          fillRef.current.style.transform = `scaleX(${Math.min(1, peak)})`;
        }
        if (peakHoldRef.current) {
          peakHoldRef.current.style.transform = `translateX(${(Math.min(1, holdPeak) * 100).toFixed(2)}%)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex items-center gap-1.5" title="Audio level">
      <span className="text-text-muted/70">Audio</span>
      <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-chrome">
        <div
          ref={fillRef}
          className="absolute inset-y-0 left-0 w-full origin-left bg-gradient-to-r from-emerald-500 via-amber-400 to-danger"
          style={{ transform: 'scaleX(0)' }}
        />
        <div
          ref={peakHoldRef}
          className="absolute inset-y-0 left-0 w-px bg-text-primary/80"
          style={{ transform: 'translateX(0)' }}
        />
      </div>
    </div>
  );
}
