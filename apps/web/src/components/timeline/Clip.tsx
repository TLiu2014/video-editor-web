import clsx from 'clsx';
import { useRef, useState } from 'react';
import {
  clampDelta,
  computeDeltaRange,
  type DragMode,
} from '../../lib/clipBounds';
import { MIN_CLIP_DURATION } from '../../store/useTimelineStore';
import { formatTime } from '../../lib/formatTime';
import {
  chooseMajorInterval,
  collectSnapTargets,
  findNearestTarget,
} from '../../lib/snapping';
import { computeProjectDuration } from '../../lib/projectMetrics';
import {
  expandWithGroups,
  findReorderTarget,
  moveDeltaRange,
  type ReorderTarget,
} from '../../lib/timelineOps';
import { useTimelineStore } from '../../store/useTimelineStore';
import {
  getPixelsPerSecond,
  useTimelineViewStore,
  usePixelsPerSecond,
} from '../../store/useTimelineViewStore';
import type { AnyClip } from '../../types/timeline';
import { SNAP_THRESHOLD_PX } from './constants';
import { VideoThumbnailStrip } from './VideoThumbnailStrip';
import { Waveform } from './Waveform';

const CLICK_DRAG_THRESHOLD_PX = 3;
const HANDLE_WIDTH_PX = 10;

/**
 * `#RRGGBB` → `rgba(R, G, B, alpha)`. Falls back to the input
 * string when the hex parse fails, so non-hex tokens still work as
 * an escape hatch.
 */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const raw = m[1] ?? '';
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  moved: boolean;
  shiftKey: boolean;
  /**
   * Clips that travel with this one on a 'move' drag: the whole
   * selection when this clip is part of a multi-selection, plus any
   * group-mates. A set of one means a free single-clip move.
   */
  movingIds: ReadonlySet<string>;
}

