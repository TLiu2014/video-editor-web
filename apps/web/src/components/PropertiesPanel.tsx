import {
  LayersIcon,
  Music2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DiamondMinusIcon,
  DiamondPlusIcon,
  RotateCcwIcon,
  ShapesIcon,
  Trash2Icon,
  TypeIcon,
  VideoIcon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { formatTime } from '../lib/formatTime';
import {
  KEYFRAME_EPSILON,
  keyframeAt,
  keyframesOf,
  MAX_ZOOM,
  MIN_ZOOM,
  removeKeyframe,
  sampleZoom,
  sourceTimeAt,
  timelineTimeOf,
  upsertKeyframe,
  visibleKeyframes,
  type ZoomView,
} from '../lib/zoomPan';
import {
  effectiveOverlayFades,
  isTextOverlay,
  SHAPE_LABELS,
} from '../lib/shapes';
import {
  baseTrackClips,
  DEFAULT_TRANSITION_DURATION,
  maxTransitionDuration,
  MIN_TRANSITION_DURATION,
  previousTouching,
  TRANSITIONS,
} from '../lib/transitions';
import { useLayoutStore } from '../store/useLayoutStore';
import { useTimelineStore } from '../store/useTimelineStore';
import type {
  AnyClip,
  AnyOverlay,
  AudioClip,
  ClipId,
  ShapeOverlay,
  ShapeStyle,
  TextOverlay,
  VideoClip,
  ZoomKeyframe,
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
  if (selectedOverlay) {
    return isTextOverlay(selectedOverlay) ? (
      <OverlayProperties overlay={selectedOverlay} />
    ) : (
      <ShapeProperties shape={selectedOverlay} />
    );
  }
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
  const panelWidth = useLayoutStore((s) => s.propertiesWidth);

  return (
    <aside
      className="no-select flex shrink-0 flex-col border-l border-border bg-panel"
      style={{ width: panelWidth }}
    >
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
  // Select the stable project ref and derive in a memo: a selector
  // that builds a new array each call makes useSyncExternalStore loop
  // forever ("Maximum update depth exceeded").
  const project = useTimelineStore((s) => s.currentProject);
  const clips = useMemo(() => {
    if (!project) return [];
    const set = new Set(clipIds);
    const out: AnyClip[] = [];
    for (const t of project.tracks) {
      for (const c of t.clips) if (set.has(c.id)) out.push(c);
    }
    return out;
  }, [project, clipIds]);
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
            {/* A still has no audio and no source time to speed up. */}
            {clip.still ? null : <HasAudioControl clip={clip} />}
            <EffectsControl clip={clip} />
            <PiPTransformControl clip={clip} />
          </>
        )}
        {clip.kind === 'video' ? <TransitionControl clip={clip} /> : null}
        {clip.kind === 'video' ? <ZoomPanControl clip={clip} /> : null}
        <FadeControls clip={clip} />
        {clip.kind === 'video' && clip.still ? null : (
          <SpeedControl clip={clip} />
        )}
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
          {clip.kind === 'video' && clip.still ? 'image' : clip.kind} clip
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
      {clip.kind === 'video' && clip.still ? null : (
        <>
          <MetricRow label="In" value={formatTime(clip.trimStart)} />
          <MetricRow label="Out" value={formatTime(clip.trimEnd)} />
          <MetricRow
            label="Source"
            value={formatTime(clip.sourceDuration)}
            className="col-span-2"
          />
        </>
      )}
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

/**
 * Transition into this clip from the clip touching its left edge on
 * V1. Hidden for clips that have no such neighbor.
 */
function TransitionControl({ clip }: { clip: VideoClip }) {
  const project = useTimelineStore((s) => s.currentProject);
  const setClipTransitionIn = useTimelineStore((s) => s.setClipTransitionIn);
  const clips = useMemo(
    () => (project ? baseTrackClips(project) : []),
    [project],
  );
  const prev = clips.some((c) => c.id === clip.id)
    ? previousTouching(clips, clip)
    : null;
  if (!prev) return null;
  const t = clip.transitionIn;
  const max = maxTransitionDuration(prev, clip);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <label className="text-[11px] uppercase tracking-wide text-text-muted">
          Transition in
        </label>
        {t ? (
          <button
            type="button"
            onClick={() => setClipTransitionIn(clip.id, null)}
            className="text-[11px] text-text-muted transition hover:text-danger"
          >
            Remove
          </button>
        ) : (
          <button
            type="button"
            onClick={() =>
              setClipTransitionIn(clip.id, {
                kind: 'dissolve',
                duration: DEFAULT_TRANSITION_DURATION,
              })
            }
            className="text-[11px] text-text-muted transition hover:text-text-primary"
            title="Add a transition from the previous clip (⌘D)"
          >
            Add transition
          </button>
        )}
      </div>
      {t ? (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            {TRANSITIONS.map((spec) => (
              <button
                key={spec.kind}
                type="button"
                aria-pressed={t.kind === spec.kind}
                onClick={() =>
                  setClipTransitionIn(clip.id, { ...t, kind: spec.kind })
                }
                className={
                  t.kind === spec.kind
                    ? 'rounded border border-accent bg-accent/15 px-2 py-1 text-left text-[11px] text-text-primary'
                    : 'rounded border border-border px-2 py-1 text-left text-[11px] text-text-secondary transition hover:bg-chrome'
                }
              >
                {spec.label}
              </button>
            ))}
          </div>
          <SliderRow
            label="Duration"
            value={Math.min(t.duration, max)}
            min={MIN_TRANSITION_DURATION}
            max={max}
            step={0.05}
            format={(v) => `${v.toFixed(2)}s`}
            onChange={(v) =>
              setClipTransitionIn(clip.id, { ...t, duration: v })
            }
          />
          <p className="text-[11px] leading-relaxed text-text-muted">
            Centered on the cut with “{prev.name}”. Frames beyond each
            clip’s trim are used when available; otherwise the edge frame
            is held.
          </p>
        </>
      ) : null}
    </div>
  );
}

