import type {
  AnyClip,
  MediaAsset,
  SerializedClip,
  SerializedMediaAsset,
  SerializedProject,
  SerializedTrack,
  TimelineTrack,
  VideoProject,
} from '../types/timeline';

function fileRefOf(file: File): SerializedClip['fileRef'] {
  return { name: file.name, size: file.size, type: file.type };
}

/**
 * Strip the in-memory `File` handle from a clip, leaving a JSON-safe
 * descriptor. The raw bytes are persisted separately by the storage
 * layer (keyed by the clip's `mediaId`) and re-attached on load.
 */
export function serializeClip(clip: AnyClip): SerializedClip {
  const { file, ...rest } = clip;
  return { ...rest, fileRef: fileRefOf(file) };
}

export function serializeMediaAsset(asset: MediaAsset): SerializedMediaAsset {
  const { file, ...rest } = asset;
  return { ...rest, fileRef: fileRefOf(file) };
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
    media: project.media.map(serializeMediaAsset),
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
  source: Blob | File,
): AnyClip {
  const { fileRef, ...rest } = serialized;
  const file =
    source instanceof File
      ? source
      : new File([source], fileRef.name, { type: fileRef.type });
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

/** Resolves a storage key (asset id, or clip id for legacy data) to bytes. */
export type BlobLoader = (
  key: string,
) => Promise<Blob | undefined> | Blob | undefined;

/**
 * Rebuild a live `VideoProject` from its serialized form, loading each
 * media asset's bytes once and sharing the resulting `File` across
 * every clip that uses it.
 *
 * Legacy projects (saved before the media library existed) have no
 * `media` array and store bytes per clip id. They are migrated here:
 * clips with the same `fileRef` collapse into one asset whose id is
 * the first such clip's id — which is exactly the key its bytes are
 * already stored under, so no blob has to be rewritten. The now
 * unused per-clip copies become orphans for `cleanupOrphanedBlobs`.
 */
export async function rehydrateProject(
  serialized: SerializedProject,
  loadBlob: BlobLoader,
): Promise<VideoProject> {
  const media: MediaAsset[] = [];
  const fileByMediaId = new Map<string, File>();

  const requireBlob = async (key: string, what: string): Promise<Blob> => {
    const blob = await loadBlob(key);
    if (!blob) {
      throw new Error(`missing media bytes for ${what} (${key})`);
    }
    return blob;
  };

  if (serialized.media) {
    for (const s of serialized.media) {
      const { fileRef, ...rest } = s;
      const blob = await requireBlob(s.id, `"${fileRef.name}"`);
      const file = new File([blob], fileRef.name, { type: fileRef.type });
      fileByMediaId.set(s.id, file);
      media.push({ ...rest, file });
    }
  }

  // Legacy migration: one asset per distinct source file.
  const legacyAssetByRef = new Map<string, MediaAsset>();
  const tracks: TimelineTrack[] = [];
  for (const track of serialized.tracks) {
    const clips: AnyClip[] = [];
    for (const sclip of track.clips) {
      const known = sclip.mediaId ? fileByMediaId.get(sclip.mediaId) : undefined;
      if (known) {
        clips.push(rehydrateClip(sclip, known));
        continue;
      }
      const refKey = `${sclip.kind}|${sclip.fileRef.name}|${sclip.fileRef.size}|${sclip.fileRef.type}`;
      let asset = legacyAssetByRef.get(refKey);
      if (!asset) {
        const blob = await requireBlob(sclip.id, `clip "${sclip.name}"`);
        const file = new File([blob], sclip.fileRef.name, {
          type: sclip.fileRef.type,
        });
        asset = {
          id: sclip.id,
          kind: sclip.kind,
          name: sclip.fileRef.name,
          file,
          duration:
            typeof sclip.sourceDuration === 'number'
              ? sclip.sourceDuration
              : sclip.trimEnd,
          hasAudio: sclip.kind === 'audio' || sclip.hasAudio !== false,
          importedAt: 0,
        };
        legacyAssetByRef.set(refKey, asset);
        fileByMediaId.set(asset.id, file);
        media.push(asset);
      }
      clips.push(
        rehydrateClip({ ...sclip, mediaId: asset.id }, asset.file),
      );
    }
    tracks.push({ ...track, clips });
  }

  return {
    ...serialized,
    // Backfill project-level settings for projects persisted before
    // these fields existed.
    frameRate:
      typeof serialized.frameRate === 'number' ? serialized.frameRate : 30,
    audioSampleRate:
      typeof serialized.audioSampleRate === 'number'
        ? serialized.audioSampleRate
        : 48000,
    tracks,
    media,
  };
}
