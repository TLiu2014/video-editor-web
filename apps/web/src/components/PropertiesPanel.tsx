import {
  LayersIcon,
  Music2Icon,
  RotateCcwIcon,
  Trash2Icon,
  TypeIcon,
  VideoIcon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react';
import { formatTime } from '../lib/formatTime';
import { useTimelineStore } from '../store/useTimelineStore';
import type {
  AnyClip,
  AudioClip,
  ClipId,
  TextOverlay,
  VideoClip,
} from '../types/timeline';
import { Button } from './ui/Button';
import { Slider } from './ui/Slider';
import { Switch } from './ui/Switch';

/**
 * Right rail. Switches between two variants based on what's
 * selected — clip vs. overlay. Hidden entirely when nothing's
 * selected so the preview reclaims the full width.
 */
export function PropertiesPanel() {
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const selectedClip = useTimelineStore((s) => {
    const id = s.selectedClipId;
    if (!id || !s.currentProject) return null;
    for (const track of s.currentProject.tracks) {
      for (const clip of track.clips) {
        if (clip.id === id) return clip;
      }
    }
    return null;
  });
  const selectedOverlay = useTimelineStore((s) => {
    const id = s.selectedOverlayId;
    if (!id || !s.currentProject) return null;
    return s.currentProject.overlays.find((o) => o.id === id) ?? null;
  });

  if (selectedClipIds.length > 1) {
    return <MultiClipProperties clipIds={selectedClipIds} />;
  }
  if (selectedClip) return <ClipProperties clip={selectedClip} />;
  if (selectedOverlay) return <OverlayProperties overlay={selectedOverlay} />;
  return null;
}

function PanelShell({
  title,
  children,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const selectClip = useTimelineStore((s) => s.selectClip);
  const selectOverlay = useTimelineStore((s) => s.selectOverlay);

  return (
    <aside className="no-select flex w-80 shrink-0 flex-col border-l border-border bg-panel">
      <header className="flex h-10 items-center justify-between border-b border-border px-4 text-[11px] uppercase tracking-wide text-text-muted">
        <span>{title}</span>
        <button
          onClick={() => {
            selectClip(null);
            selectOverlay(null);
          }}
          className="rounded px-1 py-0.5 text-text-muted transition hover:bg-chrome hover:text-text-primary"
          title="Deselect"
        >
          esc
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
      <footer className="border-t border-border px-4 py-3">{footer}</footer>
    </aside>
  );
}

function MultiClipProperties({ clipIds }: { clipIds: ClipId[] }) {
  const clips = useTimelineStore((s) => {
    if (!s.currentProject) return [];
    const set = new Set(clipIds);
    const out: AnyClip[] = [];
    for (const t of s.currentProject.tracks) {
      for (const c of t.clips) if (set.has(c.id)) out.push(c);
    }
    return out;
  });
  const setClipFadeIn = useTimelineStore((s) => s.setClipFadeIn);
  const setClipFadeOut = useTimelineStore((s) => s.setClipFadeOut);
  const setClipVolume = useTimelineStore((s) => s.setClipVolume);
  const setClipPlaybackRate = useTimelineStore((s) => s.setClipPlaybackRate);
  const setClipColor = useTimelineStore((s) => s.setClipColor);
  const setClipEffects = useTimelineStore((s) => s.setClipEffects);
  const removeClip = useTimelineStore((s) => s.removeClip);

  if (clips.length === 0) return null;

  const primary = clips[0];
  if (!primary) return null;
  const allAudio = clips.every((c) => c.kind === 'audio');
  const allVideo = clips.every((c) => c.kind === 'video');

  // Show the primary clip's value as the starting point for each
  // slider; on change we apply the new value to ALL selected clips.
  // History coalescing collapses the burst of writes into a single
  // undo entry (per ~500ms window).
  const apply = (fn: (id: ClipId) => void) => {
    for (const c of clips) fn(c.id);
  };

  return (
    <PanelShell
      title={`${clips.length} clips selected`}
      footer={
        <Button
          variant="danger"
          size="sm"
          icon={<Trash2Icon />}
          onClick={() => apply((id) => removeClip(id))}
          className="w-full justify-center"
          title="Delete all selected clips"
        >
          Delete {clips.length} clips
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-md bg-accent/20 text-accent">
            <LayersIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-medium text-text-primary">
              Batch edit ({clips.length})
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
              {allAudio
                ? 'audio'
                : allVideo
                  ? 'video'
                  : 'mixed video + audio'}
            </div>
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-text-secondary">
          Changes apply to every selected clip. The slider values
          start from the first clip's settings; mismatched values
          are overwritten on first drag.
        </p>

        <SliderRow
          label="Fade in"
          value={primary.fadeIn}
          min={0}
          max={Math.max(0.01, primary.duration - primary.fadeOut)}
          step={0.05}
          format={(v) => `${v.toFixed(2)}s`}
          onChange={(v) => apply((id) => setClipFadeIn(id, v))}
        />
        <SliderRow
          label="Fade out"
          value={primary.fadeOut}
          min={0}
          max={Math.max(0.01, primary.duration - primary.fadeIn)}
          step={0.05}
          format={(v) => `${v.toFixed(2)}s`}
          onChange={(v) => apply((id) => setClipFadeOut(id, v))}
        />
        <SliderRow
          label="Speed"
          value={primary.playbackRate ?? 1}
          min={0.25}
          max={4}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => apply((id) => setClipPlaybackRate(id, v))}
        />

        {allAudio ? (
          <SliderRow
            label="Volume"
            value={(primary as AudioClip).volume}
            min={0}
            max={1.5}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => apply((id) => setClipVolume(id, v))}
          />
        ) : null}

        <div className="flex flex-col gap-3">
          <span className="text-[11px] uppercase tracking-wide text-text-muted">
            Batch actions
          </span>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => apply((id) => setClipColor(id, null))}
              className="rounded border border-border bg-chrome px-2.5 py-1 text-text-secondary transition hover:text-text-primary"
            >
              Reset colors
            </button>
            {allVideo ? (
              <button
                type="button"
                onClick={() => apply((id) => setClipEffects(id, null))}
                className="rounded border border-border bg-chrome px-2.5 py-1 text-text-secondary transition hover:text-text-primary"
              >
                Reset effects
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </PanelShell>
  );
}

function ClipProperties({ clip }: { clip: AnyClip }) {
  const removeClip = useTimelineStore((s) => s.removeClip);
  const rippleDeleteClip = useTimelineStore((s) => s.rippleDeleteClip);

  return (
    <PanelShell
      title="Clip Properties"
      footer={
        <div className="flex flex-col gap-2">
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2Icon />}
            onClick={() => removeClip(clip.id)}
            className="w-full justify-center"
            title="Delete clip (Delete)"
          >
            Delete clip
          </Button>
          <button
            type="button"
            onClick={() => rippleDeleteClip(clip.id)}
            className="rounded border border-border bg-chrome px-2.5 py-1 text-[11px] text-text-secondary transition hover:text-text-primary"
            title="Delete clip and pull following clips left to close the gap (Shift+Delete)"
          >
            Ripple delete (close gap)
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <ClipIdentity clip={clip} />
        <ReadonlyMetrics clip={clip} />
        {clip.kind === 'audio' ? (
          <VolumeControl clip={clip} />
        ) : (
          <>
            <HasAudioControl clip={clip} />
            <EffectsControl clip={clip} />
            <PiPTransformControl clip={clip} />
          </>
        )}
        <FadeControls clip={clip} />
        <SpeedControl clip={clip} />
        <ColorControl clip={clip} />
      </div>
    </PanelShell>
  );
}

function ClipIdentity({ clip }: { clip: AnyClip }) {
  const isVideo = clip.kind === 'video';
  return (
    <div className="flex items-start gap-2.5">
      <div
        className={
          isVideo
            ? 'flex size-9 items-center justify-center rounded-md bg-clip-video/20 text-clip-video-strong'
            : 'flex size-9 items-center justify-center rounded-md bg-clip-audio/20 text-clip-audio-strong'
        }
      >
        {isVideo ? (
          <VideoIcon className="size-4" />
        ) : (
          <Music2Icon className="size-4" />
        )}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div
          className="truncate text-[13px] font-medium text-text-primary"
          title={clip.name}
        >
          {clip.name}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
          {clip.kind} clip
        </div>
      </div>
    </div>
  );
}

function ReadonlyMetrics({ clip }: { clip: AnyClip }) {
  return (
    <dl className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-[12px]">
      <MetricRow label="Timeline" value={formatTime(clip.startOffset)} />
      <MetricRow label="Duration" value={formatTime(clip.duration)} />
      <MetricRow label="In" value={formatTime(clip.trimStart)} />
      <MetricRow label="Out" value={formatTime(clip.trimEnd)} />
      <MetricRow
        label="Source"
        value={formatTime(clip.sourceDuration)}
        className="col-span-2"
      />
    </dl>
  );
}

function MetricRow({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[10px] uppercase tracking-wide text-text-muted">
        {label}
      </dt>
      <dd className="font-mono tabular-nums text-text-primary">{value}</dd>
    </div>
  );
}

function VolumeControl({ clip }: { clip: AudioClip }) {
  const setClipVolume = useTimelineStore((s) => s.setClipVolume);
  const muted = clip.volume === 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label
          htmlFor={`vol-${clip.id}`}
          className="text-[11px] uppercase tracking-wide text-text-muted"
        >
          Volume
        </label>
        <span className="font-mono text-[11px] tabular-nums text-text-secondary">
          {Math.round(clip.volume * 100)}%
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setClipVolume(clip.id, muted ? 1 : 0)}
          className="text-text-secondary transition hover:text-text-primary"
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? (
            <VolumeXIcon className="size-4" />
          ) : (
            <Volume2Icon className="size-4" />
          )}
        </button>
        <Slider
          aria-label="Clip volume"
          value={clip.volume}
          min={0}
          max={1.5}
          step={0.01}
          onValueChange={(v) => setClipVolume(clip.id, v)}
          className="flex-1"
        />
      </div>
      <p className="text-[10px] leading-snug text-text-muted">
        Above 100% boosts the clip; values past ~150% may clip on export.
      </p>
    </div>
  );
}

