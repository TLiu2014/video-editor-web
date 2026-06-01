import { AlertTriangleIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTimelineStore } from '../store/useTimelineStore';
import { Button } from './ui/Button';
import { Dialog, DialogContent } from './ui/Dialog';

const RESOLUTION_PRESETS: { label: string; width: number; height: number }[] = [
  { label: '4K (3840×2160)', width: 3840, height: 2160 },
  { label: '1440p (2560×1440)', width: 2560, height: 1440 },
  { label: '1080p (1920×1080)', width: 1920, height: 1080 },
  { label: '720p (1280×720)', width: 1280, height: 720 },
  { label: '480p (854×480)', width: 854, height: 480 },
];

const FRAME_RATE_PRESETS = [24, 25, 30, 60] as const;
const SAMPLE_RATE_PRESETS = [44100, 48000] as const;
const HIGH_RES_THRESHOLD_PX = 1920 * 1080;

/**
 * Per-project output configuration. Resolution caps at 1080p, fps
 * caps at 30 — both bounds enforced in the store action so anything
 * the dialog can produce stays within the wasm encoder's safe
 * envelope.
 */
export function ProjectSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const project = useTimelineStore((s) => s.currentProject);
  const updateProjectSettings = useTimelineStore(
    (s) => s.updateProjectSettings,
  );

  const [width, setWidth] = useState(project?.resolution.width ?? 1920);
  const [height, setHeight] = useState(project?.resolution.height ?? 1080);
  const [fps, setFps] = useState(project?.frameRate ?? 30);
  const [sampleRate, setSampleRate] = useState(
    project?.audioSampleRate ?? 48000,
  );

  // Re-seed the local form state whenever the dialog opens, so it
  // always reflects the current project (and discards prior edits
  // if the user cancelled the previous time).
  useEffect(() => {
    if (!open || !project) return;
    setWidth(project.resolution.width);
    setHeight(project.resolution.height);
    setFps(project.frameRate);
    setSampleRate(project.audioSampleRate);
  }, [open, project]);

  if (!project) return null;

  const applyPreset = (preset: (typeof RESOLUTION_PRESETS)[number]) => {
    setWidth(preset.width);
    setHeight(preset.height);
  };

  const resolutionChanged =
    width !== project.resolution.width ||
    height !== project.resolution.height;
  // Within 1% of identical aspect counts as the same — avoids
  // spurious warnings when the only change is from 1920×1080 to
  // 1280×720 (both 16:9).
  const aspectChanged =
    resolutionChanged &&
    Math.abs(
      width / height - project.resolution.width / project.resolution.height,
    ) > 0.01;
  const isHighRes = width * height > HIGH_RES_THRESHOLD_PX;

  const handleApply = () => {
    updateProjectSettings({
      resolution: { width, height },
      frameRate: fps,
      audioSampleRate: sampleRate,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Project settings"
        description="Output format used by the export pipeline."
      >
        <div className="flex flex-col gap-5">
          <Section label="Resolution">
            <div className="flex flex-wrap gap-1">
              {RESOLUTION_PRESETS.map((preset) => {
                const isActive =
                  preset.width === width && preset.height === height;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={`h-7 rounded-md border px-2.5 text-[12px] transition ${
                      isActive
                        ? 'border-accent bg-accent/10 text-text-primary'
                        : 'border-border bg-chrome text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 pt-1 text-[12px]">
              <span className="text-text-muted">Custom</span>
              <NumberField
                value={width}
                onChange={setWidth}
                min={16}
                max={3840}
                aria-label="Width"
              />
              <span className="text-text-muted">×</span>
              <NumberField
                value={height}
                onChange={setHeight}
                min={16}
                max={2160}
                aria-label="Height"
              />
            </div>
          </Section>

          <Section label="Frame rate">
            <PresetRow
              presets={FRAME_RATE_PRESETS}
              value={fps}
              onChange={setFps}
              suffix=" fps"
            />
          </Section>

          <Section label="Audio sample rate">
            <PresetRow
              presets={SAMPLE_RATE_PRESETS}
              value={sampleRate}
              onChange={setSampleRate}
              suffix=" Hz"
            />
          </Section>

          {resolutionChanged ? (
            <div className="flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-300">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              <div className="leading-relaxed">
                Resolution will change from{' '}
                <strong>
                  {project.resolution.width}×{project.resolution.height}
                </strong>{' '}
                to{' '}
                <strong>
                  {width}×{height}
                </strong>
                .{' '}
                {aspectChanged
                  ? "Aspect ratio changes — source video will be letterboxed differently on the next export, and overlay positions (stored as 0–1 fractions) will scale into the new frame."
                  : "Same aspect ratio; export will scale cleanly without letterboxing."}
              </div>
            </div>
          ) : null}

          {isHighRes ? (
            <div className="flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-300">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              <div className="leading-relaxed">
                Above 1080p the export runs against the WebAssembly 32-bit
                memory ceiling much faster. Prefer the multi-threaded core
                (cross-origin isolated page) and keep total source bytes
                modest.
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleApply}>
              Apply
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] uppercase tracking-wide text-text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

function PresetRow<T extends number>({
  presets,
  value,
  onChange,
  suffix,
}: {
  presets: readonly T[];
  value: number;
  onChange: (value: T) => void;
  suffix?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {presets.map((p) => {
        const isActive = p === value;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`h-7 rounded-md border px-2.5 text-[12px] transition ${
              isActive
                ? 'border-accent bg-accent/10 text-text-primary'
                : 'border-border bg-chrome text-text-secondary hover:text-text-primary'
            }`}
          >
            {p}
            {suffix ?? ''}
          </button>
        );
      })}
    </div>
  );
}

function NumberField({
  value,
  onChange,
  min,
  max,
  ...rest
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  'aria-label': string;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) {
          onChange(Math.max(min, Math.min(max, n)));
        }
      }}
      min={min}
      max={max}
      className="h-7 w-20 rounded border border-border bg-chrome px-2 text-right font-mono text-[12px] text-text-primary outline-none focus:ring-2 focus:ring-accent"
      {...rest}
    />
  );
}
