import { describe, expect, it } from 'vitest';
import { packOverlayRows } from '../components/timeline/OverlayLane';
import type { ShapeOverlay, TextOverlay } from '../types/timeline';
import {
  createShapeOverlay,
  isShapeOverlay,
  isTextOverlay,
  overlayLabel,
  shapePixelBounds,
} from './shapes';

const text = (id: string, start: number, duration: number): TextOverlay => ({
  id, text: id, startOffset: start, duration,
  style: { position: { x: 0, y: 0 }, color: '#fff', size: 40 },
});

describe('shapes', () => {
  it('treats legacy overlays without kind as text', () => {
    expect(isTextOverlay(text('t', 0, 1))).toBe(true);
    expect(isShapeOverlay(createShapeOverlay('rect', 0, 1080))).toBe(true);
  });

  it('scales default stroke and text with the frame height', () => {
    expect(createShapeOverlay('rect', 0, 1080).style.strokeWidth).toBe(6);
    expect(createShapeOverlay('rect', 0, 2160).style.strokeWidth).toBe(12);
    expect(createShapeOverlay('callout', 0, 1080)).toMatchObject({ text: 'Callout text', style: { strokeWidth: 0 } });
  });

  it('bounds a box shape with stroke padding', () => {
    const s: ShapeOverlay = { ...createShapeOverlay('rect', 0, 1080), box: { x: 0.25, y: 0.5, w: 0.5, h: 0.25 } };
    const b = shapePixelBounds(s, 1920, 1080);
    // stroke 6 → pad 3 + 2.
    expect(b).toEqual({ x: 475, y: 535, width: 970, height: 280 });
  });

  it('bounds an arrow pointing up-left (negative w/h) including its head', () => {
    const s: ShapeOverlay = { ...createShapeOverlay('arrow', 0, 1080), box: { x: 0.5, y: 0.5, w: -0.25, h: -0.25 } };
    const b = shapePixelBounds(s, 1920, 1080);
    expect(b.x).toBeLessThan(480);
    expect(b.y).toBeLessThan(270);
    expect(b.x + b.width).toBeGreaterThan(960);
    expect(b.y + b.height).toBeGreaterThan(540);
  });

  it('labels overlays for the lane', () => {
    expect(overlayLabel(createShapeOverlay('arrow', 0, 1080))).toBe('Arrow');
    expect(overlayLabel(createShapeOverlay('callout', 0, 1080))).toBe('Callout text');
    expect(overlayLabel(text('Hello', 0, 1))).toBe('Hello');
  });
});

describe('overlay lane packing', () => {
  it('stacks overlapping overlays and reuses free rows', () => {
    const { rowOf, rows } = packOverlayRows([
      text('a', 0, 3), text('b', 1, 3), text('c', 3, 1), text('d', 4.5, 1),
    ]);
    expect(rows).toBe(2);
    expect([rowOf.get('a'), rowOf.get('b'), rowOf.get('c'), rowOf.get('d')]).toEqual([0, 1, 0, 0]);
  });
  it('always has one row', () => {
    expect(packOverlayRows([]).rows).toBe(1);
  });
});
