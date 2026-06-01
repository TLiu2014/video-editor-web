import { unzip, zip, type Unzipped } from 'fflate';
import { newId } from './ids';
import {
  rehydrateClip,
  serializeProject,
} from '../serialization/project';
import type {
  SerializedProject,
  VideoProject,
} from '../types/timeline';

/**
 * Pack a `VideoProject` into a single `.zip` blob containing the
 * serialized metadata plus every clip's raw media bytes.
 *
 * Layout:
 *   project.json                # SerializedProject (JSON-safe)
 *   media/<clipId>.bin           # raw bytes of clip.file
 *
 * Each clip's bytes are written under its own id so import can
 * reattach them without resolving by content hash. Splits of the
 * same source File produce duplicate entries — wasteful but
 * straightforward; matches how IDB persistence stores them too.
 *
 * Uses fflate's level-0 (stored) compression because video/audio
 * payloads are already compressed by their codec; further deflate
 * usually adds time without shrinking the file.
 */
const MANIFEST_FILE = 'project.json';
const MEDIA_DIR = 'media';

export async function exportProjectAsZip(
  project: VideoProject,
): Promise<Blob> {
  const serialized = serializeProject(project);
  const manifest = new TextEncoder().encode(
    JSON.stringify(serialized, null, 2),
  );

  const inputs: Record<string, Uint8Array> = {
    [MANIFEST_FILE]: manifest,
  };

  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const buf = await clip.file.arrayBuffer();
      inputs[`${MEDIA_DIR}/${clip.id}.bin`] = new Uint8Array(buf);
    }
  }

  const data = await new Promise<Uint8Array>((resolve, reject) => {
    zip(inputs, { level: 0 }, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });
  return new Blob([data as BlobPart], { type: 'application/zip' });
}

/**
 * Unpack a `.zip` produced by `exportProjectAsZip` and rebuild a
 * `VideoProject` with live `File` references. The project gets a
 * fresh id so importing into a browser that already has the same
 * project doesn't silently overwrite local state.
 */
export async function importProjectFromZip(
  archive: File,
): Promise<VideoProject> {
  const buf = new Uint8Array(await archive.arrayBuffer());
  const unzipped = await new Promise<Unzipped>((resolve, reject) => {
    unzip(buf, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  const manifestBytes = unzipped[MANIFEST_FILE];
  if (!manifestBytes) {
    throw new Error(`Archive missing ${MANIFEST_FILE}.`);
  }
  const manifest = JSON.parse(
    new TextDecoder().decode(manifestBytes as Uint8Array),
  ) as SerializedProject;

  const tracks = manifest.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((sclip) => {
      const path = `${MEDIA_DIR}/${sclip.id}.bin`;
      const bytes = unzipped[path];
      if (!bytes) {
        throw new Error(`Archive missing media file: ${path}`);
      }
      const blob = new Blob([bytes as BlobPart], {
        type: sclip.fileRef.type || 'application/octet-stream',
      });
      return rehydrateClip(sclip, blob);
    }),
  }));

  return {
    ...manifest,
    // New id so the import doesn't silently overwrite an existing
    // saved project with the same id. The user can rename freely.
    id: newId(),
    name: manifest.name || 'Imported Project',
    frameRate:
      typeof manifest.frameRate === 'number' ? manifest.frameRate : 30,
    audioSampleRate:
      typeof manifest.audioSampleRate === 'number'
        ? manifest.audioSampleRate
        : 48000,
    tracks,
  };
}
