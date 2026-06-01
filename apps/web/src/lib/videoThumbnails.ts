/**
 * Decode and cache a small grid of preview thumbnails from a video
 * file. Sequential seek-and-draw through a detached `<video>` —
 * slow but reliable across browsers and codecs.
 *
 * Cache key: the `File` instance, via WeakMap. Split halves of a
 * clip share the source `File`, so they share thumbnails for free.
 *
 * `ImageBitmap` is the cheap-to-draw representation; the clip's
 * canvas just `drawImage`s the matching bitmap for each tile.
 */

export interface VideoThumbnailSet {
  bitmaps: ImageBitmap[];
  width: number;
  height: number;
}

const THUMBNAIL_COUNT = 16;
const THUMBNAIL_WIDTH = 96;
const THUMBNAIL_HEIGHT = 54; // 16:9 — matches export aspect

type CacheValue = VideoThumbnailSet | Promise<VideoThumbnailSet>;
const cache = new WeakMap<File, CacheValue>();

export function getCachedThumbnails(file: File): VideoThumbnailSet | null {
  const entry = cache.get(file);
  return entry && !(entry instanceof Promise) ? entry : null;
}

export async function loadThumbnails(file: File): Promise<VideoThumbnailSet> {
  const existing = cache.get(file);
  if (existing && !(existing instanceof Promise)) return existing;
  if (existing instanceof Promise) return existing;

  const promise = extract(file);
  cache.set(file, promise);
  try {
    const result = await promise;
    cache.set(file, result);
    return result;
  } catch (err) {
    cache.delete(file);
    throw err;
  }
}

async function extract(file: File): Promise<VideoThumbnailSet> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.crossOrigin = 'anonymous';
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`failed to load metadata for "${file.name}"`));
      };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const count = duration > 0 ? THUMBNAIL_COUNT : 1;
    const bitmaps: ImageBitmap[] = [];

    for (let i = 0; i < count; i++) {
      // Sample the midpoint of each evenly-spaced segment so the
      // first and last thumbnails aren't right at t=0 / t=duration,
      // which often look like black frames.
      const t = duration > 0 ? ((i + 0.5) / count) * duration : 0;
      await seekTo(video, t);
      bitmaps.push(await snapshotFrame(video));
    }

    return {
      bitmaps,
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
    };
  } finally {
    // Releasing the source aggressively — keeping a hidden <video>
    // alive holds the file's decoded bytes for as long as React
    // keeps a reference.
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('seek failed'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = Math.max(0, time);
  });
}

async function snapshotFrame(
  video: HTMLVideoElement,
): Promise<ImageBitmap> {
  // OffscreenCanvas where available for cheaper compositing; the
  // detached <canvas> path is identical in output.
  const useOffscreen = typeof OffscreenCanvas !== 'undefined';
  if (useOffscreen) {
    const canvas = new OffscreenCanvas(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
    ctx.drawImage(video, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    return canvas.transferToImageBitmap();
  }
  const canvas = document.createElement('canvas');
  canvas.width = THUMBNAIL_WIDTH;
  canvas.height = THUMBNAIL_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(video, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  return createImageBitmap(canvas);
}
