import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { clipRate } from '../lib/clipRate';
import { clipCssFilter } from '../lib/effects';
import { fadeEnvelope } from '../lib/fadeEnvelope';
import { mediaRateFactor, mediaShouldPlay } from '../lib/shuttle';
import { pipTransformAt } from '../lib/motion';
import { stillUrl } from '../lib/stills';
import { sourceTimeAt } from '../lib/zoomPan';
import { useTimelineStore } from '../store/useTimelineStore';
import type { VideoClip } from '../types/timeline';

/**
 * Composites V2+ overlay video clips on top of the main preview
 * surface. Mirrors the export filter graph — each active overlay
 * clip mounts its own `<video>` element with positioning from the
 * clip's `transform`, fade via opacity, and color effects via CSS
 * filter.
 *
 * A layer with a PiP transform can be dragged to move it, and resized
 * from its bottom-right handle while selected. Full-frame layers (no
 * transform) stay click-through so they don't swallow the preview.
 *
 * Mute is locked on: V2+ audio doesn't flow into the master mix
 * yet (see filterGraph), so the preview must match.
 *
 * The active set is recomputed on every playhead tick but only
 * pushed to React state when the set of ids actually changes —
 * scrubbing through the middle of a clip's lifetime doesn't
 * re-render the whole layer.
 */
export function PreviewOverlayLayer() {
  const [activeIds, setActiveIds] = useState<string[]>([]);

  useEffect(() => {
    const update = () => {
      const state = useTimelineStore.getState();
      const project = state.currentProject;
      if (!project) {
        setActiveIds((prev) => (prev.length === 0 ? prev : []));
        return;
      }
      const playhead = state.playheadPosition;
      const videoTracks = project.tracks.filter((t) => t.type === 'video');
      const overlayTracks = videoTracks.slice(1);
      const next: string[] = [];
      for (const track of overlayTracks) {
        for (const c of track.clips) {
          if (c.kind !== 'video') continue;
          if (
            playhead >= c.startOffset &&
            playhead < c.startOffset + c.duration
          ) {
            next.push(c.id);
          }
        }
      }
      setActiveIds((prev) => {
        if (
          prev.length === next.length &&
          prev.every((id, i) => id === next[i])
        ) {
          return prev;
        }
        return next;
      });
    };
    update();
    const unsubP = useTimelineStore.subscribe(
      (s) => s.playheadPosition,
      update,
    );
    const unsubProj = useTimelineStore.subscribe(
      (s) => s.currentProject,
      update,
    );
    return () => {
      unsubP();
      unsubProj();
    };
  }, []);

  return (
    <>
      {activeIds.map((id) => (
        <PreviewOverlayClip key={id} clipId={id} />
      ))}
    </>
  );
}

