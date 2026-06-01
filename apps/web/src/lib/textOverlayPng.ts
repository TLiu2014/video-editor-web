import type { TextOverlay, VideoProject } from '../types/timeline';

export interface RenderedOverlay {
  png: Uint8Array;
  /** Pixel offset of the overlay's top-left within the project frame. */
  x: number;
  y: number;
  /** Pixel size of the rasterized text bitmap. */
  width: number;
  height: number;
}

/**
 * Rasterize an overlay's text to a PNG sized tightly to the rendered
 * glyphs. Sidesteps FFmpeg's `drawtext` filter entirely — which would
 * require shipping a TTF and configuring fontconfig — by letting the
 * browser do the rendering and handing FFmpeg an opaque image to
 * composite via the `overlay` filter.
 *
 * Position (`overlay.style.position.x`/`y`) is expressed as a
 * 0–1 fraction of the project's resolution, and `style.size` is
 * pixels at that same project resolution. The returned `x`/`y`
 * place the bitmap's top-left so the overlay filter just passes
 * them through.
 *
 * `OffscreenCanvas` is used when available; in environments that
 * don't yet expose it we fall back to a detached `<canvas>`. Both
 * paths produce identical pixels.
 */
export async function renderOverlayToPNG(
  overlay: TextOverlay,
  project: VideoProject,
): Promise<RenderedOverlay> {
  const projectWidth = project.resolution.width;
  const projectHeight = project.resolution.height;
  const font = `600 ${overlay.style.size}px Inter, system-ui, -apple-system, sans-serif`;

  // First pass: measure on a small detached canvas. We need the
  // exact text width and ascent/descent to size the output bitmap.
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) throw new Error('Canvas 2D context unavailable.');
  measureCtx.font = font;
  const metrics = measureCtx.measureText(overlay.text);
  const ascent = metrics.actualBoundingBoxAscent || overlay.style.size * 0.85;
  const descent =
    metrics.actualBoundingBoxDescent || overlay.style.size * 0.25;
  // Pad slightly so subpixel rendering doesn't clip edges.
  const padX = Math.ceil(overlay.style.size * 0.15);
  const padY = Math.ceil(overlay.style.size * 0.15);
  const width = Math.max(2, Math.ceil(metrics.width) + padX * 2);
  const height = Math.max(2, Math.ceil(ascent + descent) + padY * 2);

  // Second pass: render to the actual output bitmap.
  const bitmap = await drawToCanvas(width, height, (ctx) => {
    ctx.font = font;
    ctx.textBaseline = 'top';
    ctx.fillStyle = overlay.style.color;
    // Subtle drop shadow matching the preview's text-shadow.
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = Math.max(2, overlay.style.size * 0.08);
    ctx.shadowOffsetY = Math.max(1, overlay.style.size * 0.04);
    ctx.fillText(overlay.text, padX, padY);
  });

  return {
    png: bitmap,
    x: Math.round(projectWidth * overlay.style.position.x),
    y: Math.round(projectHeight * overlay.style.position.y),
    width,
    height,
  };
}

async function drawToCanvas(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void,
): Promise<Uint8Array> {
  const offscreenSupported =
    typeof OffscreenCanvas !== 'undefined' &&
    typeof (
      OffscreenCanvas.prototype as OffscreenCanvas & {
        convertToBlob?: () => Promise<Blob>;
      }
    ).convertToBlob === 'function';

  if (offscreenSupported) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable.');
    draw(ctx);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  draw(ctx);
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas toBlob returned null.'));
        return;
      }
      blob
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(reject);
    }, 'image/png');
  });
}