function SpeedControl({ clip }: { clip: AnyClip }) {
  const setClipPlaybackRate = useTimelineStore((s) => s.setClipPlaybackRate);
  const rate = clip.playbackRate ?? 1;
  const isCustom = rate !== 1;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-[11px] uppercase tracking-wide text-text-muted">
          Speed
        </label>
        {isCustom ? (
          <button
            type="button"
            onClick={() => setClipPlaybackRate(clip.id, 1)}
            className="flex items-center gap-1 text-[11px] text-text-muted transition hover:text-text-primary"
            title="Reset to 1× (normal speed)"
          >
            <RotateCcwIcon className="size-3" />
            Reset
          </button>
        ) : null}
      </div>
      <SliderRow
        label={`Rate · ${rate.toFixed(2)}×`}
        value={rate}
        min={0.25}
        max={4}
        step={0.05}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(v) => setClipPlaybackRate(clip.id, v)}
      />
      <p className="text-[10px] leading-snug text-text-muted">
        Adjusts both preview playback and the rendered export.
        Audio rates outside 0.5–2× chain `atempo` stages to
        preserve pitch.
      </p>
    </div>
  );
}

function FadeControls({ clip }: { clip: AnyClip }) {
  const setClipFadeIn = useTimelineStore((s) => s.setClipFadeIn);
  const setClipFadeOut = useTimelineStore((s) => s.setClipFadeOut);
  // Each fade is bounded by the remaining duration the other isn't
  // already occupying — keeps fadeIn + fadeOut <= duration.
  const maxFadeIn = Math.max(0, clip.duration - clip.fadeOut);
  const maxFadeOut = Math.max(0, clip.duration - clip.fadeIn);
  return (
    <div className="flex flex-col gap-4">
      <SliderRow
        label="Fade in"
        value={clip.fadeIn}
        min={0}
        max={Math.max(0.01, maxFadeIn)}
        step={0.05}
        format={(v) => `${v.toFixed(2)}s`}
        onChange={(v) => setClipFadeIn(clip.id, v)}
      />
      <SliderRow
        label="Fade out"
        value={clip.fadeOut}
        min={0}
        max={Math.max(0.01, maxFadeOut)}
        step={0.05}
        format={(v) => `${v.toFixed(2)}s`}
        onChange={(v) => setClipFadeOut(clip.id, v)}
      />
    </div>
  );
}

