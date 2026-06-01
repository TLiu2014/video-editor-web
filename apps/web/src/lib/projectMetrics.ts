import type { VideoClip, VideoProject } from '../types/timeline';

/**
 * Total timeline duration: the latest end-point across all clips on
 * all tracks. Empty projects return 0.
 */
export function computeProjectDuration(project: VideoProject): number {
  let max = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const end = clip.startOffset + clip.duration;
      if (end > max) max = end;
    }
  }
  return max;
}

/**
 * Find the video clip currently under the playhead, if any. Used by
 * the preview pane to decide which `<video>` source to mount.
 */
export function findActiveVideoClip(
  project: VideoProject,
  playhead: number,
): VideoClip | null {
  for (const track of project.tracks) {
    if (track.type !== 'video') continue;
    for (const clip of track.clips) {
      if (clip.kind !== 'video') continue;
      const end = clip.startOffset + clip.duration;
      if (playhead >= clip.startOffset && playhead < end) return clip;
    }
  }
  return null;
}

/**
 * End-point (in timeline seconds) of the last clip on a track. Useful
 * for appending newly-imported media without manual placement.
 */
export function trackEnd(project: VideoProject, trackId: string): number {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return 0;
  let max = 0;
  for (const clip of track.clips) {
    const end = clip.startOffset + clip.duration;
    if (end > max) max = end;
  }
  return max;
}

/**
 * Sum of unique source file sizes referenced by the project. Two clips
 * sharing the same `File` count once. Used by the export memory
 * pre-flight to estimate wasm linear-memory pressure.
 */
export function totalSourceBytes(project: VideoProject): number {
  const seen = new WeakSet<File>();
  let bytes = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (seen.has(clip.file)) continue;
      seen.add(clip.file);
      bytes += clip.file.size;
    }
  }
  return bytes;
}

export const EXPORT_MEMORY_WARN_BYTES = 1024 ** 3; // 1 GB — yellow
export const EXPORT_MEMORY_BLOCK_BYTES = 1.8 * 1024 ** 3; // 1.8 GB — red

export type MemoryRisk = 'ok' | 'warn' | 'block';

export function exportMemoryRisk(bytes: number): MemoryRisk {
  if (bytes >= EXPORT_MEMORY_BLOCK_BYTES) return 'block';
  if (bytes >= EXPORT_MEMORY_WARN_BYTES) return 'warn';
  return 'ok';
}
