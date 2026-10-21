import { describe, expect, it } from 'vitest';
import type { SerializedProject } from '../types/timeline';
import { rehydrateProject, serializeProject } from './project';

const ref = { name: 'a.mp4', size: 3, type: 'video/mp4' };

function legacyClip(id: string, startOffset: number, trimStart: number) {
  return {
    id,
    kind: 'video' as const,
    name: 'a.mp4',
    startOffset,
    trimStart,
    trimEnd: trimStart + 2,
    duration: 2,
    sourceDuration: 10,
    fadeIn: 0,
    fadeOut: 0,
    hasAudio: true,
    trackId: 'v1',
    fileRef: ref,
  };
}

/** A project saved before the media library: no `media`, blobs per clip id. */
const legacy: SerializedProject = {
  id: 'p',
  name: 'Old',
  resolution: { width: 1920, height: 1080 },
  frameRate: 30,
  audioSampleRate: 48000,
  overlays: [],
  tracks: [
    { id: 'v1', type: 'video', clips: [legacyClip('c1', 0, 0), legacyClip('c2', 2, 2)] },
    { id: 'a1', type: 'audio', clips: [] },
  ],
};

describe('rehydrateProject', () => {
  it('migrates legacy per-clip blobs into one shared asset', async () => {
    const requested: string[] = [];
    const project = await rehydrateProject(legacy, (key) => {
      requested.push(key);
      return new Blob(['abc']);
    });
    // Only the first clip's blob is read; its id becomes the asset id.
    expect(requested).toEqual(['c1']);
    expect(project.media).toHaveLength(1);
    expect(project.media[0]).toMatchObject({ id: 'c1', kind: 'video', duration: 10 });
    const clips = project.tracks[0]?.clips ?? [];
    expect(clips.map((c) => c.mediaId)).toEqual(['c1', 'c1']);
    // Both clips share the same File, so export dedupes the input.
    expect(clips[0]?.file).toBe(clips[1]?.file);
  });

  it('round-trips a library project, loading each asset once', async () => {
    const migrated = await rehydrateProject(legacy, () => new Blob(['abc']));
    const serialized = serializeProject(migrated);
    expect(serialized.media?.[0]?.fileRef).toEqual(ref);

    const requested: string[] = [];
    const again = await rehydrateProject(serialized, (key) => {
      requested.push(key);
      return new Blob(['abc']);
    });
    expect(requested).toEqual(['c1']);
    expect(again.tracks[0]?.clips.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('fails loudly when bytes are missing', async () => {
    await expect(rehydrateProject(legacy, () => undefined)).rejects.toThrow(/missing media/);
  });
});
