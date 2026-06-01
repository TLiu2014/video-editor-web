import { useCallback, useEffect, useRef } from 'react';
import {
  chooseMajorInterval,
  collectSnapTargets,
  findNearestTarget,
} from '../../lib/snapping';
import { useTimelineStore } from '../../store/useTimelineStore';
import {
  getPixelsPerSecond,
  usePixelsPerSecond,
  useTimelineViewStore,
} from '../../store/useTimelineViewStore';
import { SNAP_THRESHOLD_PX } from './constants';

/**
 * In- and out-point range markers. Both can be set independently
 * (a half-range still defines "drop everything before/after this
 * point"), drag along the timeline with snapping, and render as a
 * tinted band between them.
 *
 * Geometry mirrors the playhead — vertical line + bracket handle
 * pinned to the ruler. Each marker is its own React subtree so
 * dragging one doesn't re-render the other.
 */
export function InOutMarkers({ totalHeight }: { totalHeight: number }) {
  const inPoint = useTimelineStore((s) => s.inPoint);
  const outPoint = useTimelineStore((s) => s.outPoint);
  const pps = usePixelsPerSecond();

  if (inPoint === null && outPoint === null) return null;

  // Range band: only render when both endpoints are set. With one
  // open end the band would stretch indefinitely, which is
  // visually noisy — the lone marker alone communicates intent.
  const showBand = inPoint !== null && outPoint !== null;
  const bandLeft = inPoint !== null ? inPoint * pps : 0;
  const bandWidth =
    inPoint !== null && outPoint !== null
      ? (outPoint - inPoint) * pps
      : 0;

  return (
    <>
      {showBand ? (
        <div
          className="pointer-events-none absolute top-0 z-10 bg-accent/10"
          style={{ left: bandLeft, width: bandWidth, height: totalHeight }}
        />
      ) : null}
      {inPoint !== null ? (
        <RangeMarker kind="in" position={inPoint} totalHeight={totalHeight} />
      ) : null}
      {outPoint !== null ? (
        <RangeMarker kind="out" position={outPoint} totalHeight={totalHeight} />
      ) : null}
    </>
  );
}

function RangeMarker({
  kind,
  position,
  totalHeight,
}: {
  kind: 'in' | 'out';
  position: number;
  totalHeight: number;
}) {
  const setInPoint = useTimelineStore((s) => s.setInPoint);
  const setOutPoint = useTimelineStore((s) => s.setOutPoint);
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ rectLeft: number; pps: number } | null>(null);

  // Imperative position update — mirrors Playhead so marker drags
  // and zoom changes don't pay the React reconciliation tax.
  useEffect(() => {
    const apply = () => {
      const el = ref.current;
      if (!el) return;
      el.style.transform = `translate3d(${position * getPixelsPerSecond()}px, 0, 0)`;
    };
    apply();
    const unsubZoom = useTimelineViewStore.subscribe(
      (s) => s.zoomLevel,
      apply,
    );
    return () => {
      unsubZoom();
    };
  }, [position]);

  const seekTo = useCallback(
    (clientX: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      const x = Math.max(0, clientX - drag.rectLeft);
      const raw = x / drag.pps;
      const project = useTimelineStore.getState().currentProject;
      const playhead = useTimelineStore.getState().playheadPosition;
      const targets = project
        ? collectSnapTargets(project, {
            playhead,
            gridInterval: chooseMajorInterval(drag.pps),
            gridLimitSec: 3600,
          })
        : [0];
      const snap = findNearestTarget(raw, targets, SNAP_THRESHOLD_PX / drag.pps);
      const target = snap ?? raw;
      if (kind === 'in') setInPoint(target);
      else setOutPoint(target);
      useTimelineViewStore.getState().setSnapPosition(snap);
    },
    [kind, setInPoint, setOutPoint],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
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

  // In-bracket sits to the LEFT of the line ("[" silhouette);
  // out-bracket sits to the RIGHT ("]" silhouette). Keeps the
  // sliver of color inside the kept range.
  return (
    <div
      ref={ref}
      className="absolute left-0 top-0 z-20 w-px bg-accent shadow-[0_0_6px_rgba(59,130,246,0.6)]"
      style={{ height: totalHeight, willChange: 'transform' }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={
          kind === 'in'
            ? 'pointer-events-auto absolute -left-[22px] -top-[3px] flex h-7 w-[24px] cursor-ew-resize items-center justify-end'
            : 'pointer-events-auto absolute -left-[2px] -top-[3px] flex h-7 w-[24px] cursor-ew-resize items-center justify-start'
        }
        title={kind === 'in' ? 'In point (drag, or press I)' : 'Out point (drag, or press O)'}
      >
        <span className="rounded-sm bg-accent px-[5px] py-[2px] font-mono text-[11px] font-bold leading-none text-white shadow-md">
          {kind === 'in' ? 'I' : 'O'}
        </span>
      </div>
    </div>
  );
}
