import { LayoutGridIcon, ListIcon, Music2Icon, VideoIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useVideoThumbnails } from '../hooks/useVideoThumbnails';
import { formatTime } from '../lib/formatTime';
import { useTimelineStore } from '../store/useTimelineStore';
import type { AnyClip, TimelineTrack, VideoClip } from '../types/timeline';

/**
 * Left rail listing every clip in the current project, grouped by
 * track. Clicking a clip selects it and asks the timeline to scroll
 * its start into view. Useful after several splits when the user
 * loses track of how many segments they have and where they live.
 *
 * Listens to the timeline store via narrow selectors so it doesn't
 * re-render on playhead ticks.
 */
type ViewMode = 'list' | 'grid';

export function ClipsSidebar() {
  const project = useTimelineStore((s) => s.currentProject);
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const selectClip = useTimelineStore((s) => s.selectClip);
  const [view, setView] = useState<ViewMode>('list');

  // Compute a display name for each clip: when multiple clips share
  // the same `name` (typical after splits), suffix every duplicate
  // with its index plus its timeline-second start. The map is built
  // off of the (memoized) project ref so it doesn't churn on playhead
  // ticks.
  const displayNames = useMemo(() => {
    const out = new Map<string, string>();
    if (!project) return out;
    const counts = new Map<string, AnyClip[]>();
    for (const t of project.tracks) {
      for (const c of t.clips) {
        const bucket = counts.get(c.name) ?? [];
        bucket.push(c);
        counts.set(c.name, bucket);
      }
    }
    for (const [name, group] of counts) {
      if (group.length === 1) {
        const only = group[0];
        if (only) out.set(only.id, name);
        continue;
      }
      group.sort((a, b) => a.startOffset - b.startOffset);
      group.forEach((clip, i) => {
        out.set(clip.id, `${name} · part ${i + 1} (${formatTime(clip.startOffset, false)})`);
      });
    }
    return out;
  }, [project]);

  if (!project) return null;

  const videoTracks = project.tracks.filter((t) => t.type === 'video');
  const audioTracks = project.tracks.filter((t) => t.type === 'audio');
  const totalClips = project.tracks.reduce(
    (acc, t) => acc + t.clips.length,
    0,
  );

  return (
    <aside className="no-select flex w-60 shrink-0 flex-col border-r border-border bg-panel">
      <header className="flex h-10 items-center justify-between gap-2 border-b border-border px-3 text-[11px] uppercase tracking-wide text-text-muted">
        <span>Clips</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded border border-border bg-chrome p-[2px]">
            <button
              type="button"
              onClick={() => setView('list')}
              aria-pressed={view === 'list'}
              className={
                view === 'list'
                  ? 'rounded-sm bg-panel p-1 text-text-primary'
                  : 'rounded-sm p-1 text-text-muted transition hover:text-text-secondary'
              }
              title="List view"
            >
              <ListIcon className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView('grid')}
              aria-pressed={view === 'grid'}
              className={
                view === 'grid'
                  ? 'rounded-sm bg-panel p-1 text-text-primary'
                  : 'rounded-sm p-1 text-text-muted transition hover:text-text-secondary'
              }
              title="Thumbnail view"
            >
              <LayoutGridIcon className="size-3.5" />
            </button>
          </div>
          <span className="font-mono normal-case tracking-normal text-text-secondary">
            {totalClips}
          </span>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        {totalClips === 0 ? (
          <div className="px-4 py-6 text-[12px] leading-relaxed text-text-muted">
            No clips yet. Import media or drop files into the preview area to
            get started.
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-3">
            {videoTracks.map((track, i) => (
              <TrackSection
                key={track.id}
                track={track}
                label={`V${i + 1}`}
                view={view}
                selectedClipIds={selectedClipIds}
                displayNames={displayNames}
                onSelect={(clip) => handleSelectClip(clip, selectClip)}
              />
            ))}
            {audioTracks.map((track, i) => (
              <TrackSection
                key={track.id}
                track={track}
                label={`A${i + 1}`}
                view={view}
                selectedClipIds={selectedClipIds}
                displayNames={displayNames}
                onSelect={(clip) => handleSelectClip(clip, selectClip)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function handleSelectClip(
  clip: AnyClip,
  selectClip: (id: string | null) => void,
): void {
  selectClip(clip.id);
  window.dispatchEvent(
    new CustomEvent('timeline:scroll-to-time', {
      detail: { seconds: clip.startOffset },
    }),
  );
}

function TrackSection({
  track,
  label,
  view,
  selectedClipIds,
  displayNames,
  onSelect,
}: {
  track: TimelineTrack;
  label: string;
  view: ViewMode;
  selectedClipIds: string[];
  displayNames: Map<string, string>;
  onSelect: (clip: AnyClip) => void;
}) {
  if (track.clips.length === 0) return null;
  const Icon = track.type === 'video' ? VideoIcon : Music2Icon;
  const sorted = [...track.clips].sort(
    (a, b) => a.startOffset - b.startOffset,
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 px-3 text-[11px] font-medium uppercase tracking-wide text-text-muted">
        <Icon className="size-3.5" />
        <span>{label}</span>
        <span className="font-mono normal-case tracking-normal text-text-secondary">
          · {track.clips.length}
        </span>
      </div>
      {view === 'list' ? (
        <ul className="flex flex-col">
          {sorted.map((clip) => (
            <ListRow
              key={clip.id}
              clip={clip}
              display={displayNames.get(clip.id) ?? clip.name}
              selected={selectedClipIds.includes(clip.id)}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : (
        <div className="grid grid-cols-2 gap-2 px-3">
          {sorted.map((clip) => (
            <GridTile
              key={clip.id}
              clip={clip}
              display={displayNames.get(clip.id) ?? clip.name}
              selected={selectedClipIds.includes(clip.id)}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ListRow({
  clip,
  display,
  selected,
  onSelect,
}: {
  clip: AnyClip;
  display: string;
  selected: boolean;
  onSelect: (clip: AnyClip) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(clip)}
        className={
          selected
            ? 'flex w-full items-center justify-between gap-2 border-l-2 border-accent bg-accent/15 px-3 py-1.5 text-left transition'
            : 'flex w-full items-center justify-between gap-2 border-l-2 border-transparent px-3 py-1.5 text-left transition hover:bg-chrome'
        }
        title={`${display} · ${formatTime(clip.duration, false)} @ ${formatTime(clip.startOffset, false)}`}
      >
        <span className="min-w-0 flex-1 truncate text-[12px] text-text-primary">
          {display}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-muted">
          {formatTime(clip.duration, false)}
        </span>
      </button>
    </li>
  );
}

function GridTile({
  clip,
  display,
  selected,
  onSelect,
}: {
  clip: AnyClip;
  display: string;
  selected: boolean;
  onSelect: (clip: AnyClip) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(clip)}
      className={
        selected
          ? 'flex flex-col gap-1 rounded-md border-2 border-accent bg-accent/10 p-1 text-left transition'
          : 'flex flex-col gap-1 rounded-md border-2 border-transparent p-1 text-left transition hover:bg-chrome'
      }
      title={`${display} · ${formatTime(clip.duration, false)} @ ${formatTime(clip.startOffset, false)}`}
    >
      <div className="relative aspect-video w-full overflow-hidden rounded bg-black">
        {clip.kind === 'video' ? (
          <ClipPreviewThumbnail clip={clip} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-clip-audio-strong">
            <Music2Icon className="size-6" />
          </div>
        )}
        <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-[1px] font-mono text-[9px] tabular-nums text-white">
          {formatTime(clip.duration, false)}
        </span>
      </div>
      <span className="truncate text-[11px] text-text-primary" title={display}>
        {display}
      </span>
    </button>
  );
}

function ClipPreviewThumbnail({ clip }: { clip: VideoClip }) {
  const thumbs = useVideoThumbnails(clip.file);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !thumbs || thumbs.bitmaps.length === 0) return;
    // Pick the bitmap closest to the clip's trim-start so a split's
    // first frame is what the tile shows. Cheaper than re-decoding
    // since we just draw from the existing strip cache.
    const sourceFrac =
      clip.sourceDuration > 0 ? clip.trimStart / clip.sourceDuration : 0;
    const idx = Math.max(
      0,
      Math.min(
        thumbs.bitmaps.length - 1,
        Math.floor(sourceFrac * thumbs.bitmaps.length),
      ),
    );
    const bitmap = thumbs.bitmaps[idx];
    if (!bitmap) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(bitmap, 0, 0, rect.width, rect.height);
  }, [thumbs, clip.trimStart, clip.sourceDuration]);

  return <canvas ref={canvasRef} className="h-full w-full" />;
}
