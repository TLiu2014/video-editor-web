import clsx from 'clsx';
import { Music2Icon, VideoIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import {
  chooseMajorInterval,
  collectSnapTargets,
  findNearestTarget,
} from '../../lib/snapping';
import { importFilesToLibrary } from '../../lib/importMedia';
import { useTimelineStore } from '../../store/useTimelineStore';
import { MEDIA_DRAG_TYPE } from '../MediaLibrary';
import {
  getPixelsPerSecond,
  useTimelineViewStore,
} from '../../store/useTimelineViewStore';
import type { TimelineTrack } from '../../types/timeline';
import { Clip } from './Clip';
import { SNAP_THRESHOLD_PX, TRACK_HEIGHT_AUDIO, TRACK_HEIGHT_VIDEO } from './constants';

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
  const height = isVideo ? TRACK_HEIGHT_VIDEO : TRACK_HEIGHT_AUDIO;
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
    e.dataTransfer.types.includes(MEDIA_DRAG_TYPE) ||
    e.dataTransfer.types.includes('Files');
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
      {track.clips.map((clip) => (
        <Clip key={clip.id} clip={clip} />
      ))}
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
  label: string;
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
