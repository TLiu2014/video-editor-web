import { newId } from './ids';
import type {
  AnyOverlay,
  ShapeKind,
  ShapeOverlay,
  ShapeStyle,
  TextOverlay,
} from '../types/timeline';

/**
 * Annotation shapes: rectangle, ellipse, arrow and callout (a filled
 * box with text). One drawing routine, `drawShape`, renders both the
 * preview canvas and the PNG the export overlays, so the two can't
 * disagree. Geometry is stored as frame fractions (`box`) and styled
 * in project pixels, like text overlays.
 */

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function isTextOverlay(o: AnyOverlay): o is TextOverlay {
  return o.kind === undefined || o.kind === 'text';
}

export function isShapeOverlay(o: AnyOverlay): o is ShapeOverlay {
  return !isTextOverlay(o);
}

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  arrow: 'Arrow',
  callout: 'Callout',
};

/** Short name for lists and the timeline lane. */
export function overlayLabel(o: AnyOverlay): string {
  if (isTextOverlay(o)) return o.text || 'Text';
  if (o.kind === 'callout' && o.text) return o.text;
  return SHAPE_LABELS[o.kind];
}

const DEFAULT_COLOR = '#ef4444';

/** Fade new text and annotations in and out briefly, like Camtasia. */
export const DEFAULT_OVERLAY_FADE = 0.3;

/**
 * Fades that actually fit the overlay's current length (trimming an
 * overlay shorter than its stored fades shouldn't make them overlap).
 */
export function effectiveOverlayFades(o: AnyOverlay): { fadeIn: number; fadeOut: number } {
  const fadeIn = Math.max(0, Math.min(o.fadeIn ?? 0, o.duration));
  const fadeOut = Math.max(0, Math.min(o.fadeOut ?? 0, o.duration - fadeIn));
  return { fadeIn, fadeOut };
}

/** A new shape of `kind`, centered-ish in the frame, 3 s long. */
export function createShapeOverlay(
  kind: ShapeKind,
  startOffset: number,
  frameHeight: number,
): ShapeOverlay {
  // Stroke and text scale with the frame so a 4K project doesn't get
  // hairlines and a 480p one doesn't get billboard text.
  const k = frameHeight / 1080;
  const style: ShapeStyle = {
    stroke: DEFAULT_COLOR,
    strokeWidth: Math.round(6 * k),
    fill: kind === 'callout' ? '#ffffff' : DEFAULT_COLOR,
    fillOpacity: kind === 'callout' ? 0.95 : 0,
    radius: Math.round((kind === 'callout' ? 18 : 6) * k),
    textColor: '#111827',
    textSize: Math.round(44 * k),
  };
  const box =
    kind === 'arrow'
      ? { x: 0.3, y: 0.35, w: 0.2, h: 0.15 }
      : kind === 'callout'
        ? { x: 0.35, y: 0.3, w: 0.3, h: 0.16 }
        : { x: 0.35, y: 0.3, w: 0.3, h: 0.3 };
  return {
    id: newId(),
    kind,
    startOffset,
    duration: 3,
    fadeIn: DEFAULT_OVERLAY_FADE,
    fadeOut: DEFAULT_OVERLAY_FADE,
    box,
    ...(kind === 'callout' ? { text: 'Callout text' } : {}),
    style: kind === 'callout' ? { ...style, strokeWidth: 0 } : style,
  };
}

function arrowHeadSize(style: ShapeStyle): number {
  return Math.max(14, style.strokeWidth * 3.5);
}

/**
 * Pixel rectangle (at project resolution) that fully contains the
 * drawn shape — stroke and arrow head included. The export rasterizes
 * exactly this rectangle and overlays it at (x, y).
 */
export function shapePixelBounds(
  shape: ShapeOverlay,
  frameW: number,
  frameH: number,
): { x: number; y: number; width: number; height: number } {
  const { box, style } = shape;
  const x0 = Math.min(box.x, box.x + box.w) * frameW;
  const y0 = Math.min(box.y, box.y + box.h) * frameH;
  const x1 = Math.max(box.x, box.x + box.w) * frameW;
  const y1 = Math.max(box.y, box.y + box.h) * frameH;
  const pad =
    Math.ceil(style.strokeWidth / 2) +
    (shape.kind === 'arrow' ? Math.ceil(arrowHeadSize(style)) : 0) +
    2;
  const x = Math.floor(x0 - pad);
  const y = Math.floor(y0 - pad);
  return {
    x,
    y,
    width: Math.max(2, Math.ceil(x1 + pad) - x),
    height: Math.max(2, Math.ceil(y1 + pad) - y),
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1] ?? '000000', 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Draw `shape` in project-pixel coordinates. The caller translates the
 * context so the shape's `shapePixelBounds` origin lands at (0, 0) and
 * scales it for display (preview) or leaves it 1:1 (export).
 */
export function drawShape(
  ctx: Ctx2D,
  shape: ShapeOverlay,
  frameW: number,
  frameH: number,
): void {
  const { box, style } = shape;
  const x = Math.min(box.x, box.x + box.w) * frameW;
  const y = Math.min(box.y, box.y + box.h) * frameH;
  const w = Math.abs(box.w) * frameW;
  const h = Math.abs(box.h) * frameH;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = style.strokeWidth;
  ctx.strokeStyle = style.stroke;
  ctx.fillStyle = hexToRgba(style.fill, style.fillOpacity);

  if (shape.kind === 'arrow') {
    const tx = box.x * frameW;
    const ty = box.y * frameH;
    const hx = (box.x + box.w) * frameW;
    const hy = (box.y + box.h) * frameH;
    const angle = Math.atan2(hy - ty, hx - tx);
    const head = arrowHeadSize(style);
    // Stop the shaft inside the head so the round cap doesn't poke out.
    const shaftEndX = hx - Math.cos(angle) * head * 0.6;
    const shaftEndY = hy - Math.sin(angle) * head * 0.6;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(
      hx - head * Math.cos(angle - Math.PI / 7),
      hy - head * Math.sin(angle - Math.PI / 7),
    );
    ctx.lineTo(
      hx - head * Math.cos(angle + Math.PI / 7),
      hy - head * Math.sin(angle + Math.PI / 7),
    );
    ctx.closePath();
    ctx.fillStyle = style.stroke;
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  if (shape.kind === 'ellipse') {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.roundRect(x, y, w, h, Math.min(style.radius, w / 2, h / 2));
  }
  if (style.fillOpacity > 0) ctx.fill();
  if (style.strokeWidth > 0) ctx.stroke();

  if (shape.kind === 'callout' && shape.text) {
    drawWrappedText(ctx, shape.text, x, y, w, h, style);
  }
  ctx.restore();
}

/** Center `text` in the box, wrapping on spaces and honoring newlines. */
function drawWrappedText(
  ctx: Ctx2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  style: ShapeStyle,
): void {
  const pad = Math.max(8, style.textSize * 0.4);
  const maxWidth = Math.max(1, w - pad * 2);
  ctx.font = `600 ${style.textSize}px Inter, system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = style.textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  const lineHeight = style.textSize * 1.2;
  const top = y + h / 2 - ((lines.length - 1) * lineHeight) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  lines.forEach((l, i) => ctx.fillText(l, x + w / 2, top + i * lineHeight));
  ctx.restore();
}
