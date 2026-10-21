// Browser smoke test for core timeline editing. Drives a running dev
// server with the locally installed Chrome. See e2e/README.md.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const URL = process.env.EDITOR_URL ?? 'http://localhost:5173/';
const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Two tiny synthetic clips: A = 6s with audio, B = 4s silent.
const MEDIA = mkdtempSync(join(tmpdir(), 'vew-e2e-'));
const ff = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args]);
ff(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440',
  '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(MEDIA, 'clipA.mp4')]);
ff(['-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=30', '-t', '4',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(MEDIA, 'clipB.mp4')]);
ff(['-f', 'lavfi', '-i', 'color=c=green:s=640x360', '-frames:v', '1', join(MEDIA, 'card.png')]);

let failures = 0;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new', defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
// Keep the tail of the console so a failed export shows ffmpeg's log.
const consoleTail = [];
page.on('console', (m) => {
  consoleTail.push(m.text());
  if (consoleTail.length > 60) consoleTail.shift();
});
page.on('pageerror', (e) => {
  // ffmpeg.wasm logs a benign terminate() on teardown.
  if (/terminate/.test(e.message)) return;
  failures += 1;
  console.log('PAGEERROR', e.message);
});
await page.goto(URL, { waitUntil: 'networkidle0' });
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const btn = async (t) => (await page.$$(`xpath/.//button[contains(., "${t}")]`))[0];
await (await btn('start blank')).click(); await wait(400);
const mediaInput = () => page.$('input[type=file][accept^="video/*"]');
await (await mediaInput()).uploadFile(`${MEDIA}/clipA.mp4`, `${MEDIA}/clipB.mp4`);
await page.waitForFunction(() => document.body.innerText.includes('clipB.mp4'), { timeout: 15000 });
for (const i of [0, 1]) {
  const row = (await page.$$('li[draggable]'))[i];
  await row.hover();
  await (await row.$('button[title="Add to timeline at playhead"]')).click(); await wait();
}
const layout = () => page.$$eval('[data-track-id]', (rows) => rows.map((r) => ({
  track: r.dataset.trackType, clips: [...r.querySelectorAll(':scope > div[title]')].map((c) => `${c.title.split(' ·')[0]}@${(parseFloat(c.style.left) / 80).toFixed(2)}`),
})));
const ok = (name, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(cond ? 'PASS' : 'FAIL', name, extra);
};
let l = await layout();
ok('two clips appended', JSON.stringify(l[0].clips) === JSON.stringify(['clipA.mp4@0.00', 'clipB.mp4@6.00']), JSON.stringify(l[0].clips));

// --- resize sidebar & timeline
const sidebarW = () => page.$eval('aside', (a) => a.getBoundingClientRect().width);
const w0 = await sidebarW();
const handles = await page.$$('[role=separator]');
let hb = await handles[0].boundingBox();
await page.mouse.move(hb.x + 3, hb.y + 200); await page.mouse.down(); await page.mouse.move(hb.x + 103, hb.y + 200, { steps: 5 }); await page.mouse.up();
ok('sidebar resize +100', Math.round(await sidebarW() - w0) === 100, `${w0} -> ${await sidebarW()}`);
const tlH = () => page.$eval('[data-timeline-surface]', (s) => s.parentElement.parentElement.getBoundingClientRect().height);
const h0 = await tlH();
hb = await handles[2].boundingBox();
await page.mouse.move(hb.x + 400, hb.y + 3); await page.mouse.down(); await page.mouse.move(hb.x + 400, hb.y - 97, { steps: 5 }); await page.mouse.up();
ok('timeline resize +100', Math.round(await tlH() - h0) === 100, `${h0} -> ${await tlH()}`);

// --- reorder: drag A onto right half of B
const clipEl = async (name) => {
  for (const c of await page.$$('[data-track-id] > div[title]')) if ((await c.evaluate((e) => e.title)).startsWith(name)) return c;
};
let a = await (await clipEl('clipA')).boundingBox();
let b = await (await clipEl('clipB')).boundingBox();
await page.mouse.move(a.x + 20, a.y + 20); await page.mouse.down();
await page.mouse.move(b.x + b.width * 0.8, b.y + 20, { steps: 10 });
const marker = await page.$('[data-track-id] > div.bg-accent');
ok('reorder marker shown', !!marker);
await page.mouse.up(); await wait();
l = await layout();
ok('reorder A after B', JSON.stringify([...l[0].clips].sort()) === JSON.stringify(['clipA.mp4@4.00', 'clipB.mp4@0.00']), JSON.stringify(l[0].clips));

// --- cross-track: add V2, drag B down into empty V2 space
await (await btn('Video track')).click(); await wait();
b = await (await clipEl('clipB')).boundingBox();
const rows = await page.$$('[data-track-id]');
const v2 = await rows[2].boundingBox(); // tracks order: V1, A1, V2
await page.mouse.move(b.x + 20, b.y + 20); await page.mouse.down();
await page.mouse.move(b.x + 20 + 160, v2.y + v2.height / 2, { steps: 10 }); await page.mouse.up(); await wait();
l = await layout();
ok('cross-track drag to V2', l[2].clips.length === 1 && l[2].clips[0].startsWith('clipB'), JSON.stringify(l));

// --- shortcuts: click A, X marks, ' deletes range
a = await (await clipEl('clipA')).boundingBox();
await page.mouse.click(a.x + 30, a.y + 20); await wait();
await page.keyboard.press('KeyX'); await wait();
await page.keyboard.press('Quote'); await wait();
l = await layout();
ok("X then ' removes clip A's span", l[0].clips.length === 0, JSON.stringify(l));
await page.keyboard.down('Meta'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Meta'); await wait();
l = await layout();
ok('undo restores A', l[0].clips.length === 1, JSON.stringify(l[0].clips));
// split + join
a = await (await clipEl('clipA')).boundingBox();
await page.mouse.click(a.x + 30, a.y + 20); await wait();
const rulerY = (await (await page.$('[data-timeline-surface]')).boundingBox()).y + 8;
await page.mouse.click(a.x + 160, rulerY); await wait(); // ruler click → playhead
await page.keyboard.press('KeyS'); await wait();
ok('split makes 2', (await layout())[0].clips.length === 2);
// ⌘A with 2+ clips used to crash the Properties panel (selector loop).
await page.keyboard.down('Meta'); await page.keyboard.press('KeyA'); await page.keyboard.up('Meta'); await wait();
ok('⌘A multi-select keeps the app alive', !!(await page.$('[data-timeline-surface]')));
const pieces = await (await page.$$('[data-track-id]'))[0].$$(':scope > div[title]');
const p0 = await pieces[0].boundingBox(); const p1 = await pieces[1].boundingBox();
await page.mouse.click(p0.x + p0.width / 2, p0.y + 20); await wait();
await page.keyboard.down('Shift'); await page.mouse.click(p1.x + p1.width / 2, p1.y + 20); await page.keyboard.up('Shift'); await wait();
await page.keyboard.down('Meta'); await page.keyboard.press('KeyJ'); await page.keyboard.up('Meta'); await wait();
ok('⌘J joins back', (await layout())[0].clips.length === 1, JSON.stringify((await layout())[0].clips));
// delete selected after split
await page.keyboard.press('KeyS'); await wait();
const after = await (await page.$$('[data-track-id]'))[0].$$(':scope > div[title]');
const q = await after[1].boundingBox();
await page.mouse.click(q.x + q.width / 2, q.y + 20); await wait();
await page.keyboard.press('Backspace'); await wait();
ok('delete after split', (await layout())[0].clips.length === 1);
// ? sheet
await page.keyboard.down('Shift'); await page.keyboard.press('Slash'); await page.keyboard.up('Shift'); await wait();
ok('? opens shortcut sheet', await page.evaluate(() => document.body.innerText.includes('Keyboard shortcuts')));
await page.keyboard.press('Escape'); await wait();
// PiP: select clipB on V2, put the playhead inside it, enable PiP,
// then drag the layer in the preview and resize it from the corner.
const clipBEl = await clipEl('clipB');
const bb = await clipBEl.boundingBox();
await page.mouse.click(bb.x + bb.width / 2, bb.y + 20); await wait();
await page.mouse.click(bb.x + bb.width / 2, rulerY); await wait();
await page.mouse.click(bb.x + bb.width / 2, bb.y + 20); await wait();
await (await btn('Enable PiP')).click(); await wait(400);
const pip = await page.$('[data-pip-layer]');
ok('PiP layer rendered', !!pip);
if (pip) {
  const before = await pip.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 100, before.y + before.height / 2 + 50, { steps: 6 });
  await page.mouse.up(); await wait();
  const moved = await (await page.$('[data-pip-layer]')).boundingBox();
  ok('PiP drag moves layer', Math.abs(moved.x - before.x - 100) < 3 && Math.abs(moved.y - before.y - 50) < 3,
    `${before.x},${before.y} -> ${moved.x},${moved.y}`);
  const handle = await page.$('[data-pip-layer] > div[title="Drag to resize"]');
  const hb2 = await handle.boundingBox();
  await page.mouse.move(hb2.x + 6, hb2.y + 6); await page.mouse.down();
  await page.mouse.move(hb2.x + 66, hb2.y + 6, { steps: 6 }); await page.mouse.up(); await wait();
  const resized = await (await page.$('[data-pip-layer]')).boundingBox();
  ok('PiP corner resize grows layer', resized.width > moved.width + 40, `${moved.width} -> ${resized.width}`);
}

// SRT import from the captions dialog (no API key needed).
const srtPath = join(MEDIA, 'subs.srt');
writeFileSync(srtPath, '1\n00:00:00,500 --> 00:00:02,000\nHello there\n\n2\n00:00:02,500 --> 00:00:04,000\nSecond line\n');
await page.keyboard.down('Meta'); await page.keyboard.press('KeyK'); await page.keyboard.up('Meta'); await wait();
await page.keyboard.type('Auto Captions'); await wait(); await page.keyboard.press('Enter'); await wait(400);
await (await page.$('input[type=file][accept^=".srt"]')).uploadFile(srtPath); await wait(400);
ok('SRT import adds captions', await page.evaluate(() => document.body.innerText.includes('Added 2 captions')));
await page.keyboard.press('Escape'); await wait();

// right-click menu
const last = (await page.$$('[data-track-id] > div[title]'))[0];
const lb = await last.boundingBox();
await page.mouse.click(lb.x + lb.width / 2, lb.y + 20, { button: 'right' }); await wait();
ok('context menu opens', !!(await page.$('[role=menu]')));
// --- Fresh project: stills + transitions + a real ffmpeg.wasm export.
await page.keyboard.down('Meta'); await page.keyboard.press('KeyK'); await page.keyboard.up('Meta'); await wait();
await page.keyboard.type('New Project'); await wait(); await page.keyboard.press('Enter'); await wait(500);
await (await mediaInput()).uploadFile(`${MEDIA}/clipA.mp4`, `${MEDIA}/clipB.mp4`, `${MEDIA}/card.png`);
await page.waitForFunction(() => document.body.innerText.includes('card.png'), { timeout: 15000 });
ok('image imports as an Image item', await page.evaluate(() => document.body.innerText.includes('Image')));
for (const name of ['clipA', 'clipB', 'card']) {
  const row = (await page.$$('li[draggable]')).find(async () => true);
  for (const r of await page.$$('li[draggable]')) {
    if ((await r.evaluate((e) => e.title)).startsWith(name)) {
      await r.hover();
      await (await r.$('button[title="Add to timeline at playhead"]')).click(); await wait();
    }
  }
  void row;
}
l = await layout();
ok('A, B, still appended on V1', JSON.stringify(l[0].clips) === JSON.stringify(['clipA.mp4@0.00', 'clipB.mp4@6.00', 'card.png@10.00']), JSON.stringify(l[0].clips));
// Preview audio follows track mute (it used to always play).
{
  const surf0 = await (await page.$('[data-timeline-surface]')).boundingBox();
  await page.mouse.click(surf0.x + 3 * 80, surf0.y + 8); await wait(300);
  const mainMuted = () => page.$eval('video.relative', (v) => v.muted);
  const before = await mainMuted();
  const v1 = (await page.$$('[data-track-id]'))[0];
  await (await v1.$('button[title="Mute track"]')).click(); await wait(300);
  const afterMute = await mainMuted();
  await (await v1.$('button[title="Unmute track"]')).click(); await wait(300);
  ok('preview mutes V1 audio when the track is muted', before === false && afterMute === true && (await mainMuted()) === false,
    `${before} → ${afterMute}`);
}
// Add a transition at the A|B cut via the hover "+".
const v1Row = (await page.$$('[data-track-id]'))[0];
await v1Row.hover(); await wait();
const plus = (await v1Row.$$('button[aria-label="Add transition"]'))[0];
await plus.click(); await wait();
ok('transition band appears', !!(await page.$('[data-transition-band]')));
ok('Properties shows the transition', await page.evaluate(() => document.body.innerText.toLowerCase().includes('transition in')));
// Playhead mid-transition (cut at 6s, 1s dissolve → 6.25s = 75%).
const surf = await (await page.$('[data-timeline-surface]')).boundingBox();
await page.mouse.click(surf.x + 6.25 * 80, surf.y + 8); await wait(600);
const opacities = await page.evaluate(() =>
  [...document.querySelectorAll('video, img')].map((el) => el.style.opacity).filter((o) => o !== '' && o !== '0'),
);
ok('preview blends two layers mid-transition', opacities.length >= 2, JSON.stringify(opacities));
// Playhead on the still.
await page.mouse.click(surf.x + 12 * 80, surf.y + 8); await wait(400);
const stillShown = await page.evaluate(() =>
  [...document.querySelectorAll('img')].some((i) => i.style.opacity === '1' && i.src.startsWith('blob:')),
);
ok('still shows in preview', stillShown);
// Annotations: add a callout at 1s via the palette, retime it by
// dragging its bar in the overlay lane, then add an arrow and drag
// its tip in the preview.
// Scroll the timeline back to 0 (earlier steps scrolled it), then
// re-measure before clicking the ruler at 1s.
await page.$eval('[data-timeline-surface]', (el) => { el.parentElement.scrollLeft = 0; }); await wait(200);
const surfNow = await (await page.$('[data-timeline-surface]')).boundingBox();
await page.mouse.click(surfNow.x + 1 * 80, surfNow.y + 8); await wait(300);
const palette = async (label) => {
  await page.keyboard.down('Meta'); await page.keyboard.press('KeyK'); await page.keyboard.up('Meta'); await wait();
  await page.keyboard.type(label); await wait(); await page.keyboard.press('Enter'); await wait(400);
};
await palette('Add Callout');
ok('callout drawn in preview', !!(await page.$('[data-shape-overlay]')));
const bar = await page.$('[data-overlay-bar]');
ok('callout appears in the overlay lane', !!bar);
const barBox = await bar.boundingBox();
await page.mouse.move(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2); await page.mouse.down();
await page.mouse.move(barBox.x + barBox.width / 2 + 80, barBox.y + barBox.height / 2, { steps: 8 }); await page.mouse.up(); await wait();
const movedBar = await (await page.$('[data-overlay-bar]')).boundingBox();
ok('dragging the lane bar retimes the overlay by 1s', Math.abs(movedBar.x - barBox.x - 80) < 3, `${barBox.x} -> ${movedBar.x}`);
ok('callout now spans 2s–5s', /00:03 @ 00:02/.test(await page.$eval('[data-overlay-bar]', (e) => e.title)));
// Default 0.3s fade-in: just after the start the callout is partly transparent.
await page.mouse.click(surfNow.x + 2.1 * 80, surfNow.y + 8); await wait(300);
const fadeOpacity = parseFloat(await page.$eval('[data-shape-overlay]', (e) => e.style.opacity));
ok('callout fades in in the preview', fadeOpacity > 0.1 && fadeOpacity < 0.6, String(fadeOpacity));
await page.mouse.click(surfNow.x + 1 * 80, surfNow.y + 8); await wait(300);
await palette('Add Arrow');
const tip = await page.$('[data-shape-handle="tip"]');
ok('arrow shows tip handle when selected', !!tip);
if (tip) {
  const before = await (await page.$$('[data-shape-overlay]')).at(-1).boundingBox();
  const tb = await tip.boundingBox();
  await page.mouse.move(tb.x + 6, tb.y + 6); await page.mouse.down();
  await page.mouse.move(tb.x + 66, tb.y + 46, { steps: 6 }); await page.mouse.up(); await wait();
  const after = await (await page.$$('[data-shape-overlay]')).at(-1).boundingBox();
  ok('dragging the arrow tip extends it', after.width > before.width + 40 && after.height > before.height + 30,
    `${Math.round(before.width)}x${Math.round(before.height)} -> ${Math.round(after.width)}x${Math.round(after.height)}`);
}
await page.keyboard.press('Escape'); await wait();

// Zoom & pan: on clipA (V1, 0–6s) key zoom 5× at 1s and 1× at 4s.
{
  await page.$eval('[data-timeline-surface]', (el) => { el.parentElement.scrollLeft = 0; }); await wait(200);
  const sf = await (await page.$('[data-timeline-surface]')).boundingBox();
  const seek = async (sec) => { await page.mouse.click(sf.x + sec * 80, sf.y + 8); await wait(250); };
  const clipAEl = await clipEl('clipA');
  const ab = await clipAEl.boundingBox();
  await page.mouse.click(ab.x + ab.width / 2, ab.y + 30); await wait(250);
  const zoomSlider = async () =>
    (await page.$$('xpath/.//label[normalize-space()="Zoom"]/ancestor::div[2]//*[@role="slider"]'))[0];
  await seek(1);
  ok('scrubbing the ruler keeps the clip selected', !!(await zoomSlider()));
  await (await zoomSlider()).focus(); await page.keyboard.press('End'); await wait(250);
  await seek(4);
  await (await zoomSlider()).focus(); await page.keyboard.press('Home'); await wait(250);
  ok('two zoom keyframe diamonds on the clip', (await page.$$('[data-zoom-keyframe]')).length === 2);
  const mainTransform = () => page.$eval('video.relative', (v) => v.style.transform);
  await seek(0.5);
  const held = await mainTransform();
  await seek(2.5);
  const mid = await mainTransform();
  const scaleOf = (tr) => parseFloat(/scale\(([\d.]+)\)/.exec(tr)?.[1] ?? '1');
  ok('preview zooms: held 5× before the first key, eased between', scaleOf(held) === 5 && scaleOf(mid) > 1.5 && scaleOf(mid) < 4.5,
    `${held} | ${mid}`);
  await page.keyboard.press('Escape'); await wait();
}

// JKL shuttle.
{
  const playheadNow = () => page.evaluate(() => {
    const v = document.querySelector('input[aria-label*="layhead"], input[title*="layhead"]');
    return v ? v.value : null;
  });
  const tc = (txt) => { const m = /(\d+):(\d+)\.(\d+)/.exec(txt ?? ''); return m ? +m[1] * 60 + +m[2] + +m[3] / 100 : NaN; };
  await page.$eval('[data-timeline-surface]', (el) => { el.parentElement.scrollLeft = 0; }); await wait(200);
  const sf = await (await page.$('[data-timeline-surface]')).boundingBox();
  await page.mouse.click(sf.x + 3 * 80, sf.y + 8); await wait(200);
  await page.keyboard.press('KeyL'); await page.keyboard.press('KeyL'); await wait(150);
  const badge = await page.$eval('[data-shuttle-badge]', (e) => e.textContent).catch(() => null);
  const t0 = tc(await playheadNow());
  await wait(1000);
  const t1 = tc(await playheadNow());
  ok('L L shuttles forward at 2×', /2×/.test(badge ?? '') && t1 - t0 > 1.5 && t1 - t0 < 2.6, `${badge} Δ=${(t1 - t0).toFixed(2)}`);
  await page.keyboard.press('KeyJ'); await wait(800);
  const t2 = tc(await playheadNow());
  ok('J reverses', t2 < t1, `${t1} → ${t2}`);
  await page.keyboard.press('KeyK'); await wait(300);
  const t3 = tc(await playheadNow());
  await wait(400);
  ok('K stops', tc(await playheadNow()) === t3 && !(await page.$('[data-shuttle-badge]')));
  await page.keyboard.down('KeyK'); await page.keyboard.press('KeyL'); await page.keyboard.up('KeyK'); await wait(200);
  const t4 = tc(await playheadNow());
  ok('K+L steps one frame', Math.abs(t4 - t3 - 1 / 30) < 0.02, `${t3} → ${t4}`);
}

// Export through ffmpeg.wasm and wait for the download button.
await page.keyboard.down('Meta'); await page.keyboard.press('KeyE'); await page.keyboard.up('Meta'); await wait(500);
await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Start export') && !b.disabled), { timeout: 60000 });
await (await btn('Start export')).click();
const exported = await page
  .waitForFunction(() => document.body.innerText.includes('Download'), { timeout: 180000 })
  .then(() => true, () => false);
ok('ffmpeg.wasm export with still + transition + zoom & pan succeeds', exported);
if (!exported) console.log(consoleTail.slice(-40).join('\n'));
if (exported) {
  // Pull the MP4 out of the page and check it: A(6s) + B(4s) + still(5s)
  // = 15s — the dissolve must not change the length.
  const b64 = await page.evaluate(async () => {
    const a = [...document.querySelectorAll('a[download]')].pop();
    const buf = await (await fetch(a.href)).arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  const outPath = join(MEDIA, 'export.mp4');
  if (process.env.KEEP_EXPORT) console.log('EXPORT', outPath);
  writeFileSync(outPath, Buffer.from(b64, 'base64'));
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name', '-of', 'csv=p=0', outPath]).toString();
  const duration = parseFloat(probe.trim().split('\n').pop());
  ok('exported MP4 is H.264 + AAC, 15s long', /h264/.test(probe) && /aac/.test(probe) && Math.abs(duration - 15) < 0.2, probe.replace(/\n/g, ' '));
  // The callout (white box, frame fractions x .35–.65, y .30–.46) was
  // retimed to [2s, 5s): sample inside it, off its text.
  const px = (t) => [...execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', String(t), '-i', outPath, '-frames:v', '1',
    '-vf', 'crop=2:2:710:345', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).subarray(0, 3)];
  const during = px(3);
  const before = px(1);
  ok('callout is burned into the export at its retimed span', Math.min(...during) > 215 && Math.min(...before) <= 215,
    `during ${during} before ${before}`);
}

await browser.close();
process.exit(failures === 0 ? 0 : 1);
