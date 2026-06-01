import { useEffect, useRef, useState } from 'react';
import { clipRate } from '../lib/clipRate';
import { clipCssFilter } from '../lib/effects';
import { fadeEnvelope } from '../lib/fadeEnvelope';
import { useTimelineStore } from '../store/useTimelineStore';
import type { VideoClip } from '../types/timeline';

/**
 * Composites V2+ overlay video clips on top of the main preview
 * surface. Mirrors the export filter graph — each active overlay
 * clip mounts its own `<video>` element with positioning from the
 * clip's `transform`, fade via opacity, and color effects via CSS
 * filter.
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
  const urlRef = useRef<string | null>(null);

  // Mount object URL when the source file changes.
  useEffect(() => {
    if (!clip) return;
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
      const video = videoRef.current;
      if (!video) return;
      const state = useTimelineStore.getState();
      const rate = clipRate(clip);
      const local = state.playheadPosition - clip.startOffset;
      const target = clip.trimStart + Math.max(0, local) * rate;
      if (Math.abs(video.currentTime - target) > 0.05) {
        video.currentTime = target;
      }
      if (video.playbackRate !== rate) {
        video.playbackRate = rate;
      }
      if (state.isPlaying && video.paused) {
        void video.play().catch(() => undefined);
      } else if (!state.isPlaying && !video.paused) {
        video.pause();
      }
      // Layer opacity multiplies the user-set PiP opacity with the
      // clip's fade envelope so a half-opaque layer dimmed by a
      // fade composites at the product, matching the export plan.
      const layerOpacity = clip.transform?.opacity ?? 1;
      video.style.opacity = String(
        fadeEnvelope(clip, state.playheadPosition) * layerOpacity,
      );
    };
    sync();
    const unsubP = useTimelineStore.subscribe(
      (s) => s.playheadPosition,
      sync,
    );
    const unsubPlay = useTimelineStore.subscribe((s) => s.isPlaying, sync);
    return () => {
      unsubP();
      unsubPlay();
    };
  }, [clip?.id, clip?.startOffset, clip?.duration, clip?.trimStart, clip]);

  if (!clip) return null;

  const transform = clip.transform;
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

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      preload="auto"
      className="pointer-events-none absolute"
      style={{
        ...positionStyle,
        ...rotateStyle,
        filter: clipCssFilter(clip),
      }}
    />
  );
}
