import { useCallback, useRef } from 'react';
import { formatTime } from '../../lib/formatTime';
import {
  chooseMajorInterval,
  collectSnapTargets,
  findNearestTarget,
} from '../../lib/snapping';
import { useTimelineStore } from '../../store/useTimelineStore';
import {
  usePixelsPerSecond,
  useTimelineViewStore,
} from '../../store/useTimelineViewStore';
import { RULER_HEIGHT, SNAP_THRESHOLD_PX } from './constants';

/**
 * Time ruler with click-and-drag scrubbing. Pointer capture is
 * acquired on pointer-down so the drag survives leaving the ruler
 * row and the user can scrub by sliding into the tracks area below.
 *
 * Tick density adapts to the current zoom: at narrower zoom the
 * major ticks span larger time intervals so labels don't collide.
 * The target is roughly one major tick per ~80 px.
 */
export function Ruler({ duration }: { duration: number }) {
  const pps = usePixelsPerSecond();
  const updatePlayhead = useTimelineStore((s) => s.updatePlayhead);
  const setSnapPosition = useTimelineViewStore((s) => s.setSnapPosition);
  const rectRef = useRef<DOMRect | null>(null);

  const seek = useCallback(
    (clientX: number) => {
      const rect = rectRef.current;
      if (!rect) return;
      const x = Math.max(0, clientX - rect.left);
      const raw = x / pps;

      // Snap the playhead to clip edges (origin + every clip/overlay
      // start/end + project end + ruler-grid major ticks). Same
      // threshold the clip-drag uses, scaled to seconds via current pps.
      const project = useTimelineStore.getState().currentProject;
      const targets = project
        ? collectSnapTargets(project, {
            gridInterval: chooseMajorInterval(pps),
            gridLimitSec: duration,
          })
        : [0];
      const snap = findNearestTarget(raw, targets, SNAP_THRESHOLD_PX / pps);
      if (snap !== null) {
        updatePlayhead(snap);
        setSnapPosition(snap);
      } else {
        updatePlayhead(raw);
        setSnapPosition(null);
      }
    },
    [pps, updatePlayhead, setSnapPosition, duration],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    rectRef.current = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    seek(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    seek(e.clientX);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    rectRef.current = null;
    setSnapPosition(null);
  };

  const majorInterval = chooseMajorInterval(pps);
  const minorInterval = majorInterval / 5;

  // Render minor ticks at every minorInterval, major (with label) at
  // every 5th. Ticks are generated from an integer index — summing
  // `t += minorInterval` drifts (0.2 × 10 = 1.9999…), and formatTime
  // floors, so labels came out as 00:00, 00:01, 00:01, 00:03…
  const ticks: { x: number; major: boolean; label: string | null }[] = [];
  const count = Math.floor(duration / minorInterval + 0.25);
  for (let i = 0; i <= count; i++) {
    const isMajor = i % 5 === 0;
    const t = (i / 5) * majorInterval;
    ticks.push({
      x: t * pps,
      major: isMajor,
      label: isMajor ? formatTime(Math.round(t * 1000) / 1000, false) : null,
    });
  }

  return (
    <div
      className="relative cursor-ew-resize border-b border-border bg-panel"
      style={{ height: RULER_HEIGHT, width: duration * pps }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {ticks.map((t, i) => (
        <div
          key={i}
          className={t.major ? 'absolute bg-border-strong' : 'absolute bg-border'}
          style={{
            left: t.x,
            bottom: 0,
            width: 1,
            height: t.major ? 14 : 7,
          }}
        />
      ))}
      {ticks
        .filter((t) => t.label !== null)
        .map((t, i) => (
          <span
            key={`label-${i}`}
            className="pointer-events-none absolute top-1.5 select-none font-mono text-[12px] text-text-muted"
            style={{ left: t.x + 4 }}
          >
            {t.label}
          </span>
        ))}
    </div>
  );
}

