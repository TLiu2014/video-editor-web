import { useEffect } from 'react';
import {
  isHistoryPushSuppressed,
  useHistoryStore,
} from '../store/useHistoryStore';
import { useTimelineStore } from '../store/useTimelineStore';

/**
 * Subscribes to `currentProject` ref changes and pushes the
 * *previous* project value onto the history stack — so calling
 * `undo()` restores what was there before the mutation.
 *
 * Skipped when:
 *   - the suppression flag is set (an in-flight undo/redo applying
 *     a history entry back to the timeline)
 *   - the project's `id` changed (createProject / loadProject — a
 *     different document, not an edit)
 *   - the previous value was null (initial load)
 *
 * Also clears history when a project is closed or replaced.
 */
export function useHistoryEngine(): void {
  useEffect(() => {
    // Track the marks from BEFORE the latest mutation so we can
    // push them alongside the prior project. Actions like
    // trimToRange / deleteRange clear marks in the same set() call
    // as the project mutation, so reading the post-mutation state
    // here would lose them. We initialize from the current state
    // and update on every project change.
    const initial = useTimelineStore.getState();
    let lastMarks = {
      inPoint: initial.inPoint,
      outPoint: initial.outPoint,
    };
    // Also track non-project state changes so a Mark In/Mark Out
    // (which doesn't change the project) still updates lastMarks.
    const unsubMarks = useTimelineStore.subscribe(
      (s) => `${s.inPoint ?? 'n'}|${s.outPoint ?? 'n'}`,
      () => {
        const s = useTimelineStore.getState();
        lastMarks = { inPoint: s.inPoint, outPoint: s.outPoint };
      },
    );
    const unsubProject = useTimelineStore.subscribe(
      (s) => s.currentProject,
      (curr, prev) => {
        if (isHistoryPushSuppressed()) return;
        if (curr === prev) return;
        if (!prev) return; // initial load — nothing to record
        if (!curr || curr.id !== prev.id) {
          // Project switch (or close): drop history so the new
          // document doesn't inherit undo into a different project.
          useHistoryStore.getState().clear();
          return;
        }
        useHistoryStore.getState().push(prev, lastMarks);
        // Refresh lastMarks AFTER the push, so the next project
        // mutation sees the marks as they stand post-this-edit.
        const s = useTimelineStore.getState();
        lastMarks = { inPoint: s.inPoint, outPoint: s.outPoint };
      },
    );
    return () => {
      unsubMarks();
      unsubProject();
    };
  }, []);
}
