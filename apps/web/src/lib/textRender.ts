import type { TextFont, TextOverlay } from '../types/timeline';

/**
 * Text overlay layout + drawing shared by the preview canvas and the
 * export rasterizer, so what you see is exactly what's burned in —
 * including multi-line text, which the old DOM preview showed but the
 * export drew on one line.
 *
 * Everything is in project pixels. `style.position` is the top-left
 * of the text box (background included) as frame fractions.
 *
 * Fonts are system stacks: preview and export run in the same browser,
 * so they always resolve to the same face.
 */

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const TEXT_FONTS: { id: TextFont; label: string; stack: string }[] = [
  { id: 'sans', label: 'Sans', stack: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: 'serif', label: 'Serif', stack: 'Georgia, "Times New Roman", Times, serif' },
  { id: 'mono', label: 'Mono', stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
  { id: 'display', label: 'Display', stack: 'Impact, "Arial Black", "Helvetica Neue", sans-serif' },
  { id: 'hand', label: 'Handwritten', stack: '"Marker Felt", "Comic Sans MS", "Segoe Print", cursive' },
];

export function fontStack(id: TextFont | undefined): string {
  return (TEXT_FONTS.find((f) => f.id === id) ?? TEXT_FONTS[0]!).stack;
}

/** The overlay's resolved style, with defaults for fields older projects lack. */
export function resolvedTextStyle(o: TextOverlay) {
  const s = o.style;
  return {
    font: s.font ?? 'sans',
    weight: s.weight ?? 600,
    italic: s.italic ?? false,
    align: s.align ?? 'left',
    // Older overlays always had a soft drop shadow; keep that look.
    shadow: s.shadow ?? true,
    outline: s.outline,
    background: s.background,
    color: s.color,
    size: s.size,
  };
}

export function cssFont(o: TextOverlay): string {
  const r = resolvedTextStyle(o);
  return `${r.italic ? 'italic ' : ''}${r.weight} ${r.size}px ${fontStack(r.font)}`;
}

export interface TextLayout {
  /** Box size in project pixels. */
  width: number;
  height: number;
  /** Inner padding (background) and per-line baseline offsets. */
  pad: number;
  lineHeight: number;
  lines: { text: string; width: number }[];
  ascent: number;
}

let measureCtx: Ctx2D | null = null;
function measurer(): Ctx2D {
  if (!measureCtx) {
    measureCtx =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1).getContext('2d')
        : document.createElement('canvas').getContext('2d');
  }
  if (!measureCtx) throw new Error('Canvas 2D context unavailable.');
  return measureCtx;
}

export function layoutText(o: TextOverlay): TextLayout {
  const r = resolvedTextStyle(o);
  const ctx = measurer();
  ctx.font = cssFont(o);
  const lines = (o.text || ' ').split('\n').map((text) => ({
    text,
    width: ctx.measureText(text).width,
  }));
  const probe = ctx.measureText('Mg');
  const ascent = probe.actualBoundingBoxAscent || r.size * 0.8;
  const descent = probe.actualBoundingBoxDescent || r.size * 0.22;
  const lineHeight = Math.max(r.size * 1.2, ascent + descent);
  const outline = r.outline ? r.outline.width : 0;
  const pad = Math.ceil(
    (r.background ? r.size * 0.35 : r.size * 0.15) + outline + (r.shadow ? r.size * 0.08 : 0),
  );
  const textWidth = Math.max(...lines.map((l) => l.width));
  return {
    width: Math.max(2, Math.ceil(textWidth + pad * 2)),
    height: Math.max(2, Math.ceil(lines.length * lineHeight + pad * 2)),
    pad,
    lineHeight,
    lines,
    ascent,
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1] ?? '000000', 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Draw the overlay with its box's top-left at (0, 0). */
export function drawTextOverlay(ctx: Ctx2D, o: TextOverlay, layout = layoutText(o)): void {
  const r = resolvedTextStyle(o);
  const { width, height, pad, lineHeight, lines } = layout;
  ctx.save();
  if (r.background && r.background.opacity > 0) {
    ctx.fillStyle = hexToRgba(r.background.color, r.background.opacity);
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, Math.min(r.size * 0.25, height / 2));
    ctx.fill();
  }
  ctx.font = cssFont(o);
  ctx.textBaseline = 'middle';
  ctx.textAlign = r.align;
  const x = r.align === 'center' ? width / 2 : r.align === 'right' ? width - pad : pad;
  lines.forEach((line, i) => {
    const y = pad + lineHeight * (i + 0.5);
    if (r.outline && r.outline.width > 0) {
      // Stroke is centered on the glyph edge; doubling the width puts
      // `outline.width` px outside the fill, which is drawn on top.
      ctx.lineJoin = 'round';
      ctx.lineWidth = r.outline.width * 2;
      ctx.strokeStyle = r.outline.color;
      ctx.strokeText(line.text, x, y);
    }
    if (r.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = Math.max(2, r.size * 0.08);
      ctx.shadowOffsetY = Math.max(1, r.size * 0.04);
    }
    ctx.fillStyle = r.color;
    ctx.fillText(line.text, x, y);
    ctx.shadowColor = 'transparent';
  });
  ctx.restore();
}
