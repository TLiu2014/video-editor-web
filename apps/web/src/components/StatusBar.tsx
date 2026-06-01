import clsx from 'clsx';
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  Loader2Icon,
} from 'lucide-react';
import {
  useFFmpegContext,
  usePersistenceContext,
} from '../providers/AppProviders';
import { useTimelineStore } from '../store/useTimelineStore';
import { AudioMeter } from './AudioMeter';

export function StatusBar() {
  const { isLoaded, isLoading, multiThread, progress } = useFFmpegContext();
  const { isSaving, lastSavedAt } = usePersistenceContext();
  const hasProject = useTimelineStore((s) => s.currentProject !== null);
  const ffmpegValue = isLoading
    ? `loading ${progress}%`
    : isLoaded
      ? `ready · ${multiThread ? 'MT' : 'ST'}`
      : 'idle';

  return (
    <footer className="no-select flex h-7 shrink-0 items-center justify-between border-t border-border bg-panel px-3 text-[11px] text-text-muted">
      <div className="flex items-center gap-4">
        <StatusItem
          label="FFmpeg"
          icon={
            isLoading ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : isLoaded ? (
              <CheckCircle2Icon className="size-3 text-emerald-500" />
            ) : (
              <CircleDashedIcon className="size-3" />
            )
          }
          value={ffmpegValue}
        />
        <StatusItem
          label="Storage"
          icon={
            isSaving ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : lastSavedAt ? (
              <CheckCircle2Icon className="size-3 text-emerald-500" />
            ) : (
              <CircleDashedIcon className="size-3" />
            )
          }
          value={
            isSaving
              ? 'saving…'
              : lastSavedAt
                ? `saved ${new Date(lastSavedAt).toLocaleTimeString()}`
                : hasProject
                  ? 'pending'
                  : 'idle'
          }
        />
      </div>
      <div className="flex items-center gap-4">
        <AudioMeter />
        <div className="font-mono text-text-muted/70">
          video-editor-web · client-only
        </div>
      </div>
    </footer>
  );
}

function StatusItem({
  label,
  value,
  icon,
  className,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex items-center gap-1.5', className)}>
      <span className="text-text-muted/70">{label}</span>
      {icon}
      <span className="text-text-secondary">{value}</span>
    </div>
  );
}
