import { FilmIcon, UploadIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { routeMediaElement } from '../lib/audioGraph';
import { clipRate } from '../lib/clipRate';
import { clipCssFilter } from '../lib/effects';
import { fadeEnvelope } from '../lib/fadeEnvelope';
import { triggerMediaPicker } from '../lib/filePickers';
import { findActiveVideoClip } from '../lib/projectMetrics';
import { useTimelineStore } from '../store/useTimelineStore';
import { useTimelineViewStore } from '../store/useTimelineViewStore';
import { PreviewOverlayLayer } from './PreviewOverlayLayer';
import type {
  TextOverlay,
  VideoClip,
  VideoProject,
} from '../types/timeline';

interface SourceRef {
  clipId: string;
  url: string;
}

interface CrossfadePartner {
  clip: VideoClip;
  freezeTime: number;
}

/**
 * Mounts a single `<video>` element and keeps it synchronized to
 * the timeline imperatively. Subscribing to `playheadPosition`,
 * `isPlaying`, and `currentProject` via `useTimelineStore.subscribe`
 * (rather than as React state) means scrubbing at 60fps doesn't
 * trigger a React render — only DOM mutations on the video element.
 *
 * Source swapping: when the active clip changes, we revoke the
 * previous object URL before allocating a new one. Object URLs leak
 * memory until explicitly revoked, and a long editing session can
 * churn dozens of source files.
 *
 * Text overlays render on top of the `<video>` via a separate React
 * subtree. Active set is recomputed from playhead + overlays, and
 * font sizes scale from project resolution down to the canvas's
 * real pixel size (tracked with ResizeObserver).
 */
export function Preview() {
  // Main element: the active clip, played in real time.
  // Aux element: a frozen frame from the *neighbor* clip across a
  // fade boundary — the previous clip's last frame during the
  // current clip's fade-in, or the next clip's first frame during
  // fade-out. Both elements live in the same composited space so
  // crossfades render as a real cross-blend instead of "fade to
  // black, then fade in."
  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const auxVideoRef = useRef<HTMLVideoElement>(null);
  const mainSourceRef = useRef<SourceRef | null>(null);
  const auxSourceRef = useRef<SourceRef | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  // Publish the rendered video-frame width so the Transport bar
  // can mirror it. ResizeObserver fires on initial mount + every
  // layout change (window resize, sidebar toggle, etc.).
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      useTimelineViewStore
        .getState()
        .setPreviewContentWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const main = mainVideoRef.current;
    if (main) {
      // Pipe the main preview's audio through the shared Web Audio
      // graph so the master AnalyserNode sees it (the StatusBar
      // meter reads from that analyser). The call is idempotent.
      routeMediaElement(main);
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      const main = mainVideoRef.current;
      const aux = auxVideoRef.current;
      if (!main || !aux) return;
      const state = useTimelineStore.getState();
      const project = state.currentProject;
      if (!project) {
        releaseSource(main, mainSourceRef);
        releaseSource(aux, auxSourceRef);
        return;
      }

      const active = findActiveVideoClip(project, state.playheadPosition);
      if (!active) {
        if (!main.paused) main.pause();
        releaseSource(aux, auxSourceRef);
        main.style.opacity = '0';
        aux.style.opacity = '0';
        return;
      }

      updateActiveVideo(main, mainSourceRef, active, state);
      main.style.filter = clipCssFilter(active);

      const partner = findCrossfadePartner(
        project,
        active,
        state.playheadPosition,
      );
      const mainOpacity = fadeEnvelope(active, state.playheadPosition);
      main.style.opacity = String(mainOpacity);

      if (partner) {
        renderAuxFreeze(aux, auxSourceRef, partner);
        aux.style.filter = clipCssFilter(partner.clip);
        aux.style.opacity = String(1 - mainOpacity);
      } else {
        // No crossfade right now — keep the aux source mounted but
        // hidden. Releasing on every clip change churns object URLs
        // and forces a re-decode the next time we cross a fade.
        aux.style.opacity = '0';
      }
    };

    const unsubPlayhead = useTimelineStore.subscribe(
      (s) => s.playheadPosition,
      sync,
    );
    const unsubPlaying = useTimelineStore.subscribe((s) => s.isPlaying, sync);
    const unsubProject = useTimelineStore.subscribe(
      (s) => s.currentProject,
      sync,
    );
    sync();

    return () => {
      unsubPlayhead();
      unsubPlaying();
      unsubProject();
      if (mainSourceRef.current) URL.revokeObjectURL(mainSourceRef.current.url);
      if (auxSourceRef.current) URL.revokeObjectURL(auxSourceRef.current.url);
      mainSourceRef.current = null;
      auxSourceRef.current = null;
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-canvas p-6">
      <div
        ref={frameRef}
        className="relative flex aspect-video max-h-full max-w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-black shadow-xl"
      >
        {/* Aux layer underneath — the freeze-frame from the
            neighbor clip on the other side of the fade boundary. */}
        <video
          ref={auxVideoRef}
          className="absolute inset-0 h-full w-full bg-black"
          playsInline
          preload="auto"
          muted
          style={{ opacity: 0 }}
        />
        <video
          ref={mainVideoRef}
          className="relative h-full w-full bg-transparent"
          playsInline
          preload="auto"
        />
        <PreviewOverlayLayer />
        <PreviewEmptyOverlay />
        <PreviewOverlays />
      </div>
    </div>
  );
}

function updateActiveVideo(
  video: HTMLVideoElement,
  sourceRef: React.MutableRefObject<SourceRef | null>,
  active: VideoClip,
  state: ReturnType<typeof useTimelineStore.getState>,
): void {
  if (sourceRef.current?.clipId !== active.id) {
    if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
    const url = URL.createObjectURL(active.file);
    sourceRef.current = { clipId: active.id, url };
    video.src = url;
  }

  const rate = clipRate(active);
  // Local timeline → source time: multiply by rate so a slow-mo
  // clip pulls its source frames slower than wall-clock and a
  // fast clip pulls them faster.
  const targetTime =
    active.trimStart + (state.playheadPosition - active.startOffset) * rate;
  if (Math.abs(video.currentTime - targetTime) > 0.05) {
    video.currentTime = targetTime;
  }
  if (video.playbackRate !== rate) {
    video.playbackRate = rate;
  }

  if (state.isPlaying && video.paused) {
    video.play().catch(() => undefined);
  } else if (!state.isPlaying && !video.paused) {
    video.pause();
  }
}

function renderAuxFreeze(
  video: HTMLVideoElement,
  sourceRef: React.MutableRefObject<SourceRef | null>,
  partner: CrossfadePartner,
): void {
  if (sourceRef.current?.clipId !== partner.clip.id) {
    if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
    const url = URL.createObjectURL(partner.clip.file);
    sourceRef.current = { clipId: partner.clip.id, url };
    video.src = url;
  }
  if (Math.abs(video.currentTime - partner.freezeTime) > 0.05) {
    video.currentTime = partner.freezeTime;
  }
  // The aux always stays paused — it's a single-frame poster, not
  // a playing source. Sound comes from the main element only.
  if (!video.paused) video.pause();
}

function releaseSource(
  video: HTMLVideoElement,
  sourceRef: React.MutableRefObject<SourceRef | null>,
): void {
  if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
  sourceRef.current = null;
  video.removeAttribute('src');
  video.load();
}

/**
 * Pick the neighbor clip (and its freeze frame) to render in the
 * aux layer for the current playhead.
 *
 *   - In `active`'s fadeIn window, return the previous clip's
 *     trim-end frame, so it appears to dissolve outward.
 *   - In `active`'s fadeOut window, return the next clip's
 *     trim-start frame, so it appears to dissolve in.
 *   - Otherwise return null.
 *
 * Only `kind: 'video'` clips are considered — audio neighbors don't
 * contribute a picture.
 */
function findCrossfadePartner(
  project: VideoProject,
  active: VideoClip,
  playhead: number,
): CrossfadePartner | null {
  const local = playhead - active.startOffset;
  if (active.fadeIn > 0 && local < active.fadeIn) {
    const prev = findPreviousVideoClip(project, active);
    if (prev) {
      // Pull back a hair from the absolute end so codecs that
      // can't seek to t=duration exactly still produce a real frame.
      const freezeTime = Math.max(prev.trimStart, prev.trimEnd - 0.04);
      return { clip: prev, freezeTime };
    }
  }
  if (active.fadeOut > 0 && local > active.duration - active.fadeOut) {
    const next = findNextVideoClip(project, active);
    if (next) {
      return { clip: next, freezeTime: next.trimStart };
    }
  }
  return null;
}

function findPreviousVideoClip(
  project: VideoProject,
  current: VideoClip,
): VideoClip | null {
  let best: VideoClip | null = null;
  for (const track of project.tracks) {
    if (track.type !== 'video') continue;
    for (const c of track.clips) {
      if (c.kind !== 'video' || c.id === current.id) continue;
      if (c.startOffset + c.duration <= current.startOffset + 0.05) {
        if (!best || c.startOffset > best.startOffset) {
          best = c;
        }
      }
    }
  }
  return best;
}

function findNextVideoClip(
  project: VideoProject,
  current: VideoClip,
): VideoClip | null {
  let best: VideoClip | null = null;
  const currentEnd = current.startOffset + current.duration;
  for (const track of project.tracks) {
    if (track.type !== 'video') continue;
    for (const c of track.clips) {
      if (c.kind !== 'video' || c.id === current.id) continue;
      if (c.startOffset >= currentEnd - 0.05) {
        if (!best || c.startOffset < best.startOffset) {
          best = c;
        }
      }
    }
  }
  return best;
}

/**
 * Sits behind the `<video>` element and only shows when no video
 * clip is active (no project, or playhead in a gap). Avoids tearing
 * the video element down on transitions through gaps during playback.
 */
function PreviewEmptyOverlay() {
  const hasProject = useTimelineStore((s) => s.currentProject !== null);
  const hasClips = useTimelineStore((s) => {
    const p = s.currentProject;
    if (!p) return false;
    return p.tracks.some((t) => t.clips.length > 0);
  });

  if (hasProject && hasClips) return null;

  // With a project open, this entire area becomes the click target
  // for the file picker. Without a project there's nothing to
  // import into, so we leave the overlay non-interactive.
  if (!hasProject) {
    return (
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-muted">
        <FilmIcon className="size-10 opacity-60" />
        <span className="text-[14px]">Create a project to begin</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={triggerMediaPicker}
      className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 bg-transparent text-text-muted transition hover:bg-chrome/40 hover:text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      title="Import media (click anywhere)"
    >
      <FilmIcon className="size-10 opacity-60" />
      <span className="text-[14px]">Import media to begin</span>
      <span className="flex items-center gap-1.5 rounded-md border border-border bg-panel px-3 py-1.5 text-[12px] text-text-primary shadow-sm">
        <UploadIcon className="size-3.5" />
        Import…
      </span>
    </button>
  );
}

/**
 * Renders any text overlays whose time range contains the current
 * playhead. Font size scales from the project's logical pixel size
 * (1920×1080) down to the canvas's actual rendered size — tracked
 * via ResizeObserver — so what the user sees here matches what
 * `drawOverlayPNG` rasterizes at export time.
 */
function PreviewOverlays() {
  const project = useTimelineStore((s) => s.currentProject);
  const [playhead, setPlayhead] = useState(
    () => useTimelineStore.getState().playheadPosition,
  );

  useEffect(() => {
    return useTimelineStore.subscribe((s) => s.playheadPosition, setPlayhead);
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || !project) return;
      const { width } = entry.contentRect;
      setScale(width / project.resolution.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [project]);

  if (!project) return null;

  const active = activeOverlays(project, playhead);

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0">
      {active.map((overlay) => (
        <DraggableOverlay
          key={overlay.id}
          overlay={overlay}
          containerRef={containerRef}
          scale={scale}
        />
      ))}
    </div>
  );
}

interface DragRef {
  pointerX: number;
  pointerY: number;
  originX: number;
  originY: number;
  rectWidth: number;
  rectHeight: number;
  moved: boolean;
}

function DraggableOverlay({
  overlay,
  containerRef,
  scale,
}: {
  overlay: TextOverlay;
  containerRef: React.RefObject<HTMLDivElement | null>;
  scale: number;
}) {
  const selectedOverlayId = useTimelineStore((s) => s.selectedOverlayId);
  const selectOverlay = useTimelineStore((s) => s.selectOverlay);
  const updateOverlay = useTimelineStore((s) => s.updateOverlay);
  const dragRef = useRef<DragRef | null>(null);
  const [dragging, setDragging] = useState(false);
  const selected = selectedOverlayId === overlay.id;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    dragRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      originX: overlay.style.position.x,
      originY: overlay.style.position.y,
      rectWidth: rect.width,
      rectHeight: rect.height,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    selectOverlay(overlay.id);
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dxPx = e.clientX - drag.pointerX;
    const dyPx = e.clientY - drag.pointerY;
    if (!drag.moved && Math.hypot(dxPx, dyPx) > 2) drag.moved = true;
    const nextX = Math.max(0, Math.min(1, drag.originX + dxPx / drag.rectWidth));
    const nextY = Math.max(0, Math.min(1, drag.originY + dyPx / drag.rectHeight));
    updateOverlay(overlay.id, {
      style: {
        ...overlay.style,
        position: { x: nextX, y: nextY },
      },
    });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`pointer-events-auto absolute select-none whitespace-pre ${
        dragging ? 'cursor-grabbing' : 'cursor-move'
      } ${
        selected
          ? 'outline outline-2 outline-offset-2 outline-accent'
          : ''
      }`}
      style={{
        left: `${overlay.style.position.x * 100}%`,
        top: `${overlay.style.position.y * 100}%`,
        color: overlay.style.color,
        fontSize: `${overlay.style.size * scale}px`,
        lineHeight: 1.1,
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        fontWeight: 600,
        textShadow: '0 2px 8px rgba(0,0,0,0.6)',
      }}
    >
      {overlay.text}
    </div>
  );
}

function activeOverlays(
  project: VideoProject,
  playhead: number,
): TextOverlay[] {
  return project.overlays.filter(
    (o) => playhead >= o.startOffset && playhead < o.startOffset + o.duration,
  );
}
