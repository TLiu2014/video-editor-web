import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  audioFormatSpec,
  buildAudioExtractionPlan,
  buildExportPlan,
  type AudioExtractionOptions,
  type ExportOptions,
} from '../lib/filterGraph';
import type { AudioFormat } from '../types/stt';
import { renderOverlayToPNG } from '../lib/textOverlayPng';
import type { VideoProject } from '../types/timeline';

/**
 * Hook for managing a single, long-lived FFmpeg WebAssembly instance.
 *
 * Uses @ffmpeg/ffmpeg v0.12+ (`new FFmpeg()` API). The instance is held in a
 * ref so it survives re-renders. We default to the single-threaded core
 * because the multi-threaded core requires the page to be served with
 * cross-origin isolation headers (COOP/COEP); the caller may opt into
 * `multiThread: true` once those headers are in place.
 *
 * Memory guardrail: WebAssembly's linear memory caps at ~2GB (or ~4GB with
 * the `memory64` proposal, not yet widely shipped). The UI must keep export
 * resolution at 1080p / 30fps and warn users about long timelines before
 * `renderProject` is invoked. Exceeding the cap aborts the wasm runtime
 * with no recovery path short of a page reload.
 */

/**
 * Same-origin paths to the self-hosted FFmpeg cores. `vite-plugin-
 * static-copy` copies the umd dists from `node_modules/@ffmpeg/core`
 * and `@ffmpeg/core-mt` into `/ffmpeg/core/*` and `/ffmpeg/core-mt/*`
 * at both dev and build time. `import.meta.env.BASE_URL` honours
 * Vite's `base` option for non-root deploys.
 */
const ffmpegBaseURL = (multiThread: boolean): string =>
  `${import.meta.env.BASE_URL}ffmpeg/${multiThread ? 'core-mt' : 'core'}`;

export interface UseFFmpegOptions {
  /** Defaults to whatever `crossOriginIsolated` says at runtime. */
  multiThread?: boolean;
  /** Auto-load on mount. Defaults to true. */
  autoLoad?: boolean;
}

export type RenderPhase =
  | 'idle'
  | 'preparing'
  | 'encoding'
  | 'finalizing'
  | 'done'
  | 'error';

export interface RenderOptions extends ExportOptions {
  onPhase?: (phase: RenderPhase) => void;
}

export interface UseFFmpegResult {
  isLoading: boolean;
  isLoaded: boolean;
  /** True iff the multi-threaded core is in use (~2–3× faster). */
  multiThread: boolean;
  /** 0–100. Reflects the most recent FFmpeg `progress` event. */
  progress: number;
  load: () => Promise<void>;
  /**
   * Render the entire project to an MP4 Blob. Reports phase transitions
   * via `options.onPhase` and continuous progress via the `progress`
   * field on the hook. Caller is responsible for revoking any object
   * URLs created from the returned blob.
   */
  renderProject: (
    project: VideoProject,
    options?: RenderOptions,
  ) => Promise<Blob>;
  /**
   * Mix the timeline's audible audio down to a single mono Blob in
   * the requested format/window. Used by the auto-captions feature,
   * which sends the result to an STT provider. Caller owns the Blob.
   */
  extractAudio: (
    project: VideoProject,
    options?: AudioExtractionOptions,
  ) => Promise<Blob>;
  /**
   * Cheaply cut a `[start, end)` window (seconds) out of an
   * already-extracted compressed audio Blob via stream copy — no
   * re-decode. Used to split a long extraction into provider-sized
   * pieces. The returned Blob's PTS still starts at the window, so
   * callers offset cue times by `start` themselves.
   */
  sliceAudio: (
    audio: Blob,
    window: { start: number; end: number },
    format: AudioFormat,
  ) => Promise<Blob>;
}

/**
 * Browsers expose `crossOriginIsolated === true` only when the page
 * was served with the right COOP/COEP headers. Without that, the
 * multi-threaded core (which uses SharedArrayBuffer) won't load.
 */
function isCrossOriginIsolated(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
  );
}

