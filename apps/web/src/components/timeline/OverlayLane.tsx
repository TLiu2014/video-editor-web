import clsx from 'clsx';
import {
  CircleIcon,
  MessageSquareIcon,
  MoveUpRightIcon,
  SquareIcon,
  TypeIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { formatTime } from '../../lib/formatTime';
import { computeProjectDuration } from '../../lib/projectMetrics';
import {
  effectiveOverlayFades,
  isTextOverlay,
  overlayLabel,
} from '../../lib/shapes';
import {
  chooseMajorInterval,
  collectSnapTargets,
  findNearestTarget,
} from '../../lib/snapping';
import { useTimelineStore } from '../../store/useTimelineStore';
import {
  useTimelineViewStore,
  usePixelsPerSecond,
} from '../../store/useTimelineViewStore';
import type { AnyOverlay, VideoProject } from '../../types/timeline';
import { SNAP_THRESHOLD_PX } from './constants';

export const OVERLAY_ROW_HEIGHT = 24;
const LANE_PADDING = 4;
const MIN_OVERLAY_DURATION = 0.2;

/**
 * Pack overlays into rows so ones that overlap in time sit on separate
 * rows (first-fit by start time). Returns the row index per overlay id
 * and the row count (at least 1, so the lane is always visible).
 */
export function packOverlayRows(overlays: AnyOverlay[]): {
  rowOf: Map<string, number>;
  rows: number;
} {
  const rowEnds: number[] = [];
  const rowOf = new Map<string, number>();
  for (const o of [...overlays].sort((a, b) => a.startOffset - b.startOffset)) {
    let row = rowEnds.findIndex((end) => end <= o.startOffset + 1e-6);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(0);
    }
    rowEnds[row] = o.startOffset + o.duration;
    rowOf.set(o.id, row);
  }
  return { rowOf, rows: Math.max(1, rowEnds.length) };
}

export function overlayLaneHeight(project: VideoProject): number {
  return packOverlayRows(project.overlays).rows * OVERLAY_ROW_HEIGHT + LANE_PADDING * 2;
}

/**
 * Timeline lane for everything drawn over the video — text overlays,
 * captions and annotation shapes. Drag a bar to move it, drag its
 * edges to change when it starts / ends; both snap like clips do.
 */
export function OverlayLane({ width }: { width: number }) {
  const overlays = useTimelineStore((s) => s.currentProject?.overlays);
  if (!overlays) return null;
  const { rowOf, rows } = packOverlayRows(overlays);
  return (
    <div
      className="relative border-b border-border bg-panel"
      style={{ width, height: rows * OVERLAY_ROW_HEIGHT + LANE_PADDING * 2 }}
      data-overlay-lane
    >
      <span className="pointer-events-none absolute left-2 top-1 z-10 text-[10px] uppercase tracking-wide text-text-muted">
        {overlays.length === 0 ? 'Overlays — text, captions, annotations' : null}
      </span>
      {overlays.map((o) => (
        <OverlayBar
          key={o.id}
          overlay={o}
          top={LANE_PADDING + (rowOf.get(o.id) ?? 0) * OVERLAY_ROW_HEIGHT}
        />
      ))}
    </div>
  );
}

type BarMode = 'move' | 'start' | 'end';

