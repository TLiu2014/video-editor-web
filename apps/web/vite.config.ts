import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// COOP/COEP make the page cross-origin isolated, which unlocks
// `crossOriginIsolated === true` in the runtime and lets useFFmpeg
// load the multi-threaded @ffmpeg/core-mt build. Self-hosting the
// FFmpeg cores below means all wasm assets are same-origin and
// trivially embeddable under COEP.
const crossOriginHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/**
 * Self-host the FFmpeg WebAssembly cores from `@ffmpeg/core` and
 * `@ffmpeg/core-mt`. In dev, a middleware streams the files straight
 * out of `node_modules`. On build, the same files are copied into
 * `dist/ffmpeg/{core,core-mt}/`. Either way `useFFmpeg` only ever
 * fetches `/ffmpeg/{core,core-mt}/ffmpeg-core.{js,wasm,worker.js}`
 * from the same origin — no CDN dependency, no toBlobURL gymnastics.
 */
function ffmpegCorePlugin(): Plugin {
  const mappings: { url: string; source: string }[] = [
    {
      url: '/ffmpeg/core/ffmpeg-core.js',
      source: 'node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js',
    },
    {
      url: '/ffmpeg/core/ffmpeg-core.wasm',
      source: 'node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm',
    },
    {
      url: '/ffmpeg/core-mt/ffmpeg-core.js',
      source: 'node_modules/@ffmpeg/core-mt/dist/umd/ffmpeg-core.js',
    },
    {
      url: '/ffmpeg/core-mt/ffmpeg-core.wasm',
      source: 'node_modules/@ffmpeg/core-mt/dist/umd/ffmpeg-core.wasm',
    },
    {
      url: '/ffmpeg/core-mt/ffmpeg-core.worker.js',
      source: 'node_modules/@ffmpeg/core-mt/dist/umd/ffmpeg-core.worker.js',
    },
  ];

  const contentTypeFor = (path: string): string =>
    path.endsWith('.wasm')
      ? 'application/wasm'
      : path.endsWith('.js')
        ? 'application/javascript'
        : 'application/octet-stream';

  return {
    name: 'ffmpeg-core-host',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        // Vite may pass query strings; strip them for matching.
        const path = req.url.split('?')[0];
        const hit = mappings.find((m) => m.url === path);
        if (!hit) return next();
        const abs = resolve(hit.source);
        if (!existsSync(abs)) return next();
        res.setHeader('Content-Type', contentTypeFor(hit.source));
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(abs).pipe(res);
      });
    },
    writeBundle(options) {
      const outDir = options.dir ?? 'dist';
      for (const { url, source } of mappings) {
        const dest = resolve(outDir, url.replace(/^\//, ''));
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(resolve(source), dest);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ffmpegCorePlugin()],
  server: { headers: crossOriginHeaders },
  preview: { headers: crossOriginHeaders },
});
