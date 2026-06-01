import type {
  AnyClip,
  SerializedClip,
  SerializedProject,
  SerializedTrack,
  VideoProject,
} from '../types/timeline';

/**
 * Strip the in-memory `File` handle from a clip, leaving a JSON-safe
 * descriptor. The raw bytes are persisted separately by the storage
 * layer and re-attached by `rehydrateClip` on load.
 */
export function serializeClip(clip: AnyClip): SerializedClip {
  const { file, ...rest } = clip;
  return {
    ...rest,
    fileRef: { name: file.name, size: file.size, type: file.type },
  };
}

export function serializeProject(project: VideoProject): SerializedProject {
  return {
    ...project,
    tracks: project.tracks.map(
      (track): SerializedTrack => ({
        ...track,
        clips: track.clips.map(serializeClip),
      }),
    ),
  };
}

/**
 * Reattach a Blob loaded from storage onto a serialized clip. The
 * discriminant (`kind`) flows through the spread, so this returns a
 * structurally valid `VideoClip` or `AudioClip`.
 *
 * Backfills `sourceDuration` (← trimEnd), `hasAudio` (← true), and
 * `fadeIn`/`fadeOut` (← 0) for projects persisted before those
 * fields existed.
 */
export function rehydrateClip(
  serialized: SerializedClip,
  blob: Blob,
): AnyClip {
  const { fileRef, ...rest } = serialized;
  const file = new File([blob], fileRef.name, { type: fileRef.type });
  const clip = { ...rest, file } as AnyClip;
  if (typeof clip.sourceDuration !== 'number') {
    clip.sourceDuration = clip.trimEnd;
  }
  if (clip.kind === 'video' && typeof clip.hasAudio !== 'boolean') {
    clip.hasAudio = true;
  }
  if (typeof clip.fadeIn !== 'number') clip.fadeIn = 0;
  if (typeof clip.fadeOut !== 'number') clip.fadeOut = 0;
  return clip;
}
