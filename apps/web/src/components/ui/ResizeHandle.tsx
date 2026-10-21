import clsx from 'clsx';
import { useRef, useState } from 'react';
import { useLayoutStore, type PanelSize } from '../../store/useLayoutStore';

/**
 * Draggable border between two main panels. Sits on the seam with a
 * wider invisible hit area; dragging resizes `panel` (double-click
 * resets it). `direction` says which way the panel grows: for a panel
 * left of the seam dragging right grows it (+1); for one right of /
 * below the seam dragging right / down shrinks it (-1).
 */
export function ResizeHandle({
  panel,
  axis,
  direction,
}: {
  panel: PanelSize;
  axis: 'x' | 'y';
  direction: 1 | -1;
}) {
  const setSize = useLayoutStore((s) => s.setSize);
  const resetSize = useLayoutStore((s) => s.resetSize);
  const dragRef = useRef<{ start: number; size: number } | null>(null);
  const [active, setActive] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      start: axis === 'x' ? e.clientX : e.clientY,
      size: useLayoutStore.getState()[panel],
    };
    setActive(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const pos = axis === 'x' ? e.clientX : e.clientY;
    setSize(panel, d.size + (pos - d.start) * direction);
  };
  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setActive(false);
  };

  return (
    <div
      className={clsx('relative z-20 shrink-0', axis === 'x' ? 'w-0' : 'h-0')}
    >
      <div
        role="separator"
        aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
        title="Drag to resize · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => resetSize(panel)}
        className={clsx(
          'absolute transition-colors hover:bg-accent/60',
          axis === 'x'
            ? '-left-[3px] inset-y-0 w-[6px] cursor-col-resize'
            : '-top-[3px] inset-x-0 h-[6px] cursor-row-resize',
          active && 'bg-accent',
        )}
      />
    </div>
  );
}
