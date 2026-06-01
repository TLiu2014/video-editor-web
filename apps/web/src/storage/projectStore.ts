import { createStore, del, get, keys, set } from 'idb-keyval';
import {
  rehydrateClip,
  serializeProject,
} from '../serialization/project';
import type {
  ProjectId,
  SerializedProject,
  TimelineTrack,
  VideoProject,
} from '../types/timeline';

/**
 * IndexedDB persistence for projects.
 *
 * Two object stores live inside the same database:
 *  - `projects` keys `ProjectId -> SerializedProject` (JSON-safe metadata).
 *  - `blobs`    keys `ClipId    -> Blob`              (raw media bytes).
 *
 * Splitting metadata and bytes lets us rewrite the project JSON cheaply on
 * every edit without rewriting any media. Listing projects is also a fast
 * scan over just the metadata store.
 *
 * Deleting a project does NOT cascade-delete its blobs. Blobs may be
 * shared between projects (e.g., a duplicate), and they are expensive to
 * re-import. Use `cleanupOrphanedBlobs()` periodically to reclaim space.
 */

const DB_NAME = 'video-editor-web';
const projectsStore = createStore(DB_NAME, 'projects');
const blobsStore = createStore(DB_NAME, 'blobs');

export interface ProjectListEntry {
  id: ProjectId;
  name: string;
}

async function blobExists(id: string): Promise<boolean> {
  return (await get<Blob>(id, blobsStore)) !== undefined;
}

export async function saveProject(project: VideoProject): Promise<void> {
  const blobWrites = project.tracks.flatMap((track) =>
    track.clips.map(async (clip) => {
      if (!(await blobExists(clip.id))) {
        await set(clip.id, clip.file, blobsStore);
      }
    }),
  );
  await Promise.all(blobWrites);
  await set(project.id, serializeProject(project), projectsStore);
}

export async function loadProject(
  id: ProjectId,
): Promise<VideoProject | null> {
  const serialized = await get<SerializedProject>(id, projectsStore);
  if (!serialized) return null;

  const tracks: TimelineTrack[] = await Promise.all(
    serialized.tracks.map(async (track) => ({
      ...track,
      clips: await Promise.all(
        track.clips.map(async (clip) => {
          const blob = await get<Blob>(clip.id, blobsStore);
          if (!blob) {
            throw new Error(
              `missing blob for clip ${clip.id} in project ${id}`,
            );
          }
          return rehydrateClip(clip, blob);
        }),
      ),
    })),
  );

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
  };
}

export async function listProjects(): Promise<ProjectListEntry[]> {
  const ids = (await keys(projectsStore)) as ProjectId[];
  const entries = await Promise.all(
    ids.map(async (id) => {
      const project = await get<SerializedProject>(id, projectsStore);
      return project ? { id: project.id, name: project.name } : null;
    }),
  );
  return entries.filter((e): e is ProjectListEntry => e !== null);
}

export async function deleteProject(id: ProjectId): Promise<void> {
  await del(id, projectsStore);
}

/**
 * Walk every saved project, collect referenced clip ids, and delete any
 * blobs not referenced by at least one project. Returns the count.
 */
export async function cleanupOrphanedBlobs(): Promise<number> {
  const projectIds = (await keys(projectsStore)) as ProjectId[];
  const referenced = new Set<string>();
  for (const pid of projectIds) {
    const project = await get<SerializedProject>(pid, projectsStore);
    if (!project) continue;
    for (const track of project.tracks) {
      for (const clip of track.clips) referenced.add(clip.id);
    }
  }

  const blobIds = (await keys(blobsStore)) as string[];
  let deleted = 0;
  for (const id of blobIds) {
    if (!referenced.has(id)) {
      await del(id, blobsStore);
      deleted++;
    }
  }
  return deleted;
}
