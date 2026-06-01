import { MinusIcon, PlusIcon } from 'lucide-react';
import {
  ZOOM_LEVELS_PPS,
  useTimelineViewStore,
} from '../../store/useTimelineViewStore';
import { Button } from '../ui/Button';

export function ZoomControls() {
  const zoomLevel = useTimelineViewStore((s) => s.zoomLevel);
  const zoomIn = useTimelineViewStore((s) => s.zoomIn);
  const zoomOut = useTimelineViewStore((s) => s.zoomOut);
  const resetZoom = useTimelineViewStore((s) => s.resetZoom);

  const canZoomOut = zoomLevel > 0;
  const canZoomIn = zoomLevel < ZOOM_LEVELS_PPS.length - 1;
  const pps = ZOOM_LEVELS_PPS[zoomLevel];

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={<MinusIcon />}
        disabled={!canZoomOut}
        onClick={zoomOut}
        title="Zoom out (-)"
      />
      <button
        type="button"
        onClick={resetZoom}
        className="rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-text-secondary transition hover:bg-chrome hover:text-text-primary"
        title="Reset zoom (0)"
      >
        {pps} px/s
      </button>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={<PlusIcon />}
        disabled={!canZoomIn}
        onClick={zoomIn}
        title="Zoom in (=)"
      />
    </div>
  );
}
