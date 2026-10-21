import clsx from 'clsx';
import {
  BlendIcon,
  ChevronsUpDownIcon,
  LockIcon,
  LockOpenIcon,
  Music2Icon,
  PlusIcon,
  VideoIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import {
  chooseMajorInterval,
  collectSnapTargets,
  findNearestTarget,
} from '../../lib/snapping';
import { addTransitionInto } from '../../lib/editActions';
import { importFilesToLibrary } from '../../lib/importMedia';
import {
  effectiveTransitionIn,
  previousTouching,
  transitionSpec,
} from '../../lib/transitions';
import { useTimelineStore } from '../../store/useTimelineStore';
import { MEDIA_DRAG_TYPE } from '../MediaLibrary';
import {
  getPixelsPerSecond,
  usePixelsPerSecond,
  useTimelineViewStore,
} from '../../store/useTimelineViewStore';
import type { TimelineTrack, VideoClip } from '../../types/timeline';
import { Clip } from './Clip';
import { nextTrackHeight, SNAP_THRESHOLD_PX, trackHeightPx } from './constants';

export function Track({
  track,
  index,
  removable,
  width,
}: {
  track: TimelineTrack;
  /** 1-based index among same-type tracks (V1, V2 … A1, A2 …). */
  index: number;
  /** True when there's more than one track of this type. */
  removable: boolean;
  width: number;
}) {
  const isVideo = track.type === 'video';
  const height = trackHeightPx(track);
  const locked = !!track.locked;
  const setTrackLocked = useTimelineStore((s) => s.setTrackLocked);
  const setTrackHeight = useTimelineStore((s) => s.setTrackHeight);
  const removeTrack = useTimelineStore((s) => s.removeTrack);
  const setTrackMuted = useTimelineStore((s) => s.setTrackMuted);
  const setTrackSolo = useTimelineStore((s) => s.setTrackSolo);
  const muted = !!track.muted;
  const solo = !!track.solo;

  // Click anywhere on the track body that ISN'T a clip: summon the
  // playhead to the click position. Clips stop propagation in their
  // own pointerDown so we only fire here for genuine empty-area
  // clicks. Snap to the same targets the ruler uses so the cursor
  // lands cleanly on clip edges and grid ticks.
  const onSurfacePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (!e.currentTarget.closest('[data-timeline-surface]')) return;
    useTimelineStore
      .getState()
      .updatePlayhead(timeAtClientX(e.currentTarget, e.clientX));
    useTimelineStore.getState().selectClip(null);
  };

  // Drag-and-drop from the media library (or straight from the OS).
  // The drop time snaps like a click does; the store then resolves it
  // to the nearest free slot, falling over to another track of the
  // asset's kind when this one is the wrong kind or occupied.
  const [dropHover, setDropHover] = useState(false);
  const reorderAtPx = useTimelineViewStore((s) =>
    s.reorderMarker?.trackId === track.id
      ? s.reorderMarker.at * getPixelsPerSecond()
      : null,
  );
  const acceptsDrag = (e: React.DragEvent) =>
    !locked &&
    (e.dataTransfer.types.includes(MEDIA_DRAG_TYPE) ||
      e.dataTransfer.types.includes('Files'));
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!acceptsDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropHover(true);
  };
  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!acceptsDrag(e)) return;
    e.preventDefault();
    setDropHover(false);
    const at = timeAtClientX(e.currentTarget, e.clientX);
    const store = useTimelineStore.getState();
    const mediaId = e.dataTransfer.getData(MEDIA_DRAG_TYPE);
    if (mediaId) {
      store.insertMediaClip(mediaId, { trackId: track.id, startOffset: at });
      return;
    }
    const { assets } = await importFilesToLibrary(
      Array.from(e.dataTransfer.files),
    );
    // Lay several dropped files end to end from the drop point.
    let cursor = at;
    for (const asset of assets) {
      const id = useTimelineStore
        .getState()
        .insertMediaClip(asset.id, { trackId: track.id, startOffset: cursor });
      const placed = useTimelineStore
        .getState()
        .currentProject?.tracks.flatMap((t) => t.clips)
        .find((c) => c.id === id);
      if (placed) cursor = placed.startOffset + placed.duration;
    }
  };

  return (
    <div
      className={clsx(
        'group relative cursor-text border-b border-border bg-panel-elevated/40',
        dropHover && 'bg-accent/15',
      )}
      style={{ height, width }}
      data-track-id={track.id}
      data-track-type={track.type}
      onPointerDown={onSurfacePointerDown}
      onDragOver={onDragOver}
      onDragLeave={() => setDropHover(false)}
      onDrop={onDrop}
    >
      <div className="absolute left-2 top-1 z-10 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-muted">
        {isVideo ? (
          <VideoIcon className="size-3" />
        ) : (
          <Music2Icon className="size-3" />
        )}
        <span className="pointer-events-none select-none">
          {isVideo ? 'V' : 'A'}
          {index}
        </span>
        <TrackToggle
          label="M"
          active={muted}
          activeClass="bg-danger/70 text-white"
          onClick={() => setTrackMuted(track.id, !muted)}
          title={muted ? 'Unmute track' : 'Mute track'}
        />
        <TrackToggle
          label="S"
          active={solo}
          activeClass="bg-amber-500/80 text-white"
          onClick={() => setTrackSolo(track.id, !solo)}
          title={solo ? 'Unsolo track' : 'Solo track'}
        />
        <TrackToggle
          label={locked ? <LockIcon className="size-2.5" /> : <LockOpenIcon className="size-2.5" />}
          active={locked}
          activeClass="bg-slate-500 text-white"
          onClick={() => setTrackLocked(track.id, !locked)}
          title={locked ? 'Unlock track' : 'Lock track (no edits)'}
        />
        <TrackToggle
          label={<ChevronsUpDownIcon className="size-2.5" />}
          active={false}
          activeClass=""
          onClick={() => setTrackHeight(track.id, nextTrackHeight(track.height))}
          title={`Track height: ${track.height ?? 'normal'} (click to change)`}
        />
        {removable ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeTrack(track.id);
            }}
            className="hidden size-4 items-center justify-center rounded text-text-muted opacity-0 transition group-hover:opacity-100 group-hover:flex hover:bg-chrome hover:text-danger"
            title="Remove track"
            aria-label={`Remove ${isVideo ? 'video' : 'audio'} track ${index}`}
          >
            <XIcon className="size-3" />
          </button>
        ) : null}
      </div>
      <div className={locked ? 'pointer-events-none contents' : 'contents'}>
        {track.clips.map((clip) => (
          <Clip key={clip.id} clip={clip} trackHeight={height} />
        ))}
      </div>
      {locked ? (
        <div
          data-track-locked
          className="pointer-events-none absolute inset-0 z-20 bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(100,116,139,0.18)_6px_12px)]"
          title="Track locked"
        />
      ) : null}
      {isVideo && index === 1 && !locked ? <TransitionMarkers track={track} /> : null}
      {reorderAtPx !== null ? (
        <div
          className="pointer-events-none absolute inset-y-0 z-40 w-[3px] -translate-x-1/2 rounded bg-accent shadow-[0_0_6px] shadow-accent"
          style={{ left: reorderAtPx }}
        />
      ) : null}
    </div>
  );
}