/**
 * Keyframed zoom & pan for a V1 clip. The sliders show the view at the
 * playhead; changing one edits the keyframe there or adds one (so with
 * a single keyframe the whole clip holds that zoom).
 */
function ZoomPanControl({ clip }: { clip: VideoClip }) {
  const project = useTimelineStore((s) => s.currentProject);
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const setZoomKeyframes = useTimelineStore((s) => s.setZoomKeyframes);
  const onBase = useMemo(
    () => (project ? baseTrackClips(project).some((c) => c.id === clip.id) : false),
    [project, clip.id],
  );
  if (!onBase) return null;

  const inside =
    playhead >= clip.startOffset && playhead < clip.startOffset + clip.duration;
  const t = sourceTimeAt(clip, playhead);
  const view = sampleZoom(clip, t);
  const here = inside ? keyframeAt(clip, t) : null;
  const keys = visibleKeyframes(clip);
  const all = keyframesOf(clip);
  const setView = (patch: Partial<ZoomView>) =>
    setZoomKeyframes(clip.id, upsertKeyframe(all, t, { ...view, ...patch }));
  const jumpTo = (k: ZoomKeyframe | undefined) => {
    if (!k) return;
    useTimelineStore.getState().updatePlayhead(timelineTimeOf(clip, k.t));
  };
  const prev = [...keys].reverse().find((k) => k.t < t - KEYFRAME_EPSILON);
  const next = keys.find((k) => k.t > t + KEYFRAME_EPSILON);
  const iconBtn =
    'flex size-7 items-center justify-center rounded border border-border text-text-secondary transition hover:bg-chrome disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <label className="text-[11px] uppercase tracking-wide text-text-muted">
          Zoom &amp; pan
        </label>
        <span className="font-mono text-[10px] text-text-muted">
          {keys.length === 0
            ? 'off'
            : `${keys.length} keyframe${keys.length === 1 ? '' : 's'}`}
        </span>
      </div>
      {!inside ? (
        <p className="text-[11px] leading-relaxed text-text-muted">
          Move the playhead over this clip to set its zoom.
        </p>
      ) : (
        <>
          <SliderRow
            label="Zoom"
            value={view.zoom}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => setView({ zoom: v })}
          />
          <SliderRow
            label="Center X"
            value={view.cx}
            min={0}
            max={1}
            step={0.005}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setView({ cx: v })}
          />
          <SliderRow
            label="Center Y"
            value={view.cy}
            min={0}
            max={1}
            step={0.005}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setView({ cy: v })}
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={iconBtn}
              disabled={!prev}
              onClick={() => jumpTo(prev)}
              title="Previous keyframe"
              aria-label="Previous keyframe"
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            {here ? (
              <button
                type="button"
                onClick={() => setZoomKeyframes(clip.id, removeKeyframe(all, here.t))}
                className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded border border-border text-[11px] text-text-secondary transition hover:bg-chrome hover:text-danger"
              >
                <DiamondMinusIcon className="size-3.5" />
                Delete keyframe
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setView({})}
                className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded border border-border text-[11px] text-text-secondary transition hover:bg-chrome hover:text-text-primary"
              >
                <DiamondPlusIcon className="size-3.5" />
                Add keyframe
              </button>
            )}
            <button
              type="button"
              className={iconBtn}
              disabled={!next}
              onClick={() => jumpTo(next)}
              title="Next keyframe"
              aria-label="Next keyframe"
            >
              <ChevronRightIcon className="size-4" />
            </button>
          </div>
          {all.length > 0 ? (
            <button
              type="button"
              onClick={() => setZoomKeyframes(clip.id, null)}
              className="self-start text-[11px] text-text-muted transition hover:text-danger"
            >
              Remove zoom &amp; pan
            </button>
          ) : null}
          <p className="text-[11px] leading-relaxed text-text-muted">
            Sliders edit the keyframe at the playhead, or add one there.
            Between keyframes the view eases smoothly.
          </p>
        </>
      )}
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
        <OverlayFadeControls
          overlay={overlay}
          onChange={(patch) => updateOverlay(overlay.id, patch)}
        />
      </div>
    </PanelShell>
  );
}