export function Clip({ clip }: { clip: AnyClip }) {
  const pps = usePixelsPerSecond();
  const moveClip = useTimelineStore((s) => s.moveClip);
  const moveClips = useTimelineStore((s) => s.moveClips);
  const trimClipLeft = useTimelineStore((s) => s.trimClipLeft);
  const trimClipRight = useTimelineStore((s) => s.trimClipRight);
  const rippleTrimLeft = useTimelineStore((s) => s.rippleTrimLeft);
  const rippleTrimRight = useTimelineStore((s) => s.rippleTrimRight);
  const selectClip = useTimelineStore((s) => s.selectClip);
  const toggleClipSelection = useTimelineStore((s) => s.toggleClipSelection);
  const setSnapPosition = useTimelineViewStore((s) => s.setSnapPosition);
  const setMoveDragPreview = useTimelineViewStore((s) => s.setMoveDragPreview);
  const setClipContextMenu = useTimelineViewStore((s) => s.setClipContextMenu);
  const setReorderMarker = useTimelineViewStore((s) => s.setReorderMarker);
  const reorderClip = useTimelineStore((s) => s.reorderClip);
  const selected = useTimelineStore((s) =>
    s.selectedClipIds.includes(clip.id),
  );
  // Offset applied while ANOTHER clip leads a multi-clip move drag.
  const followPx = useTimelineViewStore((s) =>
    s.moveDragPreview && s.moveDragPreview.ids.has(clip.id)
      ? s.moveDragPreview.deltaPx
      : 0,
  );

  const dragRef = useRef<DragState | null>(null);
  const [deltaPx, setDeltaPx] = useState(0);
  // Vertical pixel offset during a 'move' drag. Lets the clip
  // visually leave its source track row and follow the cursor's Y
  // coordinate; on release the store updates `trackId` so the
  // clip re-mounts inside the target track's flow.
  const [deltaY, setDeltaY] = useState(0);
  const [mode, setMode] = useState<DragMode | null>(null);

  // Trims work in source seconds, moves in timeline seconds; a clip
  // at speed r covers r source-seconds per timeline-second.
  const rate = clip.playbackRate ?? 1;
  const pxToDelta = (m: DragMode, px: number) =>
    m === 'move' ? px / pps : (px / pps) * rate;
  const deltaToPx = (m: DragMode, d: number) =>
    m === 'move' ? d * pps : (d / rate) * pps;

  const beginDrag = (e: React.PointerEvent<HTMLDivElement>, m: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = useTimelineStore.getState();
    const project = s.currentProject;
    const seed =
      selected && s.selectedClipIds.length > 1 ? s.selectedClipIds : [clip.id];
    dragRef.current = {
      mode: m,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      shiftKey: e.shiftKey,
      movingIds: project ? expandWithGroups(project, seed) : new Set([clip.id]),
    };
    setMode(m);
    setDeltaPx(0);
    setDeltaY(0);
  };

  const updateDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rawPx = e.clientX - drag.startX;
    if (Math.abs(rawPx) > CLICK_DRAG_THRESHOLD_PX) drag.moved = true;
    // Track shift live so the user can engage ripple mid-drag by
    // pressing Shift after the drag has already started.
    drag.shiftKey = e.shiftKey;

    const trimMode: 'trim-left' | 'trim-right' | null =
      drag.mode === 'trim-left' || drag.mode === 'trim-right'
        ? drag.mode
        : null;
    if (drag.shiftKey && trimMode) {
      const d = resolveRippleDelta(clip, trimMode, pxToDelta(trimMode, rawPx));
      setDeltaPx(deltaToPx(trimMode, d));
      setSnapPosition(null);
      return;
    }

    const { deltaSec, snapPosition } = resolveDelta(
      clip,
      drag.mode,
      pxToDelta(drag.mode, rawPx),
      SNAP_THRESHOLD_PX / pps,
      pps,
      drag.movingIds,
    );
    const px = deltaToPx(drag.mode, deltaSec);
    setDeltaPx(px);
    setSnapPosition(snapPosition);
    if (drag.mode === 'move') {
      if (drag.movingIds.size > 1) {
        // Multi-clip moves stay on their tracks; others follow along.
        setMoveDragPreview({ ids: drag.movingIds, deltaPx: px });
      } else {
        // Vertical follow is single-clip-move only — trim drags are
        // horizontal by design.
        setDeltaY(e.clientY - drag.startY);
        // Pointer over another clip = reorder: show where it'll go.
        const reorder = reorderTargetAt(clip.id, e);
        setReorderMarker(
          reorder ? { trackId: reorder.trackId, at: reorder.markerAt } : null,
        );
        if (reorder) setSnapPosition(null);
      }
    }
  };

  const commit = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setSnapPosition(null);
    setMoveDragPreview(null);
    setReorderMarker(null);

    if (!drag.moved && drag.mode === 'move') {
      if (drag.shiftKey) {
        // Shift+click: toggle this clip in the multi-selection
        // without disturbing other selected clips.
        toggleClipSelection(clip.id);
      } else {
        // Plain click: replace the selection with this clip.
        // Clearing is done by clicking empty track space or Esc.
        selectClip(clip.id);
      }
      setMode(null);
      setDeltaPx(0);
      setDeltaY(0);
      return;
    }
    if (drag.moved) {
      const rawPx = e.clientX - drag.startX;
      const trimMode: 'trim-left' | 'trim-right' | null =
        drag.mode === 'trim-left' || drag.mode === 'trim-right'
          ? drag.mode
          : null;
      const isRippleTrim = drag.shiftKey && trimMode !== null;
      const deltaSec =
        isRippleTrim && trimMode
          ? resolveRippleDelta(clip, trimMode, pxToDelta(trimMode, rawPx))
          : resolveDelta(
              clip,
              drag.mode,
              pxToDelta(drag.mode, rawPx),
              SNAP_THRESHOLD_PX / pps,
              pps,
              drag.movingIds,
            ).deltaSec;
      if (drag.mode === 'move' && drag.movingIds.size > 1) {
        moveClips([...drag.movingIds], deltaSec);
      } else if (drag.mode === 'move') {
        const reorder = reorderTargetAt(clip.id, e);
        if (reorder) {
          // Dropped onto another clip: rearrange the sequence.
          reorderClip(clip.id, reorder);
        } else {
          // Dropped in empty space: free move, on the track under
          // the cursor when it's the same kind. The store resolves
          // the drop to the nearest free slot, so the clip may settle
          // into a gap next to where it was let go.
          const under = pointerOnTimeline(e);
          moveClip(
            clip.id,
            clip.startOffset + deltaSec,
            under && under.trackType === clip.kind ? under.trackId : undefined,
          );
        }
      } else if (drag.mode === 'trim-left') {
        if (isRippleTrim) {
          rippleTrimLeft(clip.id, clip.trimStart + deltaSec);
        } else {
          trimClipLeft(clip.id, clip.trimStart + deltaSec);
        }
      } else {
        if (isRippleTrim) {
          rippleTrimRight(clip.id, clip.trimEnd + deltaSec);
        } else {
          trimClipRight(clip.id, clip.trimEnd + deltaSec);
        }
      }
    }
    setMode(null);
    setDeltaPx(0);
    setDeltaY(0);
  };

  const openContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Right-clicking outside the selection retargets it, like every
    // desktop editor; inside it, the whole selection stays the target.
    if (!selected) selectClip(clip.id);
    setClipContextMenu({ x: e.clientX, y: e.clientY });
  };

  const isVideo = clip.kind === 'video';
  const baseLeftPx = clip.startOffset * pps;
  const baseWidthPx = Math.max(2, clip.duration * pps);

  let leftPx = baseLeftPx;
  let widthPx = baseWidthPx;
  if (mode === 'trim-left') {
    leftPx = baseLeftPx + deltaPx;
    widthPx = Math.max(2, baseWidthPx - deltaPx);
  } else if (mode === 'trim-right') {
    widthPx = Math.max(2, baseWidthPx + deltaPx);
  }
  // For 'move', leave `left`/`width` at their base values and use a
  // CSS transform for both axes — that's GPU-cheap and lets the
  // clip escape the source-track div on the vertical axis.
  const dragging =
    (mode === 'move' && (deltaPx !== 0 || deltaY !== 0)) || followPx !== 0;

  const visibleDurationSec = widthPx / pps;

  return (
    <div
      onPointerDown={(e) => beginDrag(e, 'move')}
      onPointerMove={updateDrag}
      onPointerUp={commit}
      onPointerCancel={commit}
      onContextMenu={openContextMenu}
      // The scroll container clears the selection on click; a click
      // that started on a clip must not reach it, or selecting a clip
      // is undone the moment the pointer is released.
      onClick={(e) => e.stopPropagation()}
      className={clsx(
        'no-select group absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-md border transition-shadow active:cursor-grabbing',
        isVideo
          ? 'border-clip-video-strong/60 bg-clip-video/90'
          : 'border-clip-audio-strong/60 bg-clip-audio/90',
        selected
          ? 'ring-2 ring-accent ring-offset-1 ring-offset-panel z-10'
          : 'hover:brightness-110',
        dragging && 'shadow-2xl',
      )}
      style={{
        left: leftPx,
        width: widthPx,
        ...(mode === 'move'
          ? {
              transform: `translate3d(${deltaPx}px, ${deltaY}px, 0)`,
              zIndex: 30,
              willChange: 'transform',
            }
          : followPx !== 0
            ? {
                transform: `translate3d(${followPx}px, 0, 0)`,
                zIndex: 30,
                willChange: 'transform',
              }
            : undefined),
        ...(clip.color
          ? { backgroundColor: withAlpha(clip.color, 0.9) }
          : undefined),
      }}
      title={`${clip.name} · ${formatTime(clip.duration, false)}`}
    >
      {clip.kind === 'audio' ? (
        <Waveform clip={clip} widthPx={widthPx} heightPx={48} />
      ) : (
        <>
          <VideoThumbnailStrip clip={clip} widthPx={widthPx} heightPx={44} />
          {clip.hasAudio ? (
            <Waveform
              clip={clip}
              widthPx={widthPx}
              heightPx={20}
              topPx={44}
            />
          ) : null}
        </>
      )}
      <div className="relative flex h-full flex-col justify-between px-3 py-1.5 text-white">
        <div className="flex items-center gap-1.5 text-[13px] font-medium leading-tight">
          <span className="truncate">{clip.name}</span>
        </div>
        <div className="font-mono text-[11px] leading-none text-white/80">
          {formatTime(visibleDurationSec, false)}
        </div>
      </div>

      <TrimHandle
        side="left"
        active={mode === 'trim-left'}
        onPointerDown={(e) => beginDrag(e, 'trim-left')}
        onPointerMove={updateDrag}
        onPointerUp={commit}
      />
      <TrimHandle
        side="right"
        active={mode === 'trim-right'}
        onPointerDown={(e) => beginDrag(e, 'trim-right')}
        onPointerMove={updateDrag}
        onPointerUp={commit}
      />
    </div>
  );
}

