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
});
