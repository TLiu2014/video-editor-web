import clsx from 'clsx';
import { Music2Icon, VideoIcon, XIcon } from 'lucide-react';
import {
  chooseMajorInterval,
  collectSnapTargets,
  findNearestTarget,
} from '../../lib/snapping';
import { useTimelineStore } from '../../store/useTimelineStore';
import { getPixelsPerSecond } from '../../store/useTimelineViewStore';
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
    const surface = e.currentTarget.closest(
      '[data-timeline-surface]',
    ) as HTMLElement | null;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const pps = getPixelsPerSecond();
    const x = Math.max(0, e.clientX - rect.left);
    const raw = x / pps;
    const project = useTimelineStore.getState().currentProject;
    const targets = project
      ? collectSnapTargets(project, {
          gridInterval: chooseMajorInterval(pps),
          gridLimitSec: 3600,
        })
      : [0];
    const snap = findNearestTarget(raw, targets, SNAP_THRESHOLD_PX / pps);
    useTimelineStore.getState().updatePlayhead(snap ?? raw);
    useTimelineStore.getState().selectClip(null);
  };

  return (
    <div
      className="group relative cursor-text border-b border-border bg-panel-elevated/40"
      style={{ height, width }}
      data-track-id={track.id}
      data-track-type={track.type}
      onPointerDown={onSurfacePointerDown}
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
    </div>
  );
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
