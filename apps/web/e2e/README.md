# Browser smoke test

`smoke.mjs` drives the editor in headless Chrome. It covers importing into the library, resizing panels, drag-to-reorder, cross-track drag, the range shortcuts (X / '), undo, split, ⌘J join, delete after split, the `?` sheet and the clip context menu.

Requirements: a running dev server, Google Chrome, and `ffmpeg` on `PATH` (used to generate two tiny test clips).

```sh
pnpm dev                                # in apps/web, serves :5173
node e2e/smoke.mjs                      # exits non-zero on any FAIL
EDITOR_URL=http://localhost:5179/ CHROME_PATH=/path/to/chrome node e2e/smoke.mjs
```
