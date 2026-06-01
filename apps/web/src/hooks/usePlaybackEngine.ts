import { useEffect } from 'react';
import { computeProjectDuration } from '../lib/projectMetrics';
import { useTimelineStore } from '../store/useTimelineStore';

/**
 * Drives the playhead forward at wall-clock speed when `isPlaying` is
 * true. A single requestAnimationFrame loop owns the increment; the
 * preview pane reads the playhead value imperatively to keep its
 * `<video>` element seeked.
 *
 * Why RAF over the video element's own clock: a project can contain
 * gaps and multiple clips on different tracks. No single media element
 * represents the timeline's wall-clock cleanly, so we use a unified
 * 60Hz tick and let each consumer (preview, timeline) sync against it.
 *
 * Mount this hook exactly once at the app root.
 */
export function usePlaybackEngine(): void {
  useEffect(() => {
    let raf: number | null = null;
    let lastTime = 0;

    const tick = (now: number) => {
      const state = useTimelineStore.getState();
      const project = state.currentProject;
      if (!project) {
        state.setPlaying(false);
        raf = null;
        return;
      }
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const total = computeProjectDuration(project);
      const next = state.playheadPosition + dt;
      if (next >= total) {
        state.updatePlayhead(total);
        state.setPlaying(false);
        raf = null;
        return;
      }
      state.updatePlayhead(next);
      raf = requestAnimationFrame(tick);
    };

    const unsubscribe = useTimelineStore.subscribe(
      (s) => s.isPlaying,
      (isPlaying) => {
        if (raf !== null) {
          cancelAnimationFrame(raf);
          raf = null;
        }
        if (!isPlaying) return;
        const state = useTimelineStore.getState();
        const project = state.currentProject;
        if (!project) {
          state.setPlaying(false);
          return;
        }
        // Hitting play at the very end rewinds to 0 — otherwise the next
        // tick would clamp instantly and the user would think play
        // didn't fire.
        const total = computeProjectDuration(project);
        if (state.playheadPosition >= total) state.updatePlayhead(0);
        lastTime = performance.now();
        raf = requestAnimationFrame(tick);
      },
    );

    return () => {
      unsubscribe();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);
}
