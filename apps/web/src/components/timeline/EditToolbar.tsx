import {
  BracketsIcon,
  CropIcon,
  GripVerticalIcon,
  PinIcon,
  ScissorsIcon,
  SquareDashedIcon,
  Trash2Icon,
  XSquareIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTimelineStore } from '../../store/useTimelineStore';
import { useTimelineViewStore } from '../../store/useTimelineViewStore';

/**
 * The clip-editing controls (Split, Mark In/Out, Mark Range, Trim,
 * Delete, Clear). Rendered either inline inside the Timeline
 * header or as a draggable floating panel anchored at the user's
 * chosen page coordinates — controlled by `editToolbarFloat` in
 * the view store.
 */
export function EditToolbar() {
  const float = useTimelineViewStore((s) => s.editToolbarFloat);
  if (float === null) {
    return <ToolbarRow detached={false} />;
  }
  return <FloatingToolbar position={float} />;
}

function FloatingToolbar({ position }: { position: { x: number; y: number } }) {
  const setFloat = useTimelineViewStore((s) => s.setEditToolbarFloat);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerX: number;
    pointerY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Clamp to viewport on mount and resize so the panel never
  // strands itself off-screen (e.g. after a window resize).
  useEffect(() => {
    const clamp = () => {
      const el = panelRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width - 8;
      const maxY = window.innerHeight - rect.height - 8;
      const next = {
        x: Math.max(8, Math.min(maxX, position.x)),
        y: Math.max(8, Math.min(maxY, position.y)),
      };
      if (next.x !== position.x || next.y !== position.y) {
        setFloat(next);
      }
    };
    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [position, setFloat]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      originX: position.x,
      originY: position.y,
    };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setFloat({
      x: d.originX + (e.clientX - d.pointerX),
      y: d.originY + (e.clientY - d.pointerY),
    });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <div
      ref={panelRef}
      className="no-select fixed z-40 flex items-center gap-1 rounded-lg border border-border bg-panel p-1 shadow-2xl"
      style={{ left: position.x, top: position.y }}
    >
      {/* Drag handle — only this region initiates a drag, so the
          buttons inside still receive clicks normally. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={
          dragging
            ? 'flex h-9 cursor-grabbing items-center px-1 text-text-secondary'
            : 'flex h-9 cursor-grab items-center px-1 text-text-muted hover:text-text-primary'
        }
        title="Drag to move"
      >
        <GripVerticalIcon className="size-4" />
      </div>
      <ToolbarRow detached={true} />
      <button
        type="button"
        onClick={() => setFloat(null)}
        className="ml-1 flex h-9 items-center justify-center rounded px-1.5 text-text-muted transition hover:bg-chrome hover:text-text-primary"
        title="Re-dock toolbar"
      >
        <PinIcon className="size-4" />
      </button>
    </div>
  );
}

function ToolbarRow({ detached }: { detached: boolean }) {
  const splitClipsAtPlayhead = useTimelineStore(
    (s) => s.splitClipsAtPlayhead,
  );
  const setInPoint = useTimelineStore((s) => s.setInPoint);
  const setOutPoint = useTimelineStore((s) => s.setOutPoint);
  const markRangeAtPlayhead = useTimelineStore(
    (s) => s.markRangeAtPlayhead,
  );
  const trimToRange = useTimelineStore((s) => s.trimToRange);
  const deleteRange = useTimelineStore((s) => s.deleteRange);
  const clearInOutPoints = useTimelineStore((s) => s.clearInOutPoints);
  const inPoint = useTimelineStore((s) => s.inPoint);
  const outPoint = useTimelineStore((s) => s.outPoint);
  const hasRange = inPoint !== null || outPoint !== null;
  const hasBothMarks = inPoint !== null && outPoint !== null;
  const setFloat = useTimelineViewStore((s) => s.setEditToolbarFloat);

  return (
    <div className="flex items-center gap-1">
      <ToolbarButton
        icon={<ScissorsIcon className="size-4" />}
        label="Split"
        title="Split at playhead (S)"
        onClick={() => {
          const s = useTimelineStore.getState();
          splitClipsAtPlayhead(
            s.selectedClipIds.length > 0
              ? { onlySelectedIds: s.selectedClipIds }
              : undefined,
          );
        }}
      />
      <ToolbarButton
        icon={<SquareDashedIcon className="size-4" />}
        label="Mark In"
        title="Mark in-point at playhead (I)"
        onClick={() =>
          setInPoint(useTimelineStore.getState().playheadPosition)
        }
      />
      <ToolbarButton
        icon={<SquareDashedIcon className="size-4" />}
        label="Mark Out"
        title="Mark out-point at playhead (O)"
        onClick={() =>
          setOutPoint(useTimelineStore.getState().playheadPosition)
        }
      />
      <ToolbarButton
        icon={<BracketsIcon className="size-4" />}
        label="Mark Range"
        title="Mark a small range around the playhead"
        onClick={markRangeAtPlayhead}
      />
      <ToolbarButton
        icon={<CropIcon className="size-4" />}
        label="Trim to range"
        title="Keep the in/out range, drop everything else"
        onClick={trimToRange}
        disabled={!hasRange}
      />
      <ToolbarButton
        icon={<Trash2Icon className="size-4" />}
        label="Delete range"
        title="Delete what's in the range and close the gap"
        onClick={deleteRange}
        disabled={!hasBothMarks}
      />
      {hasRange ? (
        <ToolbarButton
          icon={<XSquareIcon className="size-4" />}
          label="Clear"
          title="Clear in/out range"
          onClick={clearInOutPoints}
          subtle
        />
      ) : null}
      {!detached ? (
        <button
          type="button"
          onClick={() =>
            setFloat({ x: window.innerWidth - 520, y: 120 })
          }
          className="ml-1 flex h-7 items-center justify-center rounded px-1.5 text-text-muted transition hover:bg-chrome hover:text-text-primary"
          title="Pop out (drag anywhere)"
        >
          <PinIcon className="size-4 rotate-45" />
        </button>
      ) : null}
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  title,
  onClick,
  disabled,
  subtle,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        subtle
          ? 'flex items-center gap-1.5 rounded px-2 py-1 text-[12px] text-text-muted transition hover:bg-chrome hover:text-text-primary'
          : 'flex items-center gap-1.5 rounded px-2 py-1 text-[12px] text-text-secondary transition hover:bg-chrome hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-secondary'
      }
      title={title}
    >
      {icon}
      {label}
    </button>
  );
}