/** Annotation shape: style, callout text, timing. */
function ShapeProperties({ shape }: { shape: ShapeOverlay }) {
  const updateShape = useTimelineStore((s) => s.updateShape);
  const removeOverlay = useTimelineStore((s) => s.removeOverlay);
  const { style } = shape;
  const setStyle = (patch: Partial<ShapeStyle>) =>
    updateShape(shape.id, { style: { ...style, ...patch } });
  const isArrow = shape.kind === 'arrow';
  const hasCorners = shape.kind === 'rect' || shape.kind === 'callout';

  return (
    <PanelShell
      title="Annotation"
      footer={
        <Button
          variant="danger"
          size="sm"
          icon={<Trash2Icon />}
          onClick={() => removeOverlay(shape.id)}
          className="w-full justify-center"
          title="Delete annotation (Delete)"
        >
          Delete annotation
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-md bg-accent/20 text-accent">
            <ShapesIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-medium text-text-primary">
              {SHAPE_LABELS[shape.kind]}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
              drag in the preview to place
            </div>
          </div>
        </div>

        {shape.kind === 'callout' ? (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`sh-text-${shape.id}`}
              className="text-[11px] uppercase tracking-wide text-text-muted"
            >
              Text
            </label>
            <textarea
              id={`sh-text-${shape.id}`}
              value={shape.text ?? ''}
              onChange={(e) => updateShape(shape.id, { text: e.target.value })}
              rows={3}
              className="w-full resize-y rounded border border-border bg-panel-elevated px-2 py-1.5 text-[13px] text-text-primary outline-none focus:border-accent"
            />
            <ColorRow
              id={`sh-tc-${shape.id}`}
              label="Text color"
              value={style.textColor}
              onChange={(v) => setStyle({ textColor: v })}
            />
            <SliderRow
              label="Text size"
              value={style.textSize}
              min={12}
              max={160}
              step={1}
              format={(v) => `${Math.round(v)}px`}
              onChange={(v) => setStyle({ textSize: v })}
            />
          </div>
        ) : null}

        <ColorRow
          id={`sh-stroke-${shape.id}`}
          label={isArrow ? 'Color' : 'Outline'}
          value={style.stroke}
          onChange={(v) => setStyle({ stroke: v })}
        />
        <SliderRow
          label={isArrow ? 'Thickness' : 'Outline width'}
          value={style.strokeWidth}
          min={isArrow ? 1 : 0}
          max={40}
          step={1}
          format={(v) => (v === 0 ? 'None' : `${Math.round(v)}px`)}
          onChange={(v) => setStyle({ strokeWidth: v })}
        />
        {isArrow ? null : (
          <>
            <ColorRow
              id={`sh-fill-${shape.id}`}
              label="Fill"
              value={style.fill}
              onChange={(v) => setStyle({ fill: v })}
            />
            <SliderRow
              label="Fill opacity"
              value={style.fillOpacity}
              min={0}
              max={1}
              step={0.01}
              format={(v) => (v === 0 ? 'None' : `${Math.round(v * 100)}%`)}
              onChange={(v) => setStyle({ fillOpacity: v })}
            />
          </>
        )}
        {hasCorners ? (
          <SliderRow
            label="Corner radius"
            value={style.radius}
            min={0}
            max={120}
            step={1}
            format={(v) => `${Math.round(v)}px`}
            onChange={(v) => setStyle({ radius: v })}
          />
        ) : null}

        <SliderRow
          label="Start"
          value={shape.startOffset}
          min={0}
          max={Math.max(shape.startOffset + 30, 60)}
          step={0.1}
          format={(v) => formatTime(v, false)}
          onChange={(v) => updateShape(shape.id, { startOffset: v })}
        />
        <SliderRow
          label="Duration"
          value={shape.duration}
          min={0.5}
          max={60}
          step={0.1}
          format={(v) => formatTime(v, false)}
          onChange={(v) => updateShape(shape.id, { duration: v })}
        />
        <OverlayFadeControls
          overlay={shape}
          onChange={(patch) => updateShape(shape.id, patch)}
        />
      </div>
    </PanelShell>
  );
}