function PreviewOverlayClip({ clipId }: { clipId: string }) {
  // Pull the current clip from the store. The selector re-runs
  // when the project ref changes, so transform/effect/trim edits
  // in PropertiesPanel propagate naturally.
  const clip = useTimelineStore((s): VideoClip | null => {
    if (!s.currentProject) return null;
    for (const t of s.currentProject.tracks) {
      for (const c of t.clips) {
        if (c.id === clipId && c.kind === 'video') return c;
      }
    }
    return null;
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef<string | null>(null);
  const selected = useTimelineStore((s) => s.selectedClipIds.includes(clipId));
  const dragRef = useRef<{
    mode: 'move' | 'scale';
    pointerX: number;
    pointerY: number;
    origin: { x: number; y: number; scale: number };
    frameW: number;
    frameH: number;
  } | null>(null);

  const beginDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    mode: 'move' | 'scale',
  ) => {
    const playhead = useTimelineStore.getState().playheadPosition;
    // Start from what's on screen — the sampled value if animated.
    const t = clip ? pipTransformAt(clip, sourceTimeAt(clip, playhead)) : undefined;
    const frame = (e.currentTarget.closest('[data-pip-layer]') as HTMLElement | null)
      ?.parentElement;
    if (!clip || !t || !frame || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = frame.getBoundingClientRect();
    dragRef.current = {
      mode,
      pointerX: e.clientX,
      pointerY: e.clientY,
      origin: { x: t.x, y: t.y, scale: t.scale },
      frameW: rect.width,
      frameH: rect.height,
    };
    useTimelineStore.getState().selectClip(clip.id);
  };
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || !clip) return;
    const dx = (e.clientX - d.pointerX) / d.frameW;
    const dy = (e.clientY - d.pointerY) / d.frameH;
    // The store clamps x / y / scale into the frame, and keyframes
    // the change at the playhead when the layer is animated.
    useTimelineStore
      .getState()
      .editPipTransform(
        clip.id,
        d.mode === 'move'
          ? { x: d.origin.x + dx, y: d.origin.y + dy }
          : { scale: d.origin.scale + dx },
      );
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };

  // Mount object URL when the source file changes. Stills use the
  // shared `stillUrl` cache via the <img> src instead.
  useEffect(() => {
    if (!clip || clip.still) return;
    const url = URL.createObjectURL(clip.file);
    urlRef.current = url;
    const video = videoRef.current;
    if (video) video.src = url;
    return () => {
      URL.revokeObjectURL(url);
      urlRef.current = null;
    };
  }, [clip?.file]);

  // Sync currentTime / playbackRate / opacity / play-pause to the
  // playhead imperatively. Subscribing instead of re-rendering on
  // every playhead tick keeps the overlay path 60fps-safe.
  useEffect(() => {
    if (!clip) return;
    const sync = () => {
      const state = useTimelineStore.getState();
      const layerOpacity = clip.transform?.opacity ?? 1;
      const opacity = String(
        fadeEnvelope(clip, state.playheadPosition) * layerOpacity,
      );
      // Keyframed motion: place the layer for this instant.
      const layer = layerRef.current;
      if (layer && clip.transform) {
        const tr = pipTransformAt(clip, sourceTimeAt(clip, state.playheadPosition))!;
        layer.style.left = `${tr.x * 100}%`;
        layer.style.top = `${tr.y * 100}%`;
        layer.style.width = `${tr.scale * 100}%`;
        layer.style.transform = tr.rotation ? `rotate(${tr.rotation}deg)` : '';
      }
      if (clip.still) {
        // Nothing to seek or play — only the fade envelope moves.
        if (imgRef.current) imgRef.current.style.opacity = opacity;
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      const rate = clipRate(clip);
      const local = state.playheadPosition - clip.startOffset;
      const target = clip.trimStart + Math.max(0, local) * rate;
      if (Math.abs(video.currentTime - target) > 0.05) {
        video.currentTime = target;
      }
      const playRate = rate * mediaRateFactor(state);
      if (video.playbackRate !== playRate) {
        video.playbackRate = playRate;
      }
      const shouldPlay = mediaShouldPlay(state);
      if (shouldPlay && video.paused) {
        void video.play().catch(() => undefined);
      } else if (!shouldPlay && !video.paused) {
        video.pause();
      }
      // Layer opacity multiplies the user-set PiP opacity with the
      // clip's fade envelope so a half-opaque layer dimmed by a
      // fade composites at the product, matching the export plan.
      video.style.opacity = opacity;
    };
    sync();
    const unsubP = useTimelineStore.subscribe(
      (s) => s.playheadPosition,
      sync,
    );
    const unsubPlay = useTimelineStore.subscribe((s) => s.isPlaying, sync);
    const unsubShuttle = useTimelineStore.subscribe((s) => s.shuttleSpeed, sync);
    return () => {
      unsubP();
      unsubPlay();
      unsubShuttle();
    };
  }, [clip?.id, clip?.startOffset, clip?.duration, clip?.trimStart, clip]);

  if (!clip) return null;

  // Animated layers are re-placed every tick by `sync`; this is the
  // value at the current playhead so the first paint is right too.
  const transform = pipTransformAt(
    clip,
    sourceTimeAt(clip, useTimelineStore.getState().playheadPosition),
  );
  const positionStyle: React.CSSProperties = transform
    ? {
        left: `${transform.x * 100}%`,
        top: `${transform.y * 100}%`,
        width: `${transform.scale * 100}%`,
        height: 'auto',
      }
    : {
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'contain',
      };
  // Rotate around the layer's own center. `transform-origin: center`
  // is the CSS default for elements with width/height set, so a
  // single `rotate()` is enough.
  const rotation = transform?.rotation;
  const rotateStyle: React.CSSProperties =
    rotation !== undefined && rotation !== 0
      ? { transform: `rotate(${rotation}deg)`, transformOrigin: 'center' }
      : {};

  const filter = clipCssFilter(clip);
  if (!transform) {
    return clip.still ? (
      <img
        ref={imgRef}
        alt=""
        src={stillUrl(clip.file)}
        className="pointer-events-none absolute"
        style={{ ...positionStyle, filter }}
      />
    ) : (
      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        className="pointer-events-none absolute"
        style={{ ...positionStyle, filter }}
      />
    );
  }

  return (
    <div
      ref={layerRef}
      data-pip-layer
      onPointerDown={(e) => beginDrag(e, 'move')}
      onPointerMove={onDragMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={clsx(
        'pointer-events-auto absolute cursor-move',
        selected && 'outline outline-2 outline-offset-0 outline-accent',
      )}
      style={{ ...positionStyle, ...rotateStyle }}
      title="Drag to move · corner handle to resize"
    >
      {clip.still ? (
        <img
          ref={imgRef}
          alt=""
          draggable={false}
          src={stillUrl(clip.file)}
          className="block h-auto w-full"
          style={{ filter }}
        />
      ) : (
        <video
          ref={videoRef}
          muted
          playsInline
          preload="auto"
          className="block h-auto w-full"
          style={{ filter }}
        />
      )}
      {selected ? (
        <div
          onPointerDown={(e) => beginDrag(e, 'scale')}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-sm border border-white bg-accent"
          title="Drag to resize"
        />
      ) : null}
    </div>
  );
}
