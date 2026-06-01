import { useEffect, useRef } from 'react';
import {
  getPixelsPerSecond,
  useTimelineViewStore,
} from '../../store/useTimelineViewStore';

/**
 * Dashed accent-colored vertical line that appears at a snap target
 * during a clip drag. Like the playhead, it bypasses React's render
 * cycle and updates via direct transform writes — the snap position
 * can flip up to 60 times per second during a fast drag.
 */
export function SnapIndicator({ totalHeight }: { totalHeight: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const apply = (pos: number | null) => {
      const el = ref.current;
      if (!el) return;
      if (pos === null) {
        el.style.opacity = '0';
        return;
      }
      el.style.transform = `translate3d(${pos * getPixelsPerSecond()}px, 0, 0)`;
      el.style.opacity = '1';
    };
    apply(useTimelineViewStore.getState().snapPosition);
    const unsubSnap = useTimelineViewStore.subscribe(
      (s) => s.snapPosition,
      apply,
    );
    const unsubZoom = useTimelineViewStore.subscribe(
      (s) => s.zoomLevel,
      () => apply(useTimelineViewStore.getState().snapPosition),
    );
    return () => {
      unsubSnap();
      unsubZoom();
    };
  }, []);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute left-0 top-0 z-[15] w-px border-l border-dashed border-accent opacity-0 transition-opacity duration-75"
      style={{ height: totalHeight, willChange: 'transform' }}
    />
  );
}