function ColorControl({ clip }: { clip: AnyClip }) {
  const setClipColor = useTimelineStore((s) => s.setClipColor);
  const isVideo = clip.kind === 'video';
  // Fallback swatch reflects the theme default for this kind so the
  // color input shows *something* sensible before the user picks.
  const defaultColor = isVideo ? '#4f46e5' : '#059669';
  const current = clip.color ?? defaultColor;
  const overridden = !!clip.color;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[11px] uppercase tracking-wide text-text-muted">
          Color
        </label>
        {overridden ? (
          <button
            type="button"
            onClick={() => setClipColor(clip.id, null)}
            className="flex items-center gap-1 text-[11px] text-text-muted transition hover:text-text-primary"
            title="Reset to default"
          >
            <RotateCcwIcon className="size-3" />
            Reset
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={current}
          onChange={(e) => setClipColor(clip.id, e.target.value)}
          className="h-7 w-12 cursor-pointer rounded border border-border bg-chrome"
          aria-label="Clip color"
        />
        <span className="font-mono text-[11px] text-text-secondary">
          {overridden ? clip.color : `${defaultColor} (default)`}
        </span>
      </div>
    </div>
  );
}

function PiPTransformControl({ clip }: { clip: VideoClip }) {
  const setClipTransform = useTimelineStore((s) => s.setClipTransform);
  const isOverlayTrack = useTimelineStore((s) => {
    const project = s.currentProject;
    if (!project) return false;
    const videoTracks = project.tracks.filter((t) => t.type === 'video');
    const baseTrack = videoTracks[0];
    if (!baseTrack) return false;
    // The clip is "overlay" iff it lives on a video track that
    // ISN'T the first one in declared order.
    return clip.trackId !== baseTrack.id;
  });
  // V1 (base) clips always fill the frame — PiP only makes sense
  // for the overlay tracks layered on top.
  if (!isOverlayTrack) return null;

  const transform = clip.transform ?? { x: 0.05, y: 0.05, scale: 0.25 };
  const enabled = clip.transform !== undefined;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <label className="text-[11px] uppercase tracking-wide text-text-muted">
          Picture-in-picture
        </label>
        {enabled ? (
          <button
            type="button"
            onClick={() => setClipTransform(clip.id, null)}
            className="flex items-center gap-1 text-[11px] text-text-muted transition hover:text-text-primary"
            title="Reset to full frame"
          >
            <RotateCcwIcon className="size-3" />
            Reset
          </button>
        ) : (
          <button
            type="button"
            onClick={() =>
              setClipTransform(clip.id, { x: 0.05, y: 0.05, scale: 0.25 })
            }
            className="text-[11px] text-text-muted transition hover:text-text-primary"
          >
            Enable PiP
          </button>
        )}
      </div>
      {enabled ? (
        <>
          <SliderRow
            label="Position X"
            value={transform.x}
            min={0}
            max={1}
            step={0.005}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setClipTransform(clip.id, { x: v })}
          />
          <SliderRow
            label="Position Y"
            value={transform.y}
            min={0}
            max={1}
            step={0.005}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setClipTransform(clip.id, { y: v })}
          />
          <SliderRow
            label="Scale"
            value={transform.scale}
            min={0.05}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setClipTransform(clip.id, { scale: v })}
          />
          <SliderRow
            label="Rotation"
            value={transform.rotation ?? 0}
            min={-180}
            max={180}
            step={1}
            format={(v) => `${Math.round(v)}°`}
            onChange={(v) => setClipTransform(clip.id, { rotation: v })}
          />
          <SliderRow
            label="Opacity"
            value={transform.opacity ?? 1}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setClipTransform(clip.id, { opacity: v })}
          />
          <p className="text-[10px] leading-snug text-text-muted">
            Source aspect is preserved. Position is the top-left
            corner; scale is the width as a fraction of the project
            frame. Rotation pivots around the layer's center;
            opacity multiplies with the fade envelope.
          </p>
        </>
      ) : (
        <p className="text-[10px] leading-snug text-text-muted">
          Full-frame letterbox. Enable PiP to scale and position
          this clip over the base track.
        </p>
      )}
    </div>
  );
}

