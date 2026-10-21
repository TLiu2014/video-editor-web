import { FilmIcon, UploadIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { routeMediaElement } from '../lib/audioGraph';
import { clipRate } from '../lib/clipRate';
import { clipCssFilter } from '../lib/effects';
import { fadeEnvelope } from '../lib/fadeEnvelope';
import { isTrackAudible } from '../lib/trackAudibility';
import { triggerMediaPicker } from '../lib/filePickers';
import { findActiveVideoClip } from '../lib/projectMetrics';
import {
  drawShape,
  effectiveOverlayFades,
  isTextOverlay,
  SHAPE_LABELS,
  shapePixelBounds,
} from '../lib/shapes';
import { stillUrl } from '../lib/stills';
import { transitionAt } from '../lib/transitions';
import { useTimelineStore } from '../store/useTimelineStore';
import { useTimelineViewStore } from '../store/useTimelineViewStore';
import { PreviewOverlayLayer } from './PreviewOverlayLayer';
import type {
  AnyOverlay,
  ShapeOverlay,
  TextOverlay,
  TransitionKind,
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
  // Still-image clips render through these instead of the videos;
  // each sits directly above its video in the same composited space.
  const mainImgRef = useRef<HTMLImageElement>(null);
  const auxImgRef = useRef<HTMLImageElement>(null);
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
      const mainImg = mainImgRef.current;
      const auxImg = auxImgRef.current;
      if (!main || !aux || !mainImg || !auxImg) return;
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
        mainImg.style.opacity = '0';
        auxImg.style.opacity = '0';
        return;
      }

      // `front` is whichever element shows the active clip.
      let front: HTMLElement;
      if (active.still) {
        if (!main.paused) main.pause();
        main.style.opacity = '0';
        showStill(mainImg, active);
        front = mainImg;
      } else {
        mainImg.style.opacity = '0';
        updateActiveVideo(main, mainSourceRef, active, state);
        // Same audibility rules as the export: only V1 clips that have
        // audio, on an audible track (mute / solo), are heard, and the
        // clip's fades ramp the sound like `afade`.
        const host = project.tracks.find((t) =>
          t.clips.some((c) => c.id === active.id),
        );
        const base = project.tracks.find((t) => t.type === 'video');
        const audible =
          !!host &&
          host === base &&
          active.hasAudio &&
          isTrackAudible(host, project.tracks);
        main.muted = !audible;
        main.volume = audible ? fadeEnvelope(active, state.playheadPosition) : 0;
        front = main;
      }
      front.style.filter = clipCssFilter(active);

      for (const el of [main, aux, mainImg, auxImg]) {
        el.style.clipPath = '';
        el.style.transform = '';
      }
      const mainOpacity = fadeEnvelope(active, state.playheadPosition);
      front.style.opacity = String(mainOpacity);

      // A transition window around a V1 cut: show the other clip of
      // the pair behind the active one (as a held frame) and composite
      // the two the way the export's `xfade` does. Plain fades no
      // longer cross-blend here — like the export, they go to black.
      const t = transitionAt(project, state.playheadPosition);
      const partner =
        t && (t.outgoing.id === active.id || t.incoming.id === active.id)
          ? t.outgoing.id === active.id
            ? { clip: t.incoming, freezeTime: t.incoming.trimStart }
            : {
                clip: t.outgoing,
                // Pull back a hair from the absolute end so codecs that
                // can't seek to t=duration exactly still produce a frame.
                freezeTime: Math.max(t.outgoing.trimStart, t.outgoing.trimEnd - 0.04),
              }
          : null;

      if (t && partner) {
        let back: HTMLElement;
        if (partner.clip.still) {
          aux.style.opacity = '0';
          showStill(auxImg, partner.clip);
          back = auxImg;
        } else {
          auxImg.style.opacity = '0';
          renderAuxFreeze(aux, auxSourceRef, partner);
          back = aux;
        }
        back.style.filter = clipCssFilter(partner.clip);
        const activeIsOutgoing = t.outgoing.id === active.id;
        applyTransition(t.kind, t.progress, {
          outgoing: activeIsOutgoing ? front : back,
          incoming: activeIsOutgoing ? back : front,
          frontIsOutgoing: activeIsOutgoing,
          // The held frame lies just outside its clip's span, where
          // the envelope is 0; read it at the clip's nearest edge (as
          // the export's run-out / pre-roll does).
          outgoingOpacity: fadeEnvelope(
            t.outgoing,
            Math.min(state.playheadPosition, t.cut - 1e-3),
          ),
          incomingOpacity: fadeEnvelope(
            t.incoming,
            Math.max(state.playheadPosition, t.cut),
          ),
        });
      } else {
        // No transition right now — keep the aux source mounted but
        // hidden. Releasing on every clip change churns object URLs
        // and forces a re-decode the next time we cross a cut.
        aux.style.opacity = '0';
        auxImg.style.opacity = '0';
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
        <img
          ref={auxImgRef}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          style={{ opacity: 0 }}
        />
        <video
          ref={mainVideoRef}
          className="relative h-full w-full bg-transparent"
          playsInline
          preload="auto"
        />
        <img
          ref={mainImgRef}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          style={{ opacity: 0 }}
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

/** Point an `<img>` at a still clip's picture (no-op if already there). */
function showStill(img: HTMLImageElement, clip: VideoClip): void {
  const url = stillUrl(clip.file);
  if (img.getAttribute('src') !== url) img.src = url;
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
 * Style the two layers of a transition at `progress` (0 → 1) to match
 * ffmpeg's `xfade`. Only one layer — the active clip — is in front;
 * the other is its held frame behind it, so "revealing" the back layer
 * means clipping or fading the front one.
 */
function applyTransition(
  kind: TransitionKind,
  progress: number,
  layers: {
    outgoing: HTMLElement;
    incoming: HTMLElement;
    frontIsOutgoing: boolean;
    outgoingOpacity: number;
    incomingOpacity: number;
  },
): void {
  const { outgoing, incoming, frontIsOutgoing } = layers;
  const p = Math.max(0, Math.min(1, progress));
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  outgoing.style.opacity = String(layers.outgoingOpacity);
  incoming.style.opacity = String(layers.incomingOpacity);
  switch (kind) {
    case 'dissolve': {
      // front·α over an opaque back reproduces a linear blend.
      if (frontIsOutgoing) {
        outgoing.style.opacity = String(layers.outgoingOpacity * (1 - p));
      } else {
        incoming.style.opacity = String(layers.incomingOpacity * p);
      }
      return;
    }
    case 'fadeblack': {
      outgoing.style.opacity = String(layers.outgoingOpacity * Math.max(0, 1 - 2 * p));
      incoming.style.opacity = String(layers.incomingOpacity * Math.max(0, 2 * p - 1));
      return;
    }
    case 'wipeleft':
      // The incoming clip enters from the right edge.
      if (frontIsOutgoing) outgoing.style.clipPath = `inset(0 ${pct(p)} 0 0)`;
      else incoming.style.clipPath = `inset(0 0 0 ${pct(1 - p)})`;
      return;
    case 'wiperight':
      // The incoming clip enters from the left edge.
      if (frontIsOutgoing) outgoing.style.clipPath = `inset(0 0 0 ${pct(p)})`;
      else incoming.style.clipPath = `inset(0 ${pct(1 - p)} 0 0)`;
      return;
    case 'slideleft':
      outgoing.style.transform = `translateX(-${pct(p)})`;
      incoming.style.transform = `translateX(${pct(1 - p)})`;
      return;
    case 'slideright':
      outgoing.style.transform = `translateX(${pct(p)})`;
      incoming.style.transform = `translateX(-${pct(1 - p)})`;
      return;
  }
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
      onClick={() => triggerMediaPicker({ placeOnTimeline: true })}
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
      {active.map((overlay) =>
        isTextOverlay(overlay) ? (
          <DraggableOverlay
            key={overlay.id}
            overlay={overlay}
            containerRef={containerRef}
            scale={scale}
            opacity={overlayOpacity(overlay, playhead)}
          />
        ) : (
          <ShapeView
            key={overlay.id}
            shape={overlay}
            opacity={overlayOpacity(overlay, playhead)}
            containerRef={containerRef}
            scale={scale}
            frameW={project.resolution.width}
            frameH={project.resolution.height}
          />
        ),
      )}
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
  opacity,
}: {
  overlay: TextOverlay;
  containerRef: React.RefObject<HTMLDivElement | null>;
  scale: number;
  opacity: number;
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
        opacity,
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

type ShapeDragMode = 'move' | 'resize' | 'tail' | 'tip';

/**
 * An annotation shape in the preview: drawn on a canvas by the same
 * `drawShape` the export rasterizes with, scaled to the preview.
 * Drag to move; when selected, box shapes resize from the bottom-right
 * handle and arrows expose a handle on each end.
 */
function ShapeView({
  shape,
  opacity,
  containerRef,
  scale,
  frameW,
  frameH,
}: {
  shape: ShapeOverlay;
  opacity: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  scale: number;
  frameW: number;
  frameH: number;
}) {
  const selected = useTimelineStore((s) => s.selectedOverlayId === shape.id);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{
    mode: ShapeDragMode;
    pointerX: number;
    pointerY: number;
    box: ShapeOverlay['box'];
    rectWidth: number;
    rectHeight: number;
  } | null>(null);
  const b = shapePixelBounds(shape, frameW, frameH);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(b.width * scale * dpr));
    canvas.height = Math.max(1, Math.round(b.height * scale * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.clearRect(0, 0, b.width, b.height);
    ctx.translate(-b.x, -b.y);
    drawShape(ctx, shape, frameW, frameH);
  }, [shape, scale, frameW, frameH, b.x, b.y, b.width, b.height]);

  const begin = (e: React.PointerEvent<HTMLElement>, mode: ShapeDragMode) => {
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      pointerX: e.clientX,
      pointerY: e.clientY,
      box: shape.box,
      rectWidth: rect.width,
      rectHeight: rect.height,
    };
    useTimelineStore.getState().selectOverlay(shape.id);
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.pointerX) / d.rectWidth;
    const dy = (e.clientY - d.pointerY) / d.rectHeight;
    const o = d.box;
    const box =
      d.mode === 'move'
        ? { ...o, x: o.x + dx, y: o.y + dy }
        : d.mode === 'resize'
          ? { ...o, w: Math.max(0.02, o.w + dx), h: Math.max(0.02, o.h + dy) }
          : d.mode === 'tip'
            ? { ...o, w: o.w + dx, h: o.h + dy }
            : { x: o.x + dx, y: o.y + dy, w: o.w - dx, h: o.h - dy };
    useTimelineStore.getState().updateShape(shape.id, { box });
  };
  const end = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };

  // Handle positions inside the bounds element, in preview pixels.
  const at = (fx: number, fy: number) => ({
    left: (fx * frameW - b.x) * scale,
    top: (fy * frameH - b.y) * scale,
  });
  const { box } = shape;
  const handles: { mode: ShapeDragMode; pos: { left: number; top: number } }[] =
    !selected
      ? []
      : shape.kind === 'arrow'
        ? [
            { mode: 'tail', pos: at(box.x, box.y) },
            { mode: 'tip', pos: at(box.x + box.w, box.y + box.h) },
          ]
        : [{ mode: 'resize', pos: at(box.x + box.w, box.y + box.h) }];

  return (
    <div
      data-shape-overlay
      onPointerDown={(e) => begin(e, 'move')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      className={`pointer-events-auto absolute cursor-move ${
        selected ? 'outline outline-1 outline-offset-0 outline-accent/70' : ''
      }`}
      style={{
        left: b.x * scale,
        top: b.y * scale,
        width: b.width * scale,
        height: b.height * scale,
        opacity,
      }}
      title={SHAPE_LABELS[shape.kind]}
    >
      <canvas ref={canvasRef} className="pointer-events-none h-full w-full" />
      {handles.map((h) => (
        <div
          key={h.mode}
          data-shape-handle={h.mode}
          onPointerDown={(e) => begin(e, h.mode)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className="absolute size-3 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white bg-accent shadow"
          style={h.pos}
        />
      ))}
    </div>
  );
}

/** Fade envelope at the playhead, matching the export's alpha fades. */
function overlayOpacity(overlay: AnyOverlay, playhead: number): number {
  return fadeEnvelope(
    { ...overlay, ...effectiveOverlayFades(overlay) },
    playhead,
  );
}

function activeOverlays(
  project: VideoProject,
  playhead: number,
): AnyOverlay[] {
  return project.overlays.filter(
    (o) => playhead >= o.startOffset && playhead < o.startOffset + o.duration,
  );
}
