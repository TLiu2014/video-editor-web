import { newId } from './ids';
import {
  isImageFile,
  normalizeImageFile,
  STILL_DEFAULT_DURATION,
} from './stills';
import { useTimelineStore } from '../store/useTimelineStore';
import type { MediaAsset } from '../types/timeline';

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

/**
 * Probe a dropped / picked file and turn it into a media library
 * asset. Returns null for files that are not video, audio or an image.
 */
export async function importMediaAsset(file: File): Promise<MediaAsset | null> {
  if (isImageFile(file)) {
    const still = await normalizeImageFile(file);
    return {
      id: newId(),
      kind: 'video',
      // Keep the user's original name even when the bytes were
      // re-encoded to PNG.
      name: file.name,
      file: still,
      duration: STILL_DEFAULT_DURATION,
      hasAudio: false,
      still: true,
      importedAt: Date.now(),
    };
  }
  const kind = isVideoFile(file) ? 'video' : isAudioFile(file) ? 'audio' : null;
  if (!kind) return null;
  const { duration, hasAudio } = await probeMedia(file);
  return {
    id: newId(),
    kind,
    name: file.name,
    file,
    duration,
    hasAudio,
    importedAt: Date.now(),
  };
}

/**
 * Import many files into the current project's media library. Files
 * that fail to probe or aren't media are counted as skipped.
 */
export async function importFilesToLibrary(
  files: File[],
): Promise<{ assets: MediaAsset[]; skipped: number }> {
  const assets: MediaAsset[] = [];
  let skipped = 0;
  for (const file of files) {
    try {
      const asset = await importMediaAsset(file);
      if (asset) assets.push(asset);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  if (assets.length > 0) {
    useTimelineStore.getState().addMediaAssets(assets);
  }
  return { assets, skipped };
}