function EffectsControl({ clip }: { clip: VideoClip }) {
  const setClipEffects = useTimelineStore((s) => s.setClipEffects);
  const effects = clip.effects ?? {};
  const hasEffects = Object.keys(effects).length > 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <label className="text-[11px] uppercase tracking-wide text-text-muted">
          Effects
        </label>
        {hasEffects ? (
          <button
            type="button"
            onClick={() => setClipEffects(clip.id, null)}
            className="flex items-center gap-1 text-[11px] text-text-muted transition hover:text-text-primary"
            title="Reset effects"
          >
            <RotateCcwIcon className="size-3" />
            Reset
          </button>
        ) : null}
      </div>
      <SliderRow
        label="Brightness"
        value={effects.brightness ?? 1}
        min={0.5}
        max={1.5}
        step={0.01}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(v) => setClipEffects(clip.id, { brightness: v })}
      />
      <SliderRow
        label="Contrast"
        value={effects.contrast ?? 1}
        min={0.5}
        max={1.5}
        step={0.01}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(v) => setClipEffects(clip.id, { contrast: v })}
      />
      <SliderRow
        label="Saturation"
        value={effects.saturation ?? 1}
        min={0}
        max={2}
        step={0.01}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(v) => setClipEffects(clip.id, { saturation: v })}
      />
      <SliderRow
        label="Blur"
        value={effects.blur ?? 0}
        min={0}
        max={20}
        step={0.5}
        format={(v) => `${v.toFixed(1)}px`}
        onChange={(v) => setClipEffects(clip.id, { blur: v })}
      />
    </div>
  );
}

