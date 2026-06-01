/**
 * Compute and cache normalized peak amplitudes for an audio file.
 *
 * Decoding is done via `OfflineAudioContext.decodeAudioData`, which
 * doesn't require a user gesture and handles every codec the
 * browser natively supports (mp3, m4a/aac, wav, ogg, flac, webm).
 *
 * Peaks are computed as the per-bucket max of `abs(sample)` so the
 * resulting waveform reflects loudness regardless of bit depth or
 * waveform polarity. The bucket count (`PEAK_COUNT`) is fixed so a
 * single decode produces a reusable peak set the canvas renderer
 * can downsample to any width.
 *
 * Cache key: the `File` instance itself, via WeakMap. Splitting a
 * clip preserves the source `File` reference, so split halves share
 * one waveform entry and we don't re-decode.
 */

const PEAK_COUNT = 4096;

type CacheValue = Float32Array | Promise<Float32Array>;
const cache = new WeakMap<File, CacheValue>();

export function getCachedWaveform(file: File): Float32Array | null {
  const entry = cache.get(file);
  return entry instanceof Float32Array ? entry : null;
}

export async function loadWaveform(file: File): Promise<Float32Array> {
  const existing = cache.get(file);
  if (existing instanceof Float32Array) return existing;
  if (existing instanceof Promise) return existing;

  const promise = decodeAndComputePeaks(file);
  cache.set(file, promise);
  try {
    const peaks = await promise;
    cache.set(file, peaks);
    return peaks;
  } catch (err) {
    // Drop the failed promise so a subsequent call retries.
    cache.delete(file);
    throw err;
  }
}

async function decodeAndComputePeaks(file: File): Promise<Float32Array> {
  type Win = typeof window & {
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  };
  const Ctor =
    window.OfflineAudioContext ?? (window as Win).webkitOfflineAudioContext;
  if (!Ctor) {
    throw new Error('OfflineAudioContext is not available in this browser.');
  }
  // Construct a minimal context — we only need it to decode, not to
  // render. The shape (1ch, 1 sample, 44.1kHz) is small but valid.
  const ctx = new Ctor(1, 1, 44100);
  const buffer = await file.arrayBuffer();
  const audio = await ctx.decodeAudioData(buffer);

  // Average across channels so stereo files don't look stacked. For
  // mono we just read channel 0.
  const channelCount = audio.numberOfChannels;
  const len = audio.length;
  const peaks = new Float32Array(PEAK_COUNT);
  const samplesPerBucket = Math.max(1, Math.floor(len / PEAK_COUNT));

  // Reading channel data into a Float32Array up-front is faster than
  // calling getChannelData per-sample inside the loop.
  const channels: Float32Array[] = [];
  for (let c = 0; c < channelCount; c++) channels.push(audio.getChannelData(c));

  for (let bucket = 0; bucket < PEAK_COUNT; bucket++) {
    const start = bucket * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, len);
    let max = 0;
    for (let i = start; i < end; i++) {
      let sum = 0;
      for (let c = 0; c < channelCount; c++) {
        sum += Math.abs(channels[c]?.[i] ?? 0);
      }
      const avg = sum / channelCount;
      if (avg > max) max = avg;
    }
    peaks[bucket] = max;
  }
  return peaks;
}