/**
 * V1 only: a band over each transition (click to edit it in
 * Properties) and, on hover, a "+" on every bare cut between touching
 * clips to add the default transition there.
 */
function TransitionMarkers({ track }: { track: TimelineTrack }) {
  const pps = usePixelsPerSecond();
  const selectedClipId = useTimelineStore((s) => s.selectedClipId);
  const clips = (track.clips as VideoClip[])
    .filter((c) => c.kind === 'video')
    .sort((a, b) => a.startOffset - b.startOffset);
  return (
    <>
      {clips.map((clip) => {
        if (!previousTouching(clips, clip)) return null;
        const t = effectiveTransitionIn(clips, clip);
        const cutPx = clip.startOffset * pps;
        if (!t) {
          return (
            <button
              key={clip.id}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                addTransitionInto(clip.id);
              }}
              className="absolute top-1/2 z-20 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-panel-elevated text-text-secondary opacity-0 shadow transition group-hover:opacity-100 hover:bg-accent hover:text-white"
              style={{ left: cutPx }}
              title="Add transition (⌘D)"
              aria-label="Add transition"
            >
              <PlusIcon className="size-3" />
            </button>
          );
        }
        const selected = selectedClipId === clip.id;
        return (
          <button
            key={clip.id}
            type="button"
            data-transition-band
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              useTimelineStore.getState().selectClip(clip.id);
            }}
            className={clsx(
              'absolute top-1/2 z-20 flex h-6 -translate-y-1/2 items-center justify-center gap-1 overflow-hidden rounded border bg-black/55 text-[10px] text-white shadow backdrop-blur-sm transition hover:bg-black/70',
              selected ? 'border-accent ring-1 ring-accent' : 'border-white/60',
            )}
            style={{
              left: (t.cut - t.duration / 2) * pps,
              width: Math.max(16, t.duration * pps),
            }}
            title={`${transitionSpec(t.kind).label} · ${t.duration.toFixed(1)}s — click to edit`}
          >
            <BlendIcon className="size-3 shrink-0" />
            {t.duration * pps > 70 ? (
              <span className="truncate">{transitionSpec(t.kind).label}</span>
            ) : null}
          </button>
        );
      })}
    </>
  );
}

/**
 * Timeline seconds under a client X coordinate, snapped to clip
 * edges, the playhead and ruler ticks within the snap threshold.
 */
function timeAtClientX(el: HTMLElement, clientX: number): number {
  const surface = el.closest('[data-timeline-surface]') as HTMLElement | null;
  if (!surface) return 0;
  const rect = surface.getBoundingClientRect();
  const pps = getPixelsPerSecond();
  const raw = Math.max(0, clientX - rect.left) / pps;
  const project = useTimelineStore.getState().currentProject;
  const targets = project
    ? collectSnapTargets(project, {
        gridInterval: chooseMajorInterval(pps),
        gridLimitSec: 3600,
      })
    : [0];
  return findNearestTarget(raw, targets, SNAP_THRESHOLD_PX / pps) ?? raw;
}

function TrackToggle({
  label,
  active,
  activeClass,
  onClick,
  title,
}: {
  label: React.ReactNode;
  active: boolean;
  activeClass: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className={clsx(
        'flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold transition',
        active
          ? activeClass
          : 'bg-chrome text-text-muted hover:text-text-primary',
      )}
    >
      {label}
    </button>
  );
}