function TrimHandle({
  side,
  active,
  ...handlers
}: {
  side: 'left' | 'right';
  active: boolean;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp: React.PointerEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      {...handlers}
      onPointerCancel={handlers.onPointerUp}
      className={clsx(
        'absolute top-0 bottom-0 cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100',
        active && 'opacity-100',
        side === 'left' ? 'left-0' : 'right-0',
      )}
      style={{ width: HANDLE_WIDTH_PX }}
    >
      <div
        className={clsx(
          'pointer-events-none absolute inset-y-1 w-1 rounded-sm bg-white/80',
          side === 'left' ? 'left-1' : 'right-1',
        )}
      />
    </div>
  );
}

/**
 * Track row and timeline time under the pointer. Found by geometry,
 * not `elementFromPoint`: during a drag the clip itself follows the
 * cursor and sits on top, and its DOM parent is the SOURCE track — so
 * a hit test would always report the track the drag started on.
 */
function pointerOnTimeline(e: React.PointerEvent<HTMLElement>): {
  trackId: string;
  trackType: 'video' | 'audio';
  time: number;
} | null {
  const surface = e.currentTarget.closest(
    '[data-timeline-surface]',
  ) as HTMLElement | null;
  if (!surface) return null;
  const rows = surface.querySelectorAll<HTMLElement>('[data-track-id]');
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (e.clientY >= rect.top && e.clientY < rect.bottom) {
      const left = surface.getBoundingClientRect().left;
      return {
        trackId: row.dataset.trackId ?? '',
        trackType: row.dataset.trackType === 'audio' ? 'audio' : 'video',
        time: Math.max(0, (e.clientX - left) / getPixelsPerSecond()),
      };
    }
  }
  return null;
}