function HasAudioControl({ clip }: { clip: VideoClip }) {
  const setVideoClipHasAudio = useTimelineStore(
    (s) => s.setVideoClipHasAudio,
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <label
            htmlFor={`hasaudio-${clip.id}`}
            className="text-[11px] uppercase tracking-wide text-text-muted"
          >
            Has audio
          </label>
          <span className="text-[11px] text-text-secondary">
            {clip.hasAudio ? 'Mixed into export' : 'Treated as silent'}
          </span>
        </div>
        <Switch
          id={`hasaudio-${clip.id}`}
          checked={clip.hasAudio}
          onCheckedChange={(v) => setVideoClipHasAudio(clip.id, v)}
        />
      </div>
      <p className="text-[10px] leading-snug text-text-muted">
        Disable when a clip has no audio stream (silent screen
        recording, etc.) so export doesn't fail trying to decode one.
      </p>
    </div>
  );
}

function OverlayProperties({ overlay }: { overlay: TextOverlay }) {
  const updateOverlay = useTimelineStore((s) => s.updateOverlay);
  const removeOverlay = useTimelineStore((s) => s.removeOverlay);

  return (
    <PanelShell
      title="Text Overlay"
      footer={
        <Button
          variant="danger"
          size="sm"
          icon={<Trash2Icon />}
          onClick={() => removeOverlay(overlay.id)}
          className="w-full justify-center"
          title="Delete overlay (Delete)"
        >
          Delete overlay
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-md bg-accent/20 text-accent">
            <TypeIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-medium text-text-primary">
              {overlay.text || 'Untitled overlay'}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
              text overlay
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`ov-text-${overlay.id}`}
            className="text-[11px] uppercase tracking-wide text-text-muted"
          >
            Text
          </label>
          <textarea
            id={`ov-text-${overlay.id}`}
            value={overlay.text}
            onChange={(e) =>
              updateOverlay(overlay.id, { text: e.target.value })
            }
            rows={2}
            className="resize-none rounded-md border border-border bg-chrome px-2.5 py-1.5 text-[12px] text-text-primary outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <SliderRow
          label="Position X"
          value={overlay.style.position.x}
          min={0}
          max={1}
          step={0.005}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) =>
            updateOverlay(overlay.id, {
              style: {
                ...overlay.style,
                position: { ...overlay.style.position, x: v },
              },
            })
          }
        />
        <SliderRow
          label="Position Y"
          value={overlay.style.position.y}
          min={0}
          max={1}
          step={0.005}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) =>
            updateOverlay(overlay.id, {
              style: {
                ...overlay.style,
                position: { ...overlay.style.position, y: v },
              },
            })
          }
        />
        <SliderRow
          label="Size"
          value={overlay.style.size}
          min={12}
          max={240}
          step={1}
          format={(v) => `${Math.round(v)}px`}
          onChange={(v) =>
            updateOverlay(overlay.id, {
              style: { ...overlay.style, size: v },
            })
          }
        />

        <div className="flex items-center justify-between">
          <label
            htmlFor={`ov-color-${overlay.id}`}
            className="text-[11px] uppercase tracking-wide text-text-muted"
          >
            Color
          </label>
          <input
            id={`ov-color-${overlay.id}`}
            type="color"
            value={overlay.style.color}
            onChange={(e) =>
              updateOverlay(overlay.id, {
                style: { ...overlay.style, color: e.target.value },
              })
            }
            className="h-7 w-12 cursor-pointer rounded border border-border bg-chrome"
          />
        </div>

        <SliderRow
          label="Duration"
          value={overlay.duration}
          min={0.5}
          max={30}
          step={0.1}
          format={(v) => formatTime(v, false)}
          onChange={(v) => updateOverlay(overlay.id, { duration: v })}
        />
      </div>
    </PanelShell>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[11px] uppercase tracking-wide text-text-muted">
          {label}
        </label>
        <span className="font-mono text-[11px] tabular-nums text-text-secondary">
          {format(value)}
        </span>
      </div>
      <Slider
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onValueChange={onChange}
      />
    </div>
  );
}