/** Fade in / out for any overlay; each capped by what the other leaves. */
function OverlayFadeControls({
  overlay,
  onChange,
}: {
  overlay: AnyOverlay;
  onChange: (patch: { fadeIn?: number; fadeOut?: number }) => void;
}) {
  const { fadeIn, fadeOut } = effectiveOverlayFades(overlay);
  return (
    <>
      <SliderRow
        label="Fade in"
        value={fadeIn}
        min={0}
        max={Math.max(0.01, overlay.duration - fadeOut)}
        step={0.05}
        format={(v) => (v === 0 ? 'None' : `${v.toFixed(2)}s`)}
        onChange={(v) => onChange({ fadeIn: v })}
      />
      <SliderRow
        label="Fade out"
        value={fadeOut}
        min={0}
        max={Math.max(0.01, overlay.duration - fadeIn)}
        step={0.05}
        format={(v) => (v === 0 ? 'None' : `${v.toFixed(2)}s`)}
        onChange={(v) => onChange({ fadeOut: v })}
      />
    </>
  );
}

function ColorRow({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <label
        htmlFor={id}
        className="text-[11px] uppercase tracking-wide text-text-muted"
      >
        {label}
      </label>
      <input
        id={id}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-12 cursor-pointer rounded border border-border bg-chrome"
      />
    </div>
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