export function useFFmpeg(options: UseFFmpegOptions = {}): UseFFmpegResult {
  // Default to the multi-thread core whenever the page is cross-origin
  // isolated — that's the only thing the user can't change by clicking
  // a button. Explicit `multiThread: false` still wins.
  const {
    multiThread = isCrossOriginIsolated(),
    autoLoad = true,
  } = options;

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const loadPromiseRef = useRef<Promise<void> | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [progress, setProgress] = useState(0);

  const getInstance = useCallback((): FFmpeg => {
    if (!ffmpegRef.current) {
      ffmpegRef.current = new FFmpeg();
    }
    return ffmpegRef.current;
  }, []);

  const load = useCallback(async (): Promise<void> => {
    if (loadPromiseRef.current) return loadPromiseRef.current;

    const ffmpeg = getInstance();
    setIsLoading(true);

    const promise = (async () => {
      const base = ffmpegBaseURL(multiThread);

      ffmpeg.on('progress', ({ progress: p }) => {
        setProgress(Math.min(100, Math.max(0, Math.round(p * 100))));
      });

      // Self-hosted cores are same-origin, so we can hand FFmpeg
      // these URLs directly — no `toBlobURL` indirection needed.
      const config: Parameters<FFmpeg['load']>[0] = {
        coreURL: `${base}/ffmpeg-core.js`,
        wasmURL: `${base}/ffmpeg-core.wasm`,
      };
      if (multiThread) {
        config.workerURL = `${base}/ffmpeg-core.worker.js`;
      }

      await ffmpeg.load(config);
      setIsLoaded(true);
    })();

    loadPromiseRef.current = promise;

    try {
      await promise;
    } catch (err) {
      // Allow retry by clearing the cached promise.
      loadPromiseRef.current = null;
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [multiThread, getInstance]);

  useEffect(() => {
    if (autoLoad) void load();
    return () => {
      // Tear down on unmount so wasm memory is reclaimable. Subsequent
      // mounts will instantiate fresh.
      ffmpegRef.current?.terminate();
      ffmpegRef.current = null;
      loadPromiseRef.current = null;
    };
    // `load` is stable across renders thanks to useCallback's deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderProject = useCallback(
    async (
      project: VideoProject,
      renderOpts: RenderOptions = {},
    ): Promise<Blob> => {
      const { onPhase, ...exportOpts } = renderOpts;
      const phase = (p: RenderPhase) => onPhase?.(p);

      try {
        phase('preparing');
        if (!isLoaded) await load();
        const ffmpeg = getInstance();
        const plan = buildExportPlan(project, exportOpts);

        // Reset progress for this render — the load step may have left
        // it at a stale value.
        setProgress(0);

        // Write every source file to the wasm FS. `fetchFile` reads a
        // File/Blob/URL into a Uint8Array; we write under the name the
        // filter graph expects.
        for (const input of plan.inputs) {
          const bytes = await fetchFile(input.file);
          await ffmpeg.writeFile(input.name, bytes);
        }

        // Rasterize each overlay to a PNG and write it alongside.
        // Done serially because the canvas rasterizer is synchronous
        // and overlap would just contend for the main thread.
        for (const ov of plan.overlayInputs) {
          const rendered = await renderOverlayToPNG(ov.overlay, project);
          await ffmpeg.writeFile(ov.name, rendered.png);
        }

        phase('encoding');
        const exitCode = await ffmpeg.exec(plan.args);
        if (exitCode !== 0) {
          throw new Error(
            `ffmpeg exited with code ${exitCode}. Check the browser console for the full log.`,
          );
        }

        phase('finalizing');
        const data = await ffmpeg.readFile(plan.outputFile);
        const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
        const blob = new Blob([bytes as BlobPart], { type: 'video/mp4' });

        // Reclaim FS space — wasm linear memory is precious.
        try {
          await ffmpeg.deleteFile(plan.outputFile);
          for (const input of plan.inputs) {
            await ffmpeg.deleteFile(input.name);
          }
          for (const ov of plan.overlayInputs) {
            await ffmpeg.deleteFile(ov.name);
          }
        } catch {
          // Best-effort cleanup; ignore if files are already gone.
        }

        phase('done');
        return blob;
      } catch (err) {
        phase('error');
        throw err;
      }
    },
    [isLoaded, load, getInstance],
  );

  const extractAudio = useCallback(
    async (
      project: VideoProject,
      options: AudioExtractionOptions = {},
    ): Promise<Blob> => {
      if (!isLoaded) await load();
      const ffmpeg = getInstance();
      const plan = buildAudioExtractionPlan(project, options);

      setProgress(0);
      for (const input of plan.inputs) {
        const bytes = await fetchFile(input.file);
        await ffmpeg.writeFile(input.name, bytes);
      }

      const exitCode = await ffmpeg.exec(plan.args);
      if (exitCode !== 0) {
        throw new Error(
          `Audio extraction failed (ffmpeg code ${exitCode}). Check the browser console for the full log.`,
        );
      }

      const data = await ffmpeg.readFile(plan.outputFile);
      const bytes =
        data instanceof Uint8Array
          ? data
          : new TextEncoder().encode(String(data));
      const blob = new Blob([bytes as BlobPart], { type: plan.mime });

      try {
        await ffmpeg.deleteFile(plan.outputFile);
        for (const input of plan.inputs) {
          await ffmpeg.deleteFile(input.name);
        }
      } catch {
        // Best-effort cleanup.
      }

      return blob;
    },
    [isLoaded, load, getInstance],
  );

  const sliceAudio = useCallback(
    async (
      audio: Blob,
      window: { start: number; end: number },
      format: AudioFormat,
    ): Promise<Blob> => {
      if (!isLoaded) await load();
      const ffmpeg = getInstance();
      const { ext, mime } = audioFormatSpec(format);
      const inName = `slice_in.${ext}`;
      const outName = `slice_out.${ext}`;

      await ffmpeg.writeFile(
        inName,
        new Uint8Array(await audio.arrayBuffer()),
      );

      // `-ss` before `-i` seeks the input cheaply; `-c copy` muxes the
      // existing AAC frames without re-encoding, so this is fast and
      // adds no quality loss.
      const duration = Math.max(0.05, window.end - window.start);
      const args = [
        '-ss',
        window.start.toFixed(3),
        '-i',
        inName,
        '-t',
        duration.toFixed(3),
        '-c',
        'copy',
        '-y',
        outName,
      ];

      const exitCode = await ffmpeg.exec(args);
      if (exitCode !== 0) {
        throw new Error(`Audio split failed (ffmpeg code ${exitCode}).`);
      }

      const data = await ffmpeg.readFile(outName);
      const bytes =
        data instanceof Uint8Array
          ? data
          : new TextEncoder().encode(String(data));
      const blob = new Blob([bytes as BlobPart], { type: mime });

      try {
        await ffmpeg.deleteFile(inName);
        await ffmpeg.deleteFile(outName);
      } catch {
        // Best-effort cleanup.
      }

      return blob;
    },
    [isLoaded, load, getInstance],
  );

  return {
    isLoading,
    isLoaded,
    multiThread,
    progress,
    load,
    renderProject,
    extractAudio,
    sliceAudio,
  };
}
