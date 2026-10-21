/**
 * Runs real export plans through native ffmpeg. Opt-in because it
 * needs ffmpeg on PATH:  RUN_FFMPEG=1 pnpm test
 *
 * Native ffmpeg is newer than the ffmpeg.wasm core, but the filters
 * used here (trim, loop, overlay, fade, xfade…) behave the same; this
 * catches graph syntax and stream-wiring mistakes the unit tests
 * can't.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AnyClip, VideoClip, VideoProject } from '../types/timeline';
import { buildExportPlan } from './filterGraph';
import { createShapeOverlay, isTextOverlay, shapePixelBounds } from './shapes';
import { STILL_MAX_DURATION } from './stills';

const run = process.env.RUN_FFMPEG === '1';
const dir = run ? mkdtempSync(join(tmpdir(), 'vew-ffmpeg-')) : '';
const ff = (args: string[]) =>
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { cwd: dir });

function fileFrom(name: string, type: string): File {
  return new File([readFileSync(join(dir, name))], name, { type });
}

function videoClip(id: string, file: File, startOffset: number, duration: number, extra: Partial<VideoClip> = {}): VideoClip {
  return {
    id, kind: 'video', name: id, file, startOffset,
    trimStart: 0, trimEnd: duration, duration, sourceDuration: duration,
    fadeIn: 0, fadeOut: 0, hasAudio: true, trackId: 'v1', ...extra,
  };
}

function project(v1: AnyClip[], v2: AnyClip[] = []): VideoProject {
  return {
    id: 'p', name: 'P', resolution: { width: 320, height: 180 }, frameRate: 30,
    audioSampleRate: 48000, overlays: [], media: [],
    tracks: [
      { id: 'v1', type: 'video', clips: v1 },
      { id: 'a1', type: 'audio', clips: [] },
      { id: 'v2', type: 'video', clips: v2.map((c) => ({ ...c, trackId: 'v2' })) },
    ],
  };
}

/** Execute a plan in `dir`; returns the output duration in seconds. */
function execPlan(p: VideoProject, out: string): number {
  const plan = buildExportPlan(p);
  for (const input of plan.inputs) {
    // Inputs were built from files in `dir`; write them under the
    // plan's virtual names, as useFFmpeg does with fetchFile.
    writeFileSync(join(dir, input.name), readFileSync(join(dir, input.file.name)));
  }
  // The browser rasterizes overlays; here a solid white PNG of the
  // right size stands in (timing and alpha are what's under test).
  for (const ov of plan.overlayInputs) {
    const b = isTextOverlay(ov.overlay)
      ? { width: 40, height: 40 }
      : shapePixelBounds(ov.overlay, p.resolution.width, p.resolution.height);
    ff(['-f', 'lavfi', '-i', `color=c=white:s=${b.width}x${b.height}`, '-frames:v', '1', ov.name]);
  }
  const args = plan.args.map((a) => (a === plan.outputFile ? out : a));
  execFileSync('ffmpeg', ['-loglevel', 'error', ...args], { cwd: dir });
  const probe = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out],
    { cwd: dir },
  );
  return parseFloat(probe.toString());
}

