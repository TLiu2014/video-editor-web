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
import { useTimelineStore } from '../../store/useTimelineStore';
import {
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
}

export function Clip({ clip }: { clip: AnyClip }) {
  const pps = usePixelsPerSecond();
  const moveClip = useTimelineStore((s) => s.moveClip);
  const trimClipLeft = useTimelineStore((s) => s.trimClipLeft);
  const trimClipRight = useTimelineStore((s) => s.trimClipRight);
  const rippleTrimLeft = useTimelineStore((s) => s.rippleTrimLeft);
  const rippleTrimRight = useTimelineStore((s) => s.rippleTrimRight);
  const selectClip = useTimelineStore((s) => s.selectClip);
  const toggleClipSelection = useTimelineStore((s) => s.toggleClipSelection);
  const setSnapPosition = useTimelineViewStore((s) => s.setSnapPosition);
  const selected = useTimelineStore((s) =>
    s.selectedClipIds.includes(clip.id),
  );

  const dragRef = useRef<DragState | null>(null);
  const [deltaPx, setDeltaPx] = useState(0);
  // Vertical pixel offset during a 'move' drag. Lets the clip
  // visually leave its source track row and follow the cursor's Y
  // coordinate; on release the store updates `trackId` so the
  // clip re-mounts inside the target track's flow.
  const [deltaY, setDeltaY] = useState(0);
  const [mode, setMode] = useState<DragMode | null>(null);

  const beginDrag = (e: React.PointerEvent<HTMLDivElement>, m: DragMode) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      mode: m,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      shiftKey: e.shiftKey,
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
      const deltaSec = resolveRippleDelta(clip, trimMode, rawPx / pps);
      setDeltaPx(deltaSec * pps);
      setSnapPosition(null);
      return;
    }

    const { deltaSec, snapPosition } = resolveDelta(
      clip,
      drag.mode,
      rawPx / pps,
      SNAP_THRESHOLD_PX / pps,
      pps,
    );
    setDeltaPx(deltaSec * pps);
    setSnapPosition(snapPosition);
    // Vertical follow is move-only — trim drags are constrained
    // horizontally by design.
    if (drag.mode === 'move') {
      setDeltaY(e.clientY - drag.startY);
    }
  };

  const commit = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setSnapPosition(null);

    if (!drag.moved && drag.mode === 'move') {
      if (drag.shiftKey) {
        // Shift+click: toggle this clip in the multi-selection
        // without disturbing other selected clips.
        toggleClipSelection(clip.id);
      } else {
        // Plain click: replace selection with this clip (or
        // clear if already the sole selection).
        selectClip(selected ? null : clip.id);
      }
      setMode(null);
      setDeltaPx(0);
      setDeltaY(0);
      return;
    }
    if (drag.moved) {
      const rawSec = (e.clientX - drag.startX) / pps;
      const trimMode: 'trim-left' | 'trim-right' | null =
        drag.mode === 'trim-left' || drag.mode === 'trim-right'
          ? drag.mode
          : null;
      const isRippleTrim = drag.shiftKey && trimMode !== null;
      const deltaSec =
        isRippleTrim && trimMode
          ? resolveRippleDelta(clip, trimMode, rawSec)
          : resolveDelta(clip, drag.mode, rawSec, SNAP_THRESHOLD_PX / pps, pps)
              .deltaSec;
      if (drag.mode === 'move') {
        // Detect a target track under the cursor for cross-track
        // drops. Falls back to the original track when the cursor
        // is over a different-type track, the gutter, or nothing.
        const elAtCursor = document.elementFromPoint(e.clientX, e.clientY);
        const targetTrackEl = elAtCursor?.closest(
          '[data-track-id]',
        ) as HTMLElement | null;
        const targetTrackId = targetTrackEl?.dataset.trackId;
        const targetTrackType = targetTrackEl?.dataset.trackType as
          | 'video'
          | 'audio'
          | undefined;
        const sameKind = targetTrackType === clip.kind;
        moveClip(
          clip.id,
          clip.startOffset + deltaSec,
          targetTrackId && sameKind ? targetTrackId : undefined,
        );
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
  const dragging = mode === 'move' && (deltaPx !== 0 || deltaY !== 0);

  const visibleDurationSec = widthPx / pps;

  return (
    <div
      onPointerDown={(e) => beginDrag(e, 'move')}
      onPointerMove={updateDrag}
      onPointerUp={commit}
      onPointerCancel={commit}
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
): { deltaSec: number; snapPosition: number | null } {
  const project = useTimelineStore.getState().currentProject;
  if (!project) return { deltaSec: rawDeltaSec, snapPosition: null };

  const range = computeDeltaRange(clip, mode, project);
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
    case 'trim-left':
      return clip.startOffset + deltaSec;
    case 'trim-right':
      return clip.startOffset + clip.duration + deltaSec;
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
  if (mode === 'trim-left') {
    const minDelta = -clip.trimStart;
    const maxDelta = clip.trimEnd - clip.trimStart - MIN_CLIP_DURATION;
    return Math.max(minDelta, Math.min(maxDelta, rawDeltaSec));
  }
  const minDelta = MIN_CLIP_DURATION - (clip.trimEnd - clip.trimStart);
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
    case 'trim-left':
      return targetTimelineSec - clip.startOffset;
    case 'trim-right':
      return targetTimelineSec - (clip.startOffset + clip.duration);
  }
}
