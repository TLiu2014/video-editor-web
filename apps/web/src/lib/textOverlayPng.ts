import { drawShape, isTextOverlay, shapePixelBounds } from './shapes';
import { drawTextOverlay, layoutText } from './textRender';
import type { AnyOverlay, VideoProject } from '../types/timeline';

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
  overlay: AnyOverlay,
  project: VideoProject,
): Promise<RenderedOverlay> {
  const projectWidth = project.resolution.width;
  const projectHeight = project.resolution.height;
  if (!isTextOverlay(overlay)) {
    // Annotation shape: rasterize its exact pixel bounds with the same
    // routine the preview uses.
    const b = shapePixelBounds(overlay, projectWidth, projectHeight);
    const png = await drawToCanvas(b.width, b.height, (ctx) => {
      ctx.translate(-b.x, -b.y);
      drawShape(ctx, overlay, projectWidth, projectHeight);
    });
    return { png, x: b.x, y: b.y, width: b.width, height: b.height };
  }
  // Same layout + drawing the preview uses (lib/textRender.ts).
  if (typeof document !== 'undefined' && document.fonts) await document.fonts.ready;
  const layout = layoutText(overlay);
  const png = await drawToCanvas(layout.width, layout.height, (ctx) =>
    drawTextOverlay(ctx, overlay, layout),
  );
  return {
    png,
    x: Math.round(projectWidth * overlay.style.position.x),
    y: Math.round(projectHeight * overlay.style.position.y),
    width: layout.width,
    height: layout.height,
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
