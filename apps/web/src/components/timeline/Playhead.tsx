import { useCallback, useEffect, useRef } from 'react';
import {
  chooseMajorInterval,
  collectSnapTargets,
  findNearestTarget,
} from '../../lib/snapping';
import {
  getPixelsPerSecond,
  useTimelineViewStore,
} from '../../store/useTimelineViewStore';
import { useTimelineStore } from '../../store/useTimelineStore';
import { SNAP_THRESHOLD_PX } from './constants';

/**
 * The playhead is the single 60fps-hot DOM node in the app. To keep
 * it smooth during scrubbing and playback, we subscribe imperatively
 * to `playheadPosition` and write `transform: translateX(...)`
 * directly. React reconciliation never runs for these updates.
 *
 * We additionally re-apply on zoom changes — when the view store's
 * `zoomLevel` shifts, pixels-per-second changes, and the playhead
 * needs to reposition without a React render path either.
 *
 * `will-change: transform` hints the compositor to promote this
 * element to its own layer so transforms are applied on the GPU.
 *
 * The diamond handle is its own pointer-events-auto layer so users
 * can grab the playhead directly — without it the only way to scrub
 * is to click somewhere else in the ruler row, which is awkward when
 * the playhead is parked at t=0 (its line is flush against the
 * scroll container's left edge).
 */
export function Playhead({ totalHeight }: { totalHeight: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    rectLeft: number;
    pps: number;
  } | null>(null);

  useEffect(() => {
    const apply = (pos: number) => {
      const el = ref.current;
      if (!el) return;
      el.style.transform = `translate3d(${pos * getPixelsPerSecond()}px, 0, 0)`;
    };
    apply(useTimelineStore.getState().playheadPosition);
    const unsubPlayhead = useTimelineStore.subscribe(
      (s) => s.playheadPosition,
      apply,
    );
    const unsubZoom = useTimelineViewStore.subscribe(
      (s) => s.zoomLevel,
      () => apply(useTimelineStore.getState().playheadPosition),
    );
    return () => {
      unsubPlayhead();
      unsubZoom();
    };
  }, []);

  const seekTo = useCallback((clientX: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const x = Math.max(0, clientX - drag.rectLeft);
    const raw = x / drag.pps;
    const project = useTimelineStore.getState().currentProject;
    const targets = project
      ? collectSnapTargets(project, {
          gridInterval: chooseMajorInterval(drag.pps),
          gridLimitSec: 3600,
        })
      : [0];
    const snap = findNearestTarget(raw, targets, SNAP_THRESHOLD_PX / drag.pps);
    const target = snap ?? raw;
    useTimelineStore.getState().updatePlayhead(target);
    useTimelineViewStore.getState().setSnapPosition(snap);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    // Find the timeline scroll surface (the `.relative` div that
    // wraps the ruler, tracks, and playhead) so coordinates are
    // measured against the same reference the ruler uses.
    const surface = e.currentTarget.closest(
      '[data-timeline-surface]',
    ) as HTMLElement | null;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    dragRef.current = { rectLeft: rect.left, pps: getPixelsPerSecond() };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    seekTo(e.clientX);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    useTimelineViewStore.getState().setSnapPosition(null);
  };

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute left-0 top-0 z-20 w-px bg-playhead shadow-[0_0_6px_rgba(239,68,68,0.6)]"
      style={{ height: totalHeight, willChange: 'transform' }}
    >
      {/* Grab handle. Wider than the diamond so the user has a real
          hit target, and pointer-events-auto so it overrides the
          parent's none. cursor-ew-resize signals draggability. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="pointer-events-auto absolute -left-[12px] -top-[4px] flex h-6 w-[25px] cursor-ew-resize items-start justify-center"
        title="Drag to scrub"
      >
        <div className="size-[15px] rotate-45 rounded-sm bg-playhead shadow-md" />
      </div>
    </div>
  );
}
