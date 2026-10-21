import clsx from 'clsx';
import {
  BrushCleaningIcon,
  Music2Icon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useVideoThumbnails } from '../hooks/useVideoThumbnails';
import { triggerMediaPicker } from '../lib/filePickers';
import { formatTime } from '../lib/formatTime';
import { importFilesToLibrary } from '../lib/importMedia';
import { mediaUsage } from '../lib/timelineOps';
import { useTimelineStore } from '../store/useTimelineStore';
import { useTimelineViewStore } from '../store/useTimelineViewStore';
import type { MediaAsset } from '../types/timeline';

/** dataTransfer type carrying a library asset id onto a timeline track. */
export const MEDIA_DRAG_TYPE = 'application/x-video-editor-media';

/**
 * The project's media library ("Media Bin" in Camtasia, "Project
 * panel" in Premiere). Imported files land here; the timeline only
 * holds clips that reference them.
 *
 *   - Drag an item onto a track, or press + to add it at the playhead.
 *   - Click an item to select every timeline clip that uses it.
 *   - Double-click the name to rename.
 *   - Drop files from the OS anywhere on the panel to import them.
 */
export function MediaLibrary() {
  const media = useTimelineStore((s) => s.currentProject?.media);
  const tracks = useTimelineStore((s) => s.currentProject?.tracks);
  const removeUnusedMedia = useTimelineStore((s) => s.removeUnusedMedia);
  const [dropActive, setDropActive] = useState(false);
  const [importing, setImporting] = useState(false);

  const usage = useMemo(
    () => (tracks ? mediaUsage({ tracks }) : new Map<string, number>()),
    [tracks],
  );

  if (!media) return null;
  const unusedCount = media.filter((m) => !usage.has(m.id)).length;
  const sorted = [...media].sort((a, b) => a.importedAt - b.importedAt);

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  };
  const onDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDropActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    setImporting(true);
    try {
      await importFilesToLibrary(files);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className={clsx(
        'flex min-h-0 flex-1 flex-col',
        dropActive && 'bg-accent/10 ring-2 ring-inset ring-accent',
      )}
      onDragOver={onDragOver}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      <header className="flex h-10 items-center justify-between gap-2 border-b border-border px-3 text-[11px] uppercase tracking-wide text-text-muted">
        <span>Media</span>
        <div className="flex items-center gap-1">
          {unusedCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    `Remove ${unusedCount} unused item${unusedCount === 1 ? '' : 's'} from the library?`,
                  )
                ) {
                  removeUnusedMedia();
                }
              }}
              className="rounded p-1 text-text-muted transition hover:bg-chrome hover:text-text-primary"
              title={`Remove ${unusedCount} unused`}
            >
              <BrushCleaningIcon className="size-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => triggerMediaPicker()}
            disabled={importing}
            className="rounded p-1 text-text-muted transition hover:bg-chrome hover:text-text-primary disabled:opacity-40"
            title="Import media…"
          >
            <UploadIcon className="size-3.5" />
          </button>
          <span className="font-mono normal-case tracking-normal text-text-secondary">
            {media.length}
          </span>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        {media.length === 0 ? (
          <div className="px-4 py-6 text-[12px] leading-relaxed text-text-muted">
            {importing
              ? 'Importing…'
              : 'No media yet. Import files or drop them here, then drag them onto the timeline.'}
          </div>
        ) : (
          <ul className="flex flex-col py-1">
            {sorted.map((asset) => (
              <MediaRow
                key={asset.id}
                asset={asset}
                uses={usage.get(asset.id) ?? 0}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MediaRow({ asset, uses }: { asset: MediaAsset; uses: number }) {
  const insertMediaClip = useTimelineStore((s) => s.insertMediaClip);
  const removeMediaAsset = useTimelineStore((s) => s.removeMediaAsset);
  const renameMediaAsset = useTimelineStore((s) => s.renameMediaAsset);
  const highlighted = useTimelineViewStore(
    (s) => s.highlightedMediaId === asset.id,
  );
  const [renaming, setRenaming] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!highlighted) return;
    rowRef.current?.scrollIntoView({ block: 'nearest' });
    const id = window.setTimeout(
      () => useTimelineViewStore.getState().revealMedia(null),
      1500,
    );
    return () => window.clearTimeout(id);
  }, [highlighted]);

  const selectUses = () => {
    const s = useTimelineStore.getState();
    const clips = (s.currentProject?.tracks ?? []).flatMap((t) =>
      t.clips.filter((c) => c.mediaId === asset.id),
    );
    s.setSelectedClipIds(clips.map((c) => c.id));
    const first = clips.reduce<number | null>(
      (min, c) => (min === null || c.startOffset < min ? c.startOffset : min),
      null,
    );
    if (first !== null) {
      window.dispatchEvent(
        new CustomEvent('timeline:scroll-to-time', { detail: { seconds: first } }),
      );
    }
  };

  const addAtPlayhead = () => {
    const playhead = useTimelineStore.getState().playheadPosition;
    const id = insertMediaClip(asset.id, { startOffset: playhead });
    if (!id) return;
    const clip = useTimelineStore
      .getState()
      .currentProject?.tracks.flatMap((t) => t.clips)
      .find((c) => c.id === id);
    if (clip) {
      window.dispatchEvent(
        new CustomEvent('timeline:scroll-to-time', {
          detail: { seconds: clip.startOffset },
        }),
      );
    }
  };

  const remove = () => {
    if (
      uses > 0 &&
      !window.confirm(
        `"${asset.name}" is used by ${uses} clip${uses === 1 ? '' : 's'} on the timeline. Remove it and those clips?`,
      )
    ) {
      return;
    }
    removeMediaAsset(asset.id);
  };

  return (
    <li
      ref={rowRef}
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData(MEDIA_DRAG_TYPE, asset.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={selectUses}
      className={clsx(
        'group flex cursor-grab items-center gap-2 px-3 py-1.5 transition hover:bg-chrome active:cursor-grabbing',
        highlighted && 'bg-accent/20',
      )}
      title={`${asset.name} · ${formatTime(asset.duration, false)}`}
    >
      <div className="relative h-9 w-16 shrink-0 overflow-hidden rounded bg-black">
        {asset.kind === 'video' ? (
          <AssetThumbnail file={asset.file} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-clip-audio-strong">
            <Music2Icon className="size-4" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {renaming ? (
          <input
            autoFocus
            defaultValue={asset.name}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              renameMediaAsset(asset.id, e.currentTarget.value);
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
            className="w-full rounded border border-accent bg-panel-elevated px-1 text-[12px] text-text-primary outline-none"
          />
        ) : (
          <div
            className="truncate text-[12px] text-text-primary"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
          >
            {asset.name}
          </div>
        )}
        <div className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-text-muted">
          <span>{formatTime(asset.duration, false)}</span>
          <span>·</span>
          <span className={uses === 0 ? 'italic' : undefined}>
            {uses === 0 ? 'unused' : `used ×${uses}`}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            addAtPlayhead();
          }}
          className="rounded p-1 text-text-muted hover:bg-panel hover:text-text-primary"
          title="Add to timeline at playhead"
        >
          <PlusIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            remove();
          }}
          className="rounded p-1 text-text-muted hover:bg-panel hover:text-danger"
          title="Remove from library"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

function AssetThumbnail({ file }: { file: File }) {
  const thumbs = useVideoThumbnails(file);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const bitmap = thumbs?.bitmaps[0];
    if (!canvas || !bitmap) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(bitmap, 0, 0, rect.width, rect.height);
  }, [thumbs]);

  return <canvas ref={canvasRef} className="h-full w-full" />;
}
