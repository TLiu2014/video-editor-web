import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteProject as deleteFromIDB,
  listProjects as listFromIDB,
  loadProject as loadFromIDB,
  saveProject as saveToIDB,
  type ProjectListEntry,
} from '../storage/projectStore';
import { useTimelineStore } from '../store/useTimelineStore';
import type { ProjectId, VideoProject } from '../types/timeline';

export interface UseProjectPersistenceOptions {
  /** Auto-save `currentProject` when it changes. Default true. */
  autoSave?: boolean;
  /** Debounce window for auto-saves, in milliseconds. Default 750. */
  debounceMs?: number;
}

export interface UseProjectPersistenceResult {
  isSaving: boolean;
  lastSavedAt: number | null;
  /** Flush any pending debounced save and wait for the write to finish. */
  saveNow: () => Promise<void>;
  /** Load a project from IDB and install it into the store. */
  openProject: (id: ProjectId) => Promise<boolean>;
  removeProject: (id: ProjectId) => Promise<void>;
  listProjects: () => Promise<ProjectListEntry[]>;
}

/**
 * Auto-saves the current project to IndexedDB on every meaningful edit,
 * debounced so rapid mutations (e.g., drag-to-trim) collapse into a
 * single write.
 *
 * The subscription is keyed to `currentProject` reference identity — all
 * store actions clone the project on mutation, so reference equality is a
 * cheap and accurate dirty bit. Playhead updates do NOT change
 * `currentProject` and therefore do NOT trigger saves, keeping the
 * 60fps scrub path off the IDB hot path.
 */
export function useProjectPersistence(
  options: UseProjectPersistenceOptions = {},
): UseProjectPersistenceResult {
  const { autoSave = true, debounceMs = 750 } = options;

  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const flush = useCallback(async (project: VideoProject) => {
    // Serialize concurrent writes — IDB tolerates parallelism, but
    // ordering matters: the last write should reflect the last edit.
    const prior = inFlightRef.current ?? Promise.resolve();
    const next = (async () => {
      await prior;
      setIsSaving(true);
      try {
        await saveToIDB(project);
        setLastSavedAt(Date.now());
      } finally {
        setIsSaving(false);
      }
    })();
    inFlightRef.current = next;
    try {
      await next;
    } finally {
      if (inFlightRef.current === next) inFlightRef.current = null;
    }
  }, []);

  const saveNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const project = useTimelineStore.getState().currentProject;
    if (!project) return;
    await flush(project);
  }, [flush]);

  useEffect(() => {
    if (!autoSave) return;
    const unsubscribe = useTimelineStore.subscribe(
      (state) => state.currentProject,
      (project) => {
        if (!project) return;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          void flush(project);
        }, debounceMs);
      },
    );
    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [autoSave, debounceMs, flush]);

  const openProject = useCallback(
    async (id: ProjectId): Promise<boolean> => {
      const project = await loadFromIDB(id);
      if (!project) return false;
      useTimelineStore.getState().loadProject(project);
      return true;
    },
    [],
  );

  const removeProject = useCallback(
    (id: ProjectId) => deleteFromIDB(id),
    [],
  );

  const listProjects = useCallback(() => listFromIDB(), []);

  return {
    isSaving,
    lastSavedAt,
    saveNow,
    openProject,
    removeProject,
    listProjects,
  };
}
