import { useEffect, useState } from 'react';
import { getCachedWaveform, loadWaveform } from '../lib/waveform';

/**
 * Returns peak amplitudes for an audio file (0–1, fixed bucket count).
 * Returns `null` while the decode is in flight or has failed.
 *
 * The cache lives in `lib/waveform.ts` and is keyed by the `File`
 * instance — re-mounting this hook for the same file is free.
 */
export function useWaveform(file: File): Float32Array | null {
  const [peaks, setPeaks] = useState<Float32Array | null>(() =>
    getCachedWaveform(file),
  );

  useEffect(() => {
    const cached = getCachedWaveform(file);
    if (cached) {
      setPeaks(cached);
      return;
    }
    let cancelled = false;
    loadWaveform(file)
      .then((p) => {
        if (!cancelled) setPeaks(p);
      })
      .catch(() => {
        if (!cancelled) setPeaks(null);
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  return peaks;
}
