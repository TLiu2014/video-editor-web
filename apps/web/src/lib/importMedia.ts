import { newId } from './ids';
import type { AudioClip, TrackId, VideoClip } from '../types/timeline';

interface MediaProbe {
  duration: number;
  hasAudio: boolean;
}

// Vendor-specific properties we sniff to decide whether a video file
// has an audio stream. These aren't part of HTMLMediaElement's TS
// types so we declare a narrow shape for them.
type WithAudioFlags = HTMLMediaElement & {
  mozHasAudio?: boolean;
  webkitAudioDecodedByteCount?: number;
  audioTracks?: { length: number };
};

function detectAudioPresence(el: WithAudioFlags): boolean | null {
  if (typeof el.mozHasAudio === 'boolean') return el.mozHasAudio;
  if (el.audioTracks && typeof el.audioTracks.length === 'number') {
    // 0 here is meaningful — Safari populates this reliably.
    return el.audioTracks.length > 0;
  }
  if (typeof el.webkitAudioDecodedByteCount === 'number') {
    if (el.webkitAudioDecodedByteCount > 0) return true;
    // The counter only advances during actual decode. Caller may try a
    // muted play() first; if it's still zero after that, we treat as
    // unknown (return null) rather than misreport as `false`.
    return null;
  }
  return null;
}

/**
 * Probe a media file for its duration and (for video) the presence of
 * an audio stream. Detection is best-effort: we feature-detect a
 * handful of vendor-specific flags and fall back to assuming audio
 * exists. Misdetection here only matters at export time; preview
 * playback isn't affected.
 */
async function probeMedia(file: File): Promise<MediaProbe> {
  const isAudio = file.type.startsWith('audio/');
  const url = URL.createObjectURL(file);
  const el = document.createElement(
    isAudio ? 'audio' : 'video',
  ) as WithAudioFlags;
  el.preload = 'auto';
  el.muted = true;
  el.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`failed to read metadata for "${file.name}"`));
      };
      const cleanup = () => {
        el.removeEventListener('loadeddata', onLoaded);
        el.removeEventListener('error', onError);
      };
      el.addEventListener('loadeddata', onLoaded);
      el.addEventListener('error', onError);
    });

    const duration = Number.isFinite(el.duration) ? el.duration : 0;

    if (isAudio) {
      return { duration, hasAudio: true };
    }

    let detected = detectAudioPresence(el);
    if (detected === null) {
      // Try a brief muted play to populate webkitAudioDecodedByteCount.
      try {
        await el.play();
        await new Promise((r) => setTimeout(r, 80));
        el.pause();
        detected = detectAudioPresence(el);
      } catch {
        // Autoplay rejection — fall through to default.
      }
    }
    // Unknown → assume audio is present. Optimistic default matches
    // user expectations for camera/phone footage.
    return { duration, hasAudio: detected ?? true };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/');
}

export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/');
}

export async function importVideoFile(
  file: File,
  trackId: TrackId,
  startOffset: number,
): Promise<VideoClip> {
  const { duration, hasAudio } = await probeMedia(file);
  return {
    id: newId(),
    kind: 'video',
    name: file.name,
    file,
    startOffset,
    trimStart: 0,
    trimEnd: duration,
    duration,
    sourceDuration: duration,
    hasAudio,
    fadeIn: 0,
    fadeOut: 0,
    trackId,
  };
}

export async function importAudioFile(
  file: File,
  trackId: TrackId,
  startOffset: number,
): Promise<AudioClip> {
  const { duration } = await probeMedia(file);
  return {
    id: newId(),
    kind: 'audio',
    name: file.name,
    file,
    startOffset,
    trimStart: 0,
    trimEnd: duration,
    duration,
    sourceDuration: duration,
    fadeIn: 0,
    fadeOut: 0,
    trackId,
    volume: 1,
  };
}