function OverlayBar({ overlay, top }: { overlay: AnyOverlay; top: number }) {
  const pps = usePixelsPerSecond();
  const selected = useTimelineStore((s) => s.selectedOverlayId === overlay.id);
  const setSnapPosition = useTimelineViewStore((s) => s.setSnapPosition);
  const dragRef = useRef<{ mode: BarMode; startX: number; moved: boolean } | null>(null);
  const [delta, setDelta] = useState<{ mode: BarMode; sec: number } | null>(null);

  /** Resolve a raw drag (seconds) into a clamped, snapped delta. */
  const resolve = (mode: BarMode, rawSec: number): { sec: number; snap: number | null } => {
    const project = useTimelineStore.getState().currentProject;
    const start = overlay.startOffset;
    const end = start + overlay.duration;
    const clampDelta = (d: number) =>
      mode === 'move'
        ? Math.max(-start, d)
        : mode === 'start'
          ? Math.max(-start, Math.min(overlay.duration - MIN_OVERLAY_DURATION, d))
          : Math.max(MIN_OVERLAY_DURATION - overlay.duration, d);
    const clamped = clampDelta(rawSec);
    if (!project) return { sec: clamped, snap: null };
    const targets = collectSnapTargets(project, {
      excludeOverlayId: overlay.id,
      playhead: useTimelineStore.getState().playheadPosition,
      gridInterval: chooseMajorInterval(pps),
      gridLimitSec: Math.max(60, computeProjectDuration(project) + 30),
    });
    const edge = mode === 'end' ? end + clamped : start + clamped;
    const snap = findNearestTarget(edge, targets, SNAP_THRESHOLD_PX / pps);
    if (snap === null) return { sec: clamped, snap: null };
    const snapped = clampDelta(snap - (mode === 'end' ? end : start));
    return { sec: snapped, snap };
  };

  const begin = (e: React.PointerEvent<HTMLElement>, mode: BarMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { mode, startX: e.clientX, moved: false };
    useTimelineStore.getState().selectOverlay(overlay.id);
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const px = e.clientX - d.startX;
    if (Math.abs(px) > 3) d.moved = true;
    if (!d.moved) return;
    const r = resolve(d.mode, px / pps);
    setDelta({ mode: d.mode, sec: r.sec });
    setSnapPosition(r.snap);
  };
  const end = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setSnapPosition(null);
    setDelta(null);
    if (!d.moved) return;
    const { sec } = resolve(d.mode, (e.clientX - d.startX) / pps);
    const s = useTimelineStore.getState();
    const patch =
      d.mode === 'move'
        ? { startOffset: overlay.startOffset + sec }
        : d.mode === 'start'
          ? { startOffset: overlay.startOffset + sec, duration: overlay.duration - sec }
          : { duration: overlay.duration + sec };
    if (isTextOverlay(overlay)) s.updateOverlay(overlay.id, patch);
    else s.updateShape(overlay.id, patch);
  };

  let start = overlay.startOffset;
  let dur = overlay.duration;
  if (delta?.mode === 'move') start += delta.sec;
  if (delta?.mode === 'start') {
    start += delta.sec;
    dur -= delta.sec;
  }
  if (delta?.mode === 'end') dur += delta.sec;

  const Icon = isTextOverlay(overlay)
    ? TypeIcon
    : overlay.kind === 'callout'
      ? MessageSquareIcon
      : overlay.kind === 'arrow'
        ? MoveUpRightIcon
        : overlay.kind === 'ellipse'
          ? CircleIcon
          : SquareIcon;
  const label = overlayLabel(overlay);
  const fades = effectiveOverlayFades(overlay);

  return (
    <div
      data-overlay-bar={overlay.id}
      onPointerDown={(e) => begin(e, 'move')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      // The scroll container clears the selection on click.
      onClick={(e) => e.stopPropagation()}
      className={clsx(
        'group absolute flex cursor-grab items-center gap-1 overflow-hidden rounded border px-1.5 text-[11px] text-white active:cursor-grabbing',
        isTextOverlay(overlay)
          ? 'border-sky-300/60 bg-sky-600/85'
          : 'border-rose-300/60 bg-rose-600/85',
        selected && 'ring-2 ring-accent ring-offset-1 ring-offset-panel z-10',
        delta && 'shadow-lg',
      )}
      style={{
        left: start * pps,
        width: Math.max(6, dur * pps),
        top,
        height: OVERLAY_ROW_HEIGHT - 4,
      }}
      title={`${label} · ${formatTime(dur, false)} @ ${formatTime(start, false)}`}
    >
      {/* Fade ramps, like the clip fades on tracks. */}
      {fades.fadeIn > 0 ? (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/45 to-transparent"
          style={{ width: Math.min(dur, fades.fadeIn) * pps }}
        />
      ) : null}
      {fades.fadeOut > 0 ? (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-black/45 to-transparent"
          style={{ width: Math.min(dur, fades.fadeOut) * pps }}
        />
      ) : null}
      {/* Motion keyframes (relative to the overlay's start). */}
      {(overlay.motion ?? []).map((k) =>
        k.t >= 0 && k.t <= dur ? (
          <span
            key={k.t}
            data-keyframe="overlay-motion"
            className="pointer-events-none absolute bottom-0.5 z-10 size-2 -translate-x-1/2 rotate-45 border border-white bg-sky-400"
            style={{ left: k.t * pps }}
          />
        ) : null,
      )}
      <Icon className="relative size-3 shrink-0" />
      <span className="relative truncate">{label}</span>
      {(['start', 'end'] as const).map((side) => (
        <div
          key={side}
          onPointerDown={(e) => begin(e, side)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className={clsx(
            'absolute inset-y-0 w-2 cursor-ew-resize opacity-0 transition group-hover:opacity-100',
            side === 'start' ? 'left-0' : 'right-0',
          )}
        >
          <div
            className={clsx(
              'pointer-events-none absolute inset-y-1 w-0.5 rounded bg-white/80',
              side === 'start' ? 'left-0.5' : 'right-0.5',
            )}
          />
        </div>
      ))}
    </div>
  );
}
