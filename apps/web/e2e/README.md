# Browser smoke test

`smoke.mjs` drives the editor in headless Chrome. It covers importing into the library, resizing panels, drag-to-reorder, cross-track drag, the range shortcuts (X / '), undo, split, ⌘J join, delete after split, the `?` sheet, PiP drag and resize, `.srt` import, the clip context menu, still images, transitions, and a real ffmpeg.wasm export. The exported MP4's codecs and length are checked with ffprobe.

Requirements: a running dev server, Google Chrome, and `ffmpeg` and `ffprobe` on `PATH`. They generate the test media and check the export.

```sh
pnpm dev                                # in apps/web, serves :5173
node e2e/smoke.mjs                      # exits non-zero on any FAIL
EDITOR_URL=http://localhost:5179/ CHROME_PATH=/path/to/chrome node e2e/smoke.mjs
```