function reorderTargetAt(
  clipId: string,
  e: React.PointerEvent<HTMLElement>,
): ReorderTarget | null {
  const project = useTimelineStore.getState().currentProject;
  const under = pointerOnTimeline(e);
  if (!project || !under) return null;
  return findReorderTarget(project, clipId, under.trackId, under.time);
}

/**
 * Combine the data-model / neighbor clamp with snap-to-target
 * behavior. Snap is attempted on the moving edge; if the snapped
 * position would push the value back outside the clamp range, the
 * snap is rejected (so the handle never visibly jumps to an
 * invalid position).
 */
function resolveDelta(
  clip: AnyClip,
  mode: DragMode,
  rawDeltaSec: number,
  thresholdSec: number,
  pps: number,
  movingIds: ReadonlySet<string>,
): { deltaSec: number; snapPosition: number | null } {
  const project = useTimelineStore.getState().currentProject;
  if (!project) return { deltaSec: rawDeltaSec, snapPosition: null };

  // A lone clip moves freely (its drop resolves to a free slot); a
  // set moving together is clamped so no member hits a fixed clip.
  const range =
    mode !== 'move'
      ? computeDeltaRange(clip, mode, project)
      : movingIds.size > 1
        ? moveDeltaRange(project, movingIds)
        : { minDelta: -clip.startOffset, maxDelta: Infinity };
  const clamped = clampDelta(range, rawDeltaSec);

  const playhead = useTimelineStore.getState().playheadPosition;
  const projectDuration = computeProjectDuration(project);
  const targets = collectSnapTargets(project, {
    excludeClipId: clip.id,
    playhead,
    gridInterval: chooseMajorInterval(pps),
    gridLimitSec: Math.max(60, projectDuration + 30),
  });
  const movingEdge = computeMovingEdge(clip, mode, clamped);
  const snapTarget = findNearestTarget(movingEdge, targets, thresholdSec);
  if (snapTarget === null) {
    return { deltaSec: clamped, snapPosition: null };
  }
  const snappedDelta = movingEdgeToDelta(clip, mode, snapTarget);
  const reClamped = clampDelta(range, snappedDelta);
  if (Math.abs(reClamped - snappedDelta) > 1e-6) {
    return { deltaSec: clamped, snapPosition: null };
  }
  return { deltaSec: reClamped, snapPosition: snapTarget };
}

function computeMovingEdge(
  clip: AnyClip,
  mode: DragMode,
  deltaSec: number,
): number {
  switch (mode) {
    case 'move':
      return clip.startOffset + deltaSec;
    case 'trim-left':
      return clip.startOffset + deltaSec / (clip.playbackRate ?? 1);
    case 'trim-right':
      return (
        clip.startOffset + clip.duration + deltaSec / (clip.playbackRate ?? 1)
      );
  }
}

/**
 * Same as `resolveDelta` but skips neighbor clamping and snapping —
 * ripple-trim drags push downstream clips out of the way, so
 * neighbor edges aren't a hard stop. Only the data-model bounds
 * apply (trim within [0, sourceDuration], MIN_CLIP_DURATION).
 *
 * Returned `deltaSec` is in source-time (matches `resolveDelta`).
 */
function resolveRippleDelta(
  clip: AnyClip,
  mode: 'trim-left' | 'trim-right',
  rawDeltaSec: number,
): number {
  const minSpan = MIN_CLIP_DURATION * (clip.playbackRate ?? 1);
  if (mode === 'trim-left') {
    const minDelta = -clip.trimStart;
    const maxDelta = clip.trimEnd - clip.trimStart - minSpan;
    return Math.max(minDelta, Math.min(maxDelta, rawDeltaSec));
  }
  const minDelta = minSpan - (clip.trimEnd - clip.trimStart);
  const maxDelta = clip.sourceDuration - clip.trimEnd;
  return Math.max(minDelta, Math.min(maxDelta, rawDeltaSec));
}

function movingEdgeToDelta(
  clip: AnyClip,
  mode: DragMode,
  targetTimelineSec: number,
): number {
  switch (mode) {
    case 'move':
      return targetTimelineSec - clip.startOffset;
    case 'trim-left':
      return (targetTimelineSec - clip.startOffset) * (clip.playbackRate ?? 1);
    case 'trim-right':
      return (
        (targetTimelineSec - (clip.startOffset + clip.duration)) *
        (clip.playbackRate ?? 1)
      );
  }
}