/** RGB of one pixel at time `t` of `video`. */
function pixel(video: string, t: number, x: number, y: number): number[] {
  const raw = execFileSync(
    'ffmpeg',
    ['-loglevel', 'error', '-ss', String(t), '-i', video, '-frames:v', '1',
      '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { cwd: dir },
  );
  return [...raw.subarray(0, 3)];
}

describe.skipIf(!run)('export plans through native ffmpeg', () => {
  if (run) {
    ff(['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30', '-f', 'lavfi', '-i', 'sine=frequency=440',
      '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'blue.mp4']);
    ff(['-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30', '-t', '3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'red.mp4']);
    // Left half red, right half blue — for zoom & pan.
    ff(['-f', 'lavfi', '-i', 'color=c=red:s=160x180:r=30', '-f', 'lavfi', '-i', 'color=c=blue:s=160x180:r=30',
      '-filter_complex', '[0][1]hstack', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'split.mp4']);
    // Opaque green card, and a transparent PNG with a white square.
    ff(['-f', 'lavfi', '-i', 'color=c=green:s=640x360', '-frames:v', '1', 'card.png']);
    ff(['-f', 'lavfi', '-i', 'color=c=white@0.0:s=100x100,format=rgba,drawbox=x=25:y=25:w=50:h=50:c=white@1:t=fill:replace=1',
      '-frames:v', '1', 'logo.png']);
  }

  it('renders a still on V1 for its trimmed length', () => {
    const blue = fileFrom('blue.mp4', 'video/mp4');
    const card = fileFrom('card.png', 'image/png');
    const p = project([
      videoClip('a', blue, 0, 2),
      videoClip('s', card, 2, 2.5, { still: true, hasAudio: false, sourceDuration: STILL_MAX_DURATION }),
    ]);
    const dur = execPlan(p, 'still-v1.mp4');
    expect(dur).toBeGreaterThan(4.3);
    expect(dur).toBeLessThan(4.8);
    const [r, g, b] = pixel('still-v1.mp4', 3.5, 160, 90);
    expect(g).toBeGreaterThan(100);
    expect(r! + b!).toBeLessThan(80);
  });

  it('composites a transparent PNG on V2 with alpha intact', () => {
    const blue = fileFrom('blue.mp4', 'video/mp4');
    const logo = fileFrom('logo.png', 'image/png');
    const p = project(
      [videoClip('a', blue, 0, 3)],
      [videoClip('l', logo, 0.5, 2, {
        still: true, hasAudio: false, sourceDuration: STILL_MAX_DURATION,
        transform: { x: 0, y: 0, scale: 0.5 },
      })],
    );
    execPlan(p, 'logo-v2.mp4');
    // Logo is 160px wide at scale 0.5: square spans ~40–120.
    const inside = pixel('logo-v2.mp4', 1.5, 80, 80);
    const corner = pixel('logo-v2.mp4', 1.5, 10, 10); // transparent → blue
    expect(Math.min(...inside)).toBeGreaterThan(200);
    expect(corner[2]).toBeGreaterThan(150);
    expect(corner[0]).toBeLessThan(60);
  });

  it('fades a V2 layer to transparent, not to black, at its own start', () => {
    const blue = fileFrom('blue.mp4', 'video/mp4');
    const red = fileFrom('red.mp4', 'video/mp4');
    const p = project(
      [videoClip('a', blue, 0, 3)],
      [videoClip('r', red, 1, 2, { fadeIn: 1, hasAudio: false })],
    );
    execPlan(p, 'fade-v2.mp4');
    // Halfway through the fade-in: a red/blue blend, never black.
    const [r, , b] = pixel('fade-v2.mp4', 1.5, 160, 90);
    expect(r).toBeGreaterThan(60);
    expect(b).toBeGreaterThan(60);
    // Before the clip starts: pure base.
    const before = pixel('fade-v2.mp4', 0.5, 160, 90);
    expect(before[0]).toBeLessThan(40);
  });

  it('dissolves between touching V1 clips without changing the length', () => {
    // Source clips are 3s; using 2s of each leaves 1s of handle media.
    const blue = fileFrom('blue.mp4', 'video/mp4');
    const red = fileFrom('red.mp4', 'video/mp4');
    const p = project([
      videoClip('a', blue, 0, 2, { sourceDuration: 3 }),
      videoClip('b', red, 2, 2, {
        trimStart: 1, trimEnd: 3, sourceDuration: 3, hasAudio: false,
        transitionIn: { kind: 'dissolve', duration: 1 },
      }),
    ]);
    const dur = execPlan(p, 'dissolve.mp4');
    expect(Math.abs(dur - 4)).toBeLessThan(0.1);
    const [r, , b] = pixel('dissolve.mp4', 2, 160, 90); // mid-transition
    expect(r).toBeGreaterThan(70);
    expect(b).toBeGreaterThan(70);
    expect(pixel('dissolve.mp4', 1.2, 160, 90)[2]).toBeGreaterThan(200); // pure A
    expect(pixel('dissolve.mp4', 2.8, 160, 90)[0]).toBeGreaterThan(200); // pure B
  });

  it('holds edge frames when there is no handle media', () => {
    const blue = fileFrom('blue.mp4', 'video/mp4');
    const red = fileFrom('red.mp4', 'video/mp4');
    const p = project([
      videoClip('a', blue, 0, 3, { sourceDuration: 3 }),
      videoClip('b', red, 3, 3, {
        sourceDuration: 3, hasAudio: false,
        transitionIn: { kind: 'dissolve', duration: 1 },
      }),
    ]);
    expect(Math.abs(execPlan(p, 'hold.mp4') - 6)).toBeLessThan(0.1);
  });

  it('wipeleft reveals the incoming clip from the right', () => {
    const blue = fileFrom('blue.mp4', 'video/mp4');
    const red = fileFrom('red.mp4', 'video/mp4');
    const p = project([
      videoClip('a', blue, 0, 2, { sourceDuration: 3 }),
      videoClip('b', red, 2, 2, {
        trimStart: 1, trimEnd: 3, sourceDuration: 3, hasAudio: false,
        transitionIn: { kind: 'wipeleft', duration: 2 },
      }),
    ]);
    execPlan(p, 'wipe.mp4');
    // 25% into the wipe (t = 1.5): incoming (red) covers the right quarter.
    expect(pixel('wipe.mp4', 1.5, 300, 90)[0]).toBeGreaterThan(200);
    expect(pixel('wipe.mp4', 1.5, 20, 90)[2]).toBeGreaterThan(200);
  });

  it('plain fades between touching clips go through black', () => {
    const blue = fileFrom('blue.mp4', 'video/mp4');
    const red = fileFrom('red.mp4', 'video/mp4');
    const p = project([
      videoClip('a', blue, 0, 2, { fadeOut: 1 }),
      videoClip('b', red, 2, 2, { fadeIn: 1, hasAudio: false }),
    ]);
    execPlan(p, 'fades.mp4');
    const px = pixel('fades.mp4', 2.02, 160, 90);
    expect(Math.max(...px)).toBeLessThan(40);
  });

  it('fades an overlay in and out on its own timing', () => {
    const blue = fileFrom('blue.mp4', 'video/mp4');
    const p = project([videoClip('a', blue, 0, 3)]);
    p.overlays = [{
      ...createShapeOverlay('rect', 0.5, 180),
      box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
      duration: 2,
      fadeIn: 1,
      fadeOut: 0.5,
    }];
    execPlan(p, 'overlay-fade.mp4');
    const at = (t: number) => pixel('overlay-fade.mp4', t, 160, 90);
    // Before it starts: base only.
    expect(at(0.3)[0]).toBeLessThan(40);
    // Halfway through the fade-in (t = 1.0): roughly half white.
    const mid = at(1.0);
    expect(mid[0]).toBeGreaterThan(70);
    expect(mid[0]).toBeLessThan(190);
    // Fully in.
    expect(Math.min(...at(1.8))).toBeGreaterThan(220);
    // After it ends (2.5): base again.
    expect(at(2.7)[0]).toBeLessThan(40);
  });

  it('keeps hard-cut overlays (no fades) on the single-frame path', () => {
    const blue = fileFrom('blue.mp4', 'video/mp4');
    const p = project([videoClip('a', blue, 0, 3)]);
    p.overlays = [{
      ...createShapeOverlay('rect', 0.5, 180),
      box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
      duration: 1.5,
      fadeIn: 0,
      fadeOut: 0,
    }];
    expect(buildExportPlan(p).args.join(' ')).not.toContain('loop=');
    execPlan(p, 'overlay-cut.mp4');
    const at = (t: number) => pixel('overlay-cut.mp4', t, 160, 90);
    expect(Math.min(...at(0.6))).toBeGreaterThan(220);
    expect(at(2.2)[0]).toBeLessThan(40);
  });

  it('zooms & pans with keyframes (eased, held after the last one)', () => {
    const split = fileFrom('split.mp4', 'video/mp4');
    const p = project([
      videoClip('a', split, 0, 3, {
        hasAudio: false,
        zoomKeyframes: [
          { t: 0.5, zoom: 1, cx: 0.5, cy: 0.5 },
          { t: 1.5, zoom: 2, cx: 0.25, cy: 0.5 }, // left half fills the frame
        ],
      }),
    ]);
    expect(Math.abs(execPlan(p, 'zoom.mp4') - 3)).toBeLessThan(0.1);
    // Before the first keyframe: unzoomed, right edge is blue.
    expect(pixel('zoom.mp4', 0.2, 300, 90)[2]).toBeGreaterThan(200);
    // After the last keyframe: only the red half is visible.
    const after = pixel('zoom.mp4', 2.5, 300, 90);
    expect(after[0]).toBeGreaterThan(200);
    expect(after[2]).toBeLessThan(60);
    // The red/blue edge sweeps right as it zooms in; mid-way (t=1, eased
    // to 0.5) it sits between the unzoomed (160) and final (off-frame) spots.
    const row = [...execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', '1', '-i', 'zoom.mp4', '-frames:v', '1',
      '-vf', 'crop=320:2:0:90', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { cwd: dir })];
    const edge = Array.from({ length: 320 }, (_, x) => row[x * 3]!).findIndex((r) => r < 128);
    expect(edge).toBeGreaterThan(190);
    expect(edge).toBeLessThan(300);
  });

  /** Red pixel bounding box of a frame (x range on row y, or full bbox). */
  function redBox(video: string, t: number): { x0: number; x1: number; y0: number; y1: number } | null {
    const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', String(t), '-i', video, '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { cwd: dir });
    let x0 = 1e9; let x1 = -1; let y0 = 1e9; let y1 = -1;
    for (let i = 0; i < 320 * 180; i++) {
      if (raw[i * 3]! > 150 && raw[i * 3 + 2]! < 100) {
        const x = i % 320; const y = Math.floor(i / 320);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    return x1 < 0 ? null : { x0, x1, y0, y1 };
  }

  const pipProject = (extra: Partial<VideoClip>) => {
    const blue = fileFrom('blue.mp4', 'video/mp4');
    const red = fileFrom('red.mp4', 'video/mp4');
    return project(
      [videoClip('a', blue, 0, 3)],
      [videoClip('r', red, 0, 3, { hasAudio: false, ...extra })],
    );
  };

  it('places a rotated PiP layer by its center, like the preview', () => {
    // 25% wide (80×45) at top-left (40, 45) → center (80, 67.5).
    execPlan(pipProject({ transform: { x: 0.125, y: 0.25, scale: 0.25, rotation: 45 } }), 'rot.mp4');
    const b = redBox('rot.mp4', 1)!;
    expect(Math.abs((b.x0 + b.x1) / 2 - 80)).toBeLessThan(3);
    expect(Math.abs((b.y0 + b.y1) / 2 - 67.5)).toBeLessThan(3);
    // A 45° 80×45 rectangle spans ~88px, wider than the unrotated 80.
    expect(b.x1 - b.x0).toBeGreaterThan(84);
  });

  it('animates PiP position along its keyframes', () => {
    execPlan(pipProject({
      transform: { x: 0, y: 0, scale: 0.25 },
      motionKeyframes: [
        { t: 0.5, x: 0, y: 0, scale: 0.25, rotation: 0 },
        { t: 2.5, x: 0.75, y: 0.5, scale: 0.25, rotation: 0 },
      ],
    }), 'move.mp4');
    const start = redBox('move.mp4', 0.2)!;
    const end = redBox('move.mp4', 2.8)!;
    expect(start.x0).toBeLessThan(3);
    expect(Math.abs(end.x0 - 240)).toBeLessThan(3);
    expect(Math.abs(end.y0 - 90)).toBeLessThan(3);
    const mid = redBox('move.mp4', 1.5)!; // eased halfway
    expect(Math.abs(mid.x0 - 120)).toBeLessThan(6);
  });

  it('animates PiP scale (and scale + rotation together)', () => {
    execPlan(pipProject({
      transform: { x: 0, y: 0, scale: 0.1 },
      motionKeyframes: [
        { t: 0.5, x: 0, y: 0, scale: 0.1, rotation: 0 },
        { t: 2.5, x: 0, y: 0, scale: 0.5, rotation: 0 },
      ],
    }), 'grow.mp4');
    expect(redBox('grow.mp4', 0.2)!.x1).toBeLessThan(36);
    expect(Math.abs(redBox('grow.mp4', 2.8)!.x1 - 159)).toBeLessThan(3);

    execPlan(pipProject({
      transform: { x: 0.25, y: 0.25, scale: 0.1 },
      motionKeyframes: [
        { t: 0.5, x: 0.25, y: 0.25, scale: 0.1, rotation: 0 },
        { t: 2.5, x: 0.25, y: 0.25, scale: 0.4, rotation: 90 },
      ],
    }), 'spin.mp4');
    // At the end: 128×72 rotated 90° → 72 wide, 128 tall, centered at
    // (80 + 64, 45 + 36) = (144, 81).
    const b = redBox('spin.mp4', 2.8)!;
    expect(Math.abs(b.x1 - b.x0 - 72)).toBeLessThan(5);
    expect(Math.abs(b.y1 - b.y0 - 128)).toBeLessThan(5);
    expect(Math.abs((b.x0 + b.x1) / 2 - 144)).toBeLessThan(3);
  });

  it('moves an annotation along its motion path', () => {
    const blue = fileFrom('blue.mp4', 'video/mp4');
    const p = project([videoClip('a', blue, 0, 3)]);
    p.overlays = [{
      ...createShapeOverlay('rect', 0, 180),
      box: { x: 0, y: 0, w: 0.25, h: 0.25 },
      duration: 3,
      fadeIn: 0,
      fadeOut: 0,
      motion: [{ t: 0.5, x: 0, y: 0 }, { t: 2.5, x: 0.5, y: 0.5 }],
    }];
    execPlan(p, 'path.mp4');
    // The placeholder PNG is white and as big as the shape's bounds
    // (box + stroke padding), so measure its left / top edge.
    const white = (t: number) => {
      const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', String(t), '-i', 'path.mp4', '-frames:v', '1',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { cwd: dir });
      let x0 = 1e9; let y0 = 1e9;
      for (let i = 0; i < 320 * 180; i++) {
        if (raw[i * 3]! > 200 && raw[i * 3 + 2]! > 200 && raw[i * 3 + 1]! > 200) {
          x0 = Math.min(x0, i % 320); y0 = Math.min(y0, Math.floor(i / 320));
        }
      }
      return { x0, y0 };
    };
    const pad = 3; // stroke 1 (180p) → pad ceil(0.5)+2
    expect(white(0.2)).toEqual({ x0: 0, y0: 0 }); // clipped at the frame edge
    const end = white(2.8);
    expect(Math.abs(end.x0 - (160 - pad))).toBeLessThan(3);
    expect(Math.abs(end.y0 - (90 - pad))).toBeLessThan(3);
    const mid = white(1.5);
    expect(Math.abs(mid.x0 - (80 - pad))).toBeLessThan(5);
  });
});
