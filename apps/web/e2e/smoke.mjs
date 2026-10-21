// Browser smoke test for core timeline editing. Drives a running dev
// server with the locally installed Chrome. See e2e/README.md.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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

let failures = 0;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new', defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
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
await (await page.$('input[type=file][accept="video/*,audio/*"]')).uploadFile(`${MEDIA}/clipA.mp4`, `${MEDIA}/clipB.mp4`);
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
await page.mouse.click(a.x + 160, a.y - 30); await wait(); // ruler click → playhead
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
// right-click menu
const last = (await page.$$('[data-track-id] > div[title]'))[0];
const lb = await last.boundingBox();
await page.mouse.click(lb.x + lb.width / 2, lb.y + 20, { button: 'right' }); await wait();
ok('context menu opens', !!(await page.$('[role=menu]')));
await browser.close();
process.exit(failures === 0 ? 0 : 1);
