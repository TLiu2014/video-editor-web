/**
 * Still-image support: what counts as an image, the default and
 * maximum length of a still clip, and normalizing image files into a
 * format both the browser and ffmpeg.wasm decode.
 */

/** Length of a still clip when it's first placed on the timeline. */
export const STILL_DEFAULT_DURATION = 5;
/** Longest a still clip can be trimmed out to (its "source" length). */
export const STILL_MAX_DURATION = 3600;

/** Formats ffmpeg.wasm's image demuxers read directly. */
const PASSTHROUGH_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * Return a File ffmpeg can loop as a still. PNG / JPEG / WebP pass
 * through untouched; anything else the browser can decode (SVG, GIF,
 * BMP, AVIF…) is drawn to a canvas and re-encoded as PNG, keeping
 * transparency. GIFs become their first frame. Throws when the
 * browser can't decode the file at all (e.g. HEIC in Chrome).
 */
export async function normalizeImageFile(file: File): Promise<File> {
  if (PASSTHROUGH_TYPES.has(file.type)) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // SVGs without intrinsic size report 0×0; give them a sane canvas.
    const width = img.naturalWidth || 1920;
    const height = img.naturalHeight || 1080;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2D context unavailable');
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (!blob) throw new Error(`could not re-encode "${file.name}"`);
    const base = file.name.replace(/\.[^.]+$/, '');
    return new File([blob], `${base}.png`, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

const stillUrls = new WeakMap<File, string>();

/**
 * A long-lived object URL for a still image. Shared by every preview
 * surface showing the same file so switching between still clips
 * doesn't re-decode; stills are small, so the URLs aren't revoked.
 */
export function stillUrl(file: File): string {
  let url = stillUrls.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    stillUrls.set(file, url);
  }
  return url;
}
