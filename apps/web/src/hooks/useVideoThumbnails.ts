import { useEffect, useState } from 'react';
import {
  getCachedThumbnails,
  loadThumbnails,
  type VideoThumbnailSet,
} from '../lib/videoThumbnails';

/**
 * Returns the cached `ImageBitmap` thumbnail set for a video file,
 * or null while it's being decoded. Re-mounting for the same file
 * is free — the cache lives in `lib/videoThumbnails.ts`.
 */
export function useVideoThumbnails(file: File): VideoThumbnailSet | null {
  const [thumbs, setThumbs] = useState<VideoThumbnailSet | null>(() =>
    getCachedThumbnails(file),
  );

  useEffect(() => {
    const cached = getCachedThumbnails(file);
    if (cached) {
      setThumbs(cached);
      return;
    }
    let cancelled = false;
    loadThumbnails(file)
      .then((set) => {
        if (!cancelled) setThumbs(set);
      })
      .catch(() => {
        if (!cancelled) setThumbs(null);
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  return thumbs;
}
