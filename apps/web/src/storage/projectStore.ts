import {
  del,
  get,
  keys,
  promisifyRequest,
  set,
  type UseStore,
} from 'idb-keyval';
import {
  rehydrateProject,
  serializeProject,
} from '../serialization/project';
import type {
  ProjectId,
  SerializedProject,
  VideoProject,
} from '../types/timeline';

/**
 * IndexedDB persistence for projects.
 *
 * Two object stores live inside the same database:
 *  - `projects` keys `ProjectId -> SerializedProject` (JSON-safe metadata).
 *  - `blobs`    keys `MediaId   -> Blob`              (raw media bytes, one
 *                                                     per library asset; legacy
 *                                                     projects keyed them by
 *                                                     ClipId — see rehydrateProject).
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
const STORE_NAMES = ['projects', 'blobs'] as const;
/**
 * v1 was created by two `idb-keyval` `createStore()` calls on the same
 * database. That helper only creates its store when the database is
 * first created, so whichever call ran second never got its store and
 * every save failed with "object store not found". v2 opens the
 * database once and creates whichever stores are missing.
 */
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      for (const name of STORE_NAMES) {
        if (!request.result.objectStoreNames.contains(name)) {
          request.result.createObjectStore(name);
        }
      }
    };
    dbPromise = promisifyRequest(request);
  }
  return dbPromise;
}

/** An `idb-keyval` store bound to one object store of the shared database. */
function storeOf(name: (typeof STORE_NAMES)[number]): UseStore {
  return (txMode, callback) =>
    openDb().then((db) =>
      callback(db.transaction(name, txMode).objectStore(name)),
    );
}

const projectsStore = storeOf('projects');
const blobsStore = storeOf('blobs');

export interface ProjectListEntry {
  id: ProjectId;
  name: string;
}

async function blobExists(id: string): Promise<boolean> {
  return (await get<Blob>(id, blobsStore)) !== undefined;
}

export async function saveProject(project: VideoProject): Promise<void> {
  // One blob per library asset — splits and duplicates of a clip
  // share their asset's bytes instead of each storing a copy.
  await Promise.all(
    project.media.map(async (asset) => {
      if (!(await blobExists(asset.id))) {
        await set(asset.id, asset.file, blobsStore);
      }
    }),
  );
  await set(project.id, serializeProject(project), projectsStore);
}

export async function loadProject(
  id: ProjectId,
): Promise<VideoProject | null> {
  const serialized = await get<SerializedProject>(id, projectsStore);
  if (!serialized) return null;
  return rehydrateProject(serialized, (key) => get<Blob>(key, blobsStore));
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
 * Walk every saved project, collect referenced blob keys (asset ids, plus
 * clip ids for not-yet-migrated legacy projects), and delete any blob not
 * referenced by at least one project. Returns the count.
 */
export async function cleanupOrphanedBlobs(): Promise<number> {
  const projectIds = (await keys(projectsStore)) as ProjectId[];
  const referenced = new Set<string>();
  for (const pid of projectIds) {
    const project = await get<SerializedProject>(pid, projectsStore);
    if (!project) continue;
    if (project.media) {
      for (const asset of project.media) referenced.add(asset.id);
    } else {
      for (const track of project.tracks) {
        for (const clip of track.clips) referenced.add(clip.id);
      }
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
