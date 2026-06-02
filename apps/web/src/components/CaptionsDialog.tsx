import {
  CaptionsIcon,
  CheckCircle2Icon,
  KeyRoundIcon,
  Loader2Icon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  generateCaptionOverlays,
  type CaptionProgress,
} from '../lib/captions';
import { estimateExtractedAudioBytes } from '../lib/filterGraph';
import { formatTime } from '../lib/formatTime';
import { computeProjectDuration } from '../lib/projectMetrics';
import { useFFmpegContext } from '../providers/AppProviders';
import {
  hasApiKey,
  transcribeWithActiveProvider,
  transcriptionProviderList,
  useSettingsStore,
} from '../store/useSettingsStore';
import { useTimelineStore } from '../store/useTimelineStore';
import { Button } from './ui/Button';
import { Dialog, DialogContent } from './ui/Dialog';

type Phase = 'idle' | 'running' | 'done' | 'error';

/**
 * Auto-captions flow:
 *   1. Extract a compressed mono audio file of the timeline's audible
 *      audio (FFmpeg, 100% local), chunked by time for long projects.
 *   2. Send each chunk to the user-selected STT provider (direct
 *      browser fetch, BYOK).
 *   3. Parse + offset + merge the returned `.srt` into text overlays.
 *
 * All work is client-side; the only network calls are the user's own
 * API requests to their chosen provider.
 */
export function CaptionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    isLoaded,
    isLoading,
    extractAudio,
    sliceAudio,
    progress: ffmpegProgress,
  } = useFFmpegContext();

  // Subscribe to the slices that affect key availability so the
  // warning + button state stay reactive to edits made in Settings.
  const selectedProviderId = useSettingsStore((s) => s.selectedProviderId);
  useSettingsStore((s) => s.apiKeys);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState(0);
  const [progress, setProgress] = useState<CaptionProgress | null>(null);

  const provider = transcriptionProviderList.find(
    (p) => p.id === selectedProviderId,
  );
  const keyAvailable = hasApiKey(selectedProviderId);

  // Pre-flight stats. Recomputed from the live project each render.
  const project = useTimelineStore((s) => s.currentProject);
  const duration = project ? computeProjectDuration(project) : 0;
  const format = provider?.preferredAudioFormat ?? 'wav';
  const maxUploadBytes = provider?.maxUploadBytes;
  const estBytes = estimateExtractedAudioBytes(duration, format);
  // How many uploads we expect (estimate; actual depends on encoded size).
  const estParts =
    maxUploadBytes && estBytes > maxUploadBytes
      ? Math.max(2, Math.ceil(estBytes / maxUploadBytes))
      : 1;

  useEffect(() => {
    if (open) return;
    setPhase('idle');
    setError(null);
    setResultCount(0);
    setProgress(null);
  }, [open]);

  const run = async () => {
    setError(null);
    setResultCount(0);
    setProgress(null);
    setPhase('running');
    try {
      const current = useTimelineStore.getState().currentProject;
      if (!current) throw new Error('No project loaded.');

      const overlays = await generateCaptionOverlays({
        project: current,
        durationSeconds: computeProjectDuration(current),
        format,
        maxUploadBytes,
        extractFull: (fmt) => extractAudio(current, { format: fmt }),
        sliceAudio,
        transcribe: transcribeWithActiveProvider,
        onProgress: setProgress,
      });

      if (overlays.length === 0) {
        throw new Error(
          'No speech was detected in the timeline audio. Nothing to caption.',
        );
      }
      useTimelineStore.getState().addOverlays(overlays);
      setResultCount(overlays.length);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  // The one-time decode is the heavy step, so it owns the first half
  // of the bar (driven by ffmpeg progress); transcription pieces fill
  // the second half. Network transcription can't self-report, so each
  // piece parks at its midpoint until it resolves.
  const percent = (() => {
    if (!progress) return 0;
    if (progress.phase === 'extracting') {
      return Math.min(49, Math.round((ffmpegProgress / 100) * 50));
    }
    const perPiece = 50 / progress.totalPieces;
    return Math.min(
      99,
      Math.round(50 + progress.pieceIndex * perPiece + perPiece * 0.5),
    );
  })();

  const phaseLabel = (() => {
    if (!progress) return 'Preparing…';
    if (progress.phase === 'extracting') {
      return 'Extracting & compressing audio locally…';
    }
    const which =
      progress.totalPieces > 1
        ? ` (part ${progress.pieceIndex + 1}/${progress.totalPieces})`
        : '';
    return `Transcribing with ${provider?.name ?? 'provider'}${which}…`;
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Auto captions"
        description="Transcribe the timeline audio into text overlays."
      >
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-3 rounded-md border border-border bg-panel px-3 py-3 text-[12px]">
            <SummaryItem label="Provider" value={provider?.name ?? 'None'} />
            <SummaryItem label="Duration" value={formatTime(duration)} />
            <SummaryItem
              label="Audio upload"
              value={`~${formatBytes(estBytes)}${
                estParts > 1 ? ` · ${estParts} parts` : ''
              }`}
            />
          </div>

          {!keyAvailable && phase === 'idle' ? (
            <div className="flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-300">
              <KeyRoundIcon className="mt-0.5 size-4 shrink-0" />
              <div className="leading-relaxed">
                No API key found for{' '}
                <strong>{provider?.name ?? 'this provider'}</strong>. Open{' '}
                <strong>Settings</strong> (the gear icon, top-right) and paste
                your key to enable captioning.
              </div>
            </div>
          ) : null}

          {phase === 'idle' && !error ? (
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                icon={<CaptionsIcon />}
                onClick={run}
                disabled={!keyAvailable || !isLoaded || isLoading || duration <= 0}
              >
                {isLoaded
                  ? 'Generate captions'
                  : isLoading
                    ? 'Loading FFmpeg…'
                    : 'FFmpeg not ready'}
              </Button>
            </div>
          ) : null}

          {phase === 'running' ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[12px] text-text-secondary">
                <span className="flex items-center gap-2">
                  <Loader2Icon className="size-4 animate-spin" />
                  {phaseLabel}
                </span>
                <span className="font-mono tabular-nums text-text-primary">
                  {percent}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-chrome">
                <div
                  className="h-full bg-accent transition-[width] duration-200 ease-out"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="text-[11px] text-text-muted">
                Audio is extracted and compressed on your machine, then sent
                only to your chosen provider.
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
                <Button
                  variant="primary"
                  size="sm"
                  onClick={run}
                  disabled={!keyAvailable}
                >
                  Try again
                </Button>
              </div>
            </div>
          ) : null}

          {phase === 'done' ? (
            <div className="flex items-center justify-between rounded-md border border-border bg-panel px-3 py-3">
              <div className="flex items-center gap-2.5">
                <CheckCircle2Icon className="size-5 text-emerald-500" />
                <div className="flex flex-col leading-tight">
                  <span className="text-[13px] text-text-primary">
                    Added {resultCount} caption{resultCount === 1 ? '' : 's'}
                  </span>
                  <span className="text-[11px] text-text-muted">
                    Edit any caption in the properties panel.
                  </span>
                </div>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Done
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[10px] uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <span className="truncate text-[13px] text-text-primary">{value}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
