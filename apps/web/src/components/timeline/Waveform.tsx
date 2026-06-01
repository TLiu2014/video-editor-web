import { useEffect, useRef } from 'react';
import { useWaveform } from '../../hooks/useWaveform';
import type { AnyClip } from '../../types/timeline';

/**
 * Render the audio waveform inside a clip block. The peak array is
 * decoded once per File (cached in `lib/waveform.ts`) and downsampled
 * to the canvas's pixel width on every redraw. Canvas uses DPR
 * scaling so it stays sharp on Retina without bloating pixel count
 * past the visible width.
 *
 * Redraws when:
 *   - `widthPx` or `heightPx` change (track resize / zoom)
 *   - `trimStart` / `trimEnd` change (waveform window slides)
 *   - peaks finish loading
 */
export function Waveform({
  clip,
  widthPx,
  heightPx,
  topPx = 0,
}: {
  clip: AnyClip;
  widthPx: number;
  heightPx: number;
  /** Top offset within the clip's positioned container. */
  topPx?: number;
}) {
  const peaks = useWaveform(clip.file);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || widthPx < 1 || heightPx < 1) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(widthPx * dpr));
    canvas.height = Math.max(1, Math.floor(heightPx * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, widthPx, heightPx);

    if (!peaks) return;

    // Map the canvas's pixel range onto the visible (trimmed) span
    // of the source file.
    const startFrac = clip.sourceDuration > 0
      ? clip.trimStart / clip.sourceDuration
      : 0;
    const endFrac = clip.sourceDuration > 0
      ? clip.trimEnd / clip.sourceDuration
      : 1;
    const startIdx = startFrac * peaks.length;
    const endIdx = endFrac * peaks.length;
    const visibleSpan = Math.max(1, endIdx - startIdx);

    const centerY = heightPx / 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';

    for (let x = 0; x < widthPx; x++) {
      const lo = Math.floor(startIdx + (x / widthPx) * visibleSpan);
      const hi = Math.max(
        lo + 1,
        Math.floor(startIdx + ((x + 1) / widthPx) * visibleSpan),
      );
      let peak = 0;
      for (let i = lo; i < hi && i < peaks.length; i++) {
        const v = peaks[i] ?? 0;
        if (v > peak) peak = v;
      }
      const half = peak * (heightPx / 2);
      // Floor of 1px so silence still draws a thin centerline rather
      // than disappearing entirely.
      const h = Math.max(1, Math.round(half * 2));
      ctx.fillRect(x, centerY - h / 2, 1, h);
    }
  }, [
    peaks,
    widthPx,
    heightPx,
    clip.trimStart,
    clip.trimEnd,
    clip.sourceDuration,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-x-0"
      style={{ top: topPx, height: heightPx, width: widthPx }}
    />
  );
}
