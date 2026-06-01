import { useEffect, useRef } from 'react';
import { useVideoThumbnails } from '../../hooks/useVideoThumbnails';
import type { VideoClip } from '../../types/timeline';

/**
 * Render a horizontal strip of video thumbnails inside a clip block.
 * Each tile picks the cached frame closest to the source-time it
 * represents, honoring the clip's `trim` window so dragging the
 * trim handles visibly slides the thumbnail content.
 *
 * The canvas is DPR-scaled for crispness on Retina and redraws when
 * width, height, trim, or the thumbnail set changes.
 */
export function VideoThumbnailStrip({
  clip,
  widthPx,
  heightPx,
}: {
  clip: VideoClip;
  widthPx: number;
  heightPx: number;
}) {
  const thumbs = useVideoThumbnails(clip.file);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || widthPx < 1 || heightPx < 1) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(widthPx * dpr));
    canvas.height = Math.max(1, Math.floor(heightPx * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, widthPx, heightPx);

    if (!thumbs || thumbs.bitmaps.length === 0) return;

    // Tile width preserves the source aspect, so the strip looks like
    // a filmstrip rather than stretched squares.
    const aspect = thumbs.width / thumbs.height;
    const tileWidth = Math.max(1, heightPx * aspect);
    const tileCount = Math.max(1, Math.ceil(widthPx / tileWidth));

    const sourceWindow = Math.max(
      0.001,
      clip.trimEnd - clip.trimStart,
    );
    for (let i = 0; i < tileCount; i++) {
      const x = i * tileWidth;
      // What source-time does the *middle* of this tile show?
      const frac = (i + 0.5) / tileCount;
      const sourceTime = clip.trimStart + frac * sourceWindow;
      const sourceFrac =
        clip.sourceDuration > 0
          ? sourceTime / clip.sourceDuration
          : 0;
      const idx = Math.max(
        0,
        Math.min(
          thumbs.bitmaps.length - 1,
          Math.floor(sourceFrac * thumbs.bitmaps.length),
        ),
      );
      const bitmap = thumbs.bitmaps[idx];
      if (!bitmap) continue;
      ctx.drawImage(bitmap, x, 0, tileWidth, heightPx);
    }
  }, [
    thumbs,
    widthPx,
    heightPx,
    clip.trimStart,
    clip.trimEnd,
    clip.sourceDuration,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-x-0"
      style={{ top: 0, height: heightPx, width: widthPx }}
    />
  );
}
