import { PlusIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { computeProjectDuration } from '../../lib/projectMetrics';
import { useTimelineStore } from '../../store/useTimelineStore';
import {
  getPixelsPerSecond,
  usePixelsPerSecond,
} from '../../store/useTimelineViewStore';
import {
  MIN_TIMELINE_SECONDS,
  RULER_HEIGHT,
  TRACK_HEIGHT_AUDIO,
  TRACK_HEIGHT_VIDEO,
} from './constants';
import { EditToolbar } from './EditToolbar';
import { InOutMarkers } from './InOutMarkers';
import { Playhead } from './Playhead';
import { Ruler } from './Ruler';
import { SnapIndicator } from './SnapIndicator';
import { Track } from './Track';
import { ZoomControls } from './ZoomControls';

export function Timeline() {
  const project = useTimelineStore((s) => s.currentProject);
  const selectClip = useTimelineStore((s) => s.selectClip);
  const addTrack = useTimelineStore((s) => s.addTrack);
  const pps = usePixelsPerSecond();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const el = scrollRef.current;
      if (!el) return;
      const detail = (e as CustomEvent<{ seconds: number }>).detail;
      if (!detail) return;
      const targetPx = detail.seconds * getPixelsPerSecond();
      // Center the target in the viewport when possible. Falls back
      // to a clamp at the right edge for very late targets.
      const viewport = el.clientWidth;
      const max = Math.max(0, el.scrollWidth - viewport);
      const next = Math.max(0, Math.min(max, targetPx - viewport / 3));
      el.scrollTo({ left: next, behavior: 'smooth' });
    };
    window.addEventListener('timeline:scroll-to-time', handler);
    return () =>
      window.removeEventListener('timeline:scroll-to-time', handler);
  }, []);

  if (!project) {
    return (
      <div className="flex h-60 shrink-0 items-center justify-center border-t border-border bg-panel text-[12px] text-text-muted">
        Create or open a project to see the timeline.
      </div>
    );
  }

  const projectDuration = computeProjectDuration(project);
  // Pad the visible range so users can drag clips into empty space
  // and the playhead can travel past the last clip.
  const duration = Math.max(MIN_TIMELINE_SECONDS, projectDuration + 10);
  const width = duration * pps;
  const tracksHeight = project.tracks.reduce(
    (acc, t) =>
      acc + (t.type === 'video' ? TRACK_HEIGHT_VIDEO : TRACK_HEIGHT_AUDIO),
    0,
  );
  const totalHeight = RULER_HEIGHT + tracksHeight;

  // Precompute the same-type index for each track so the Track
  // component just receives the number it needs to render (V1, A2, …).
  const videoCounts = { count: 0 };
  const audioCounts = { count: 0 };
  const trackMeta = project.tracks.map((t) => {
    const bucket = t.type === 'video' ? videoCounts : audioCounts;
    bucket.count += 1;
    return { typeIndex: bucket.count };
  });
  const audioTrackCount = audioCounts.count;
  const videoTrackCount = videoCounts.count;

  return (
    <div className="flex h-80 shrink-0 flex-col border-t border-border bg-panel">
      <div className="flex h-11 items-center gap-3 border-b border-border bg-panel px-3 text-[12px] text-text-muted">
        <span className="text-[12px] uppercase tracking-wide">Timeline</span>
        <div className="mx-1 h-5 w-px bg-border" />
        <EditToolbar />
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => addTrack('video')}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-[12px] text-text-secondary transition hover:bg-chrome hover:text-text-primary"
          title="Add video track (PiP overlay)"
        >
          <PlusIcon className="size-4" />
          Video track
        </button>
        <button
          type="button"
          onClick={() => addTrack('audio')}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-[12px] text-text-secondary transition hover:bg-chrome hover:text-text-primary"
          title="Add audio track"
        >
          <PlusIcon className="size-4" />
          Audio track
        </button>
        <ZoomControls />
      </div>
      <div
        ref={scrollRef}
        className="scrollbar-thin flex-1 overflow-auto"
        onClick={() => selectClip(null)}
      >
        <div
          data-timeline-surface
          className="relative"
          style={{ width, height: totalHeight }}
        >
          <Ruler duration={duration} />
          {project.tracks.map((track, idx) => (
            <Track
              key={track.id}
              track={track}
              index={trackMeta[idx]?.typeIndex ?? 1}
              removable={
                track.type === 'video'
                  ? videoTrackCount > 1
                  : audioTrackCount > 1
              }
              width={width}
            />
          ))}
          <SnapIndicator totalHeight={totalHeight} />
          <InOutMarkers totalHeight={totalHeight} />
          <Playhead totalHeight={totalHeight} />
        </div>
      </div>
    </div>
  );
}
