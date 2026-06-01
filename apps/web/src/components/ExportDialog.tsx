import clsx from 'clsx';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FilmIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RenderPhase } from '../hooks/useFFmpeg';
import {
  exportMemoryRisk,
  totalSourceBytes,
  type MemoryRisk,
} from '../lib/projectMetrics';
import { useFFmpegContext } from '../providers/AppProviders';
import { useTimelineStore } from '../store/useTimelineStore';
import { Button } from './ui/Button';
import { Dialog, DialogContent } from './ui/Dialog';

const PHASE_LABEL: Record<RenderPhase, string> = {
  idle: 'Ready',
  preparing: 'Preparing media…',
  encoding: 'Encoding',
  finalizing: 'Finalizing output…',
  done: 'Done',
  error: 'Failed',
};

export function ExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { isLoaded, isLoading, progress, renderProject } = useFFmpegContext();
  const projectName = useTimelineStore((s) => s.currentProject?.name ?? null);
  const [phase, setPhase] = useState<RenderPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultBytes, setResultBytes] = useState<number>(0);

  // Track the current object URL so we can revoke it across re-runs
  // and on close.
  const urlRef = useRef<string | null>(null);
  const setUrl = useCallback((url: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setResultUrl(url);
  }, []);

  // Revoke + reset whenever the dialog closes so the next open is fresh.
  useEffect(() => {
    if (open) return;
    setUrl(null);
    setPhase('idle');
    setError(null);
    setResultBytes(0);
  }, [open, setUrl]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const downloadName = useCallback(() => {
    const base = (projectName ?? 'export').replace(/[^a-z0-9-_]+/gi, '_');
    return `${base || 'export'}.mp4`;
  }, [projectName]);

  const startRender = async () => {
    setError(null);
    setUrl(null);
    setResultBytes(0);
    try {
      const project = useTimelineStore.getState().currentProject;
      if (!project) throw new Error('No project loaded.');
      const blob = await renderProject(project, { onPhase: setPhase });
      setResultBytes(blob.size);
      setUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const projectBytes = useTimelineStore((s) =>
    s.currentProject ? totalSourceBytes(s.currentProject) : 0,
  );
  const memoryRisk = exportMemoryRisk(projectBytes);

  const isRendering =
    phase === 'preparing' || phase === 'encoding' || phase === 'finalizing';
  const showProgressBar = phase === 'encoding';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Export project"
        description="Renders the timeline locally with FFmpeg.wasm. Nothing leaves your browser."
      >
        <div className="flex flex-col gap-5">
          <ExportSummary totalBytes={projectBytes} />

          {memoryRisk !== 'ok' && phase === 'idle' && !resultUrl ? (
            <MemoryNotice risk={memoryRisk} bytes={projectBytes} />
          ) : null}

          {phase === 'idle' && !error && !resultUrl ? (
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                icon={<FilmIcon />}
                onClick={startRender}
                disabled={
                  !isLoaded || isLoading || memoryRisk === 'block'
                }
              >
                {memoryRisk === 'block'
                  ? 'Project too large'
                  : isLoaded
                    ? 'Start export'
                    : isLoading
                      ? 'Loading FFmpeg…'
                      : 'FFmpeg not ready'}
              </Button>
            </div>
          ) : null}

          {isRendering ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[12px] text-text-secondary">
                <span>{PHASE_LABEL[phase]}</span>
                {showProgressBar ? (
                  <span className="font-mono tabular-nums text-text-primary">
                    {progress}%
                  </span>
                ) : null}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-chrome">
                <div
                  className="h-full bg-accent transition-[width] duration-150 ease-out"
                  style={{
                    width: showProgressBar ? `${progress}%` : '100%',
                  }}
                />
              </div>
              <p className="text-[11px] text-text-muted">
                Larger projects take longer — encoding runs single-threaded in
                wasm.
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
              {error}
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setPhase('idle');
                  }}
                >
                  Dismiss
                </Button>
                <Button variant="primary" size="sm" onClick={startRender}>
                  Try again
                </Button>
              </div>
            </div>
          ) : null}

          {phase === 'done' && resultUrl ? (
            <div className="flex items-center justify-between rounded-md border border-border bg-panel px-3 py-3">
              <div className="flex items-center gap-2.5">
                <CheckCircle2Icon className="size-5 text-emerald-500" />
                <div className="flex flex-col leading-tight">
                  <span className="text-[13px] text-text-primary">
                    Export ready
                  </span>
                  <span className="font-mono text-[11px] text-text-muted">
                    {formatBytes(resultBytes)} · MP4
                  </span>
                </div>
              </div>
              <a
                href={resultUrl}
                download={downloadName()}
                className="inline-flex h-8 items-center gap-2 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover"
              >
                <DownloadIcon className="size-4" />
                Download
              </a>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExportSummary({ totalBytes }: { totalBytes: number }) {
  const project = useTimelineStore((s) => s.currentProject);
  if (!project) return null;
  const clipCount = project.tracks.reduce(
    (acc, t) => acc + t.clips.length,
    0,
  );
  return (
    <div className="grid grid-cols-4 gap-3 rounded-md border border-border bg-panel px-3 py-3 text-[12px]">
      <SummaryItem
        label="Resolution"
        value={`${project.resolution.width}×${project.resolution.height}`}
      />
      <SummaryItem label="Frame rate" value="30 fps" />
      <SummaryItem label="Clips" value={String(clipCount)} />
      <SummaryItem label="Source" value={formatBytes(totalBytes)} />
    </div>
  );
}

function MemoryNotice({
  risk,
  bytes,
}: {
  risk: MemoryRisk;
  bytes: number;
}) {
  const isBlock = risk === 'block';
  return (
    <div
      className={clsx(
        'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-[12px]',
        isBlock
          ? 'border-danger/40 bg-danger/10 text-danger'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-300',
      )}
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
      <div className="leading-relaxed">
        {isBlock ? (
          <>
            Source media totals <strong>{formatBytes(bytes)}</strong>, which
            exceeds the safe ceiling for the single-threaded WebAssembly
            export (~1.8 GB). Shorten the timeline, trim clips, or re-encode
            sources to smaller files before exporting.
          </>
        ) : (
          <>
            Source media totals <strong>{formatBytes(bytes)}</strong>. Large
            projects approach the WebAssembly 32-bit memory ceiling and may
            crash the export tab. Watch for the browser tab freezing and
            consider trimming first.
          </>
        )}
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[10px] uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <span className="font-mono text-[13px] text-text-primary">{value}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
