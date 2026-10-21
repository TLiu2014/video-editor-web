import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  clampDelta,
  computeDeltaRange,
} from '../lib/clipBounds';
import { computeTimelineDuration } from '../lib/clipRate';
import { newId } from '../lib/ids';
import {
  baseTrackClips,
  MAX_TRANSITION_DURATION,
  maxTransitionDuration,
  MIN_TRANSITION_DURATION,
  previousTouching,
} from '../lib/transitions';
import {
  closeGaps as closeGapsOp,
  insertAssetClip,
  joinClips as joinClipsOp,
  moveClipsBy,
  placeClip,
  reorderClip as reorderClipOp,
  type ReorderTarget,
  removeClips as removeClipsOp,
  removeMediaAsset as removeMediaAssetOp,
  removeUnusedMedia as removeUnusedMediaOp,
  rippleRemoveClips,
} from '../lib/timelineOps';
import { serializeProject } from '../serialization/project';
import type {
  AnyClip,
  AnyOverlay,
  AudioClip,
  ClipId,
  MediaAsset,
  MediaId,
  OverlayId,
  ShapeOverlay,
  TextOverlay,
  TrackId,
  TransitionKind,
  VideoClip,
  VideoClipEffects,
  ZoomKeyframe,
  VideoProject,
} from '../types/timeline';

function findClip(
  project: VideoProject,
  clipId: ClipId,
): AnyClip | null {
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.id === clipId) return clip;
    }
  }
  return null;
}

/**
 * The timeline store.
 *
 * Performance note: the playhead is updated up to 60 times per second during
 * scrubbing and playback. Heavy components (clip strips, waveforms, the
 * preview canvas) MUST subscribe via a narrow selector — e.g.
 * `useTimelineStore(s => s.playheadPosition)` — or, for canvas-driven views
 * that bypass React reconciliation entirely,
 * `useTimelineStore.subscribe(s => s.playheadPosition, draw)` via the
 * `subscribeWithSelector` middleware. Reading the full state in a parent
 * component will tank the frame rate.
 */

export interface TimelineState {
  currentProject: VideoProject | null;
  playheadPosition: number;
  isPlaying: boolean;
  /**
   * Transport speed while playing: 1 = normal, 2/4/8 = fast forward,
   * negative = reverse (JKL shuttle — see lib/shuttle.ts).
   */
  shuttleSpeed: number;
  /**
   * Primary single-clip selection — drives PropertiesPanel and the
   * delete shortcut. Mirrors `selectedClipIds[0]` for convenience.
   */
  selectedClipId: ClipId | null;
  /**
   * Multi-select set. Always contains `selectedClipId` (if any).
   * Shift+click adds/removes entries.
   */
  selectedClipIds: ClipId[];
  selectedOverlayId: OverlayId | null;
  /**
   * Number of clips currently held in the paste clipboard. The
   * clipboard data itself is module-private so it doesn't show up
   * in serialization or undo snapshots; we surface only the size
   * here so the UI can reactively enable/disable Paste.
   */
  clipboardSize: number;
  /**
   * In/Out range markers (seconds on the global timeline). Drives
   * the "Trim to Range" action. Either may be null to mean "open
   * on this end" — only one set still defines a half-range.
   */
  inPoint: number | null;
  outPoint: number | null;
}

export interface TimelineActions {
  /** Create a fresh project with a default video and audio track, install it, and return it. */
  createProject: (name: string) => VideoProject;
  loadProject: (project: VideoProject) => void;
  closeProject: () => void;
  /** Rename the current project. No-op when no project is loaded. */
  renameProject: (name: string) => void;

  /**
   * Patch the project's output configuration (resolution, frame
   * rate, audio sample rate). Filter graph uses these on next
   * export. No-op when no project is loaded.
   */
  updateProjectSettings: (
    patch: Partial<Pick<VideoProject, 'resolution' | 'frameRate' | 'audioSampleRate'>>,
  ) => void;

  /** Append a new empty track of the given type. */
  addTrack: (type: 'video' | 'audio') => void;
  /** Remove a track (and all its clips). Last-of-type is preserved. */
  removeTrack: (trackId: TrackId) => void;
  /** Toggle (or set) the mute flag on a track. Audio-only effect. */
  setTrackMuted: (trackId: TrackId, muted: boolean) => void;
  /** Toggle (or set) the solo flag on a track. */
  setTrackSolo: (trackId: TrackId, solo: boolean) => void;

  /** Append imported assets to the media library (no timeline change). */
  addMediaAssets: (assets: MediaAsset[]) => void;
  /**
   * Rename a library asset. Clips still carrying the asset's old name
   * follow the rename; clips the user renamed separately keep theirs.
   */
  renameMediaAsset: (mediaId: MediaId, name: string) => void;
  /** Remove an asset from the library AND every clip that uses it. */
  removeMediaAsset: (mediaId: MediaId) => void;
  /** Remove every library asset not used by any clip. */
  removeUnusedMedia: () => void;
  /**
   * Place a full-length clip of a library asset on the timeline (see
   * `insertAssetClip` for the track/slot fallback). Selects the new
   * clip and returns its id, or null when nothing could be placed.
   */
  insertMediaClip: (
    mediaId: MediaId,
    opts: { trackId?: TrackId; startOffset: number },
  ) => ClipId | null;

  addVideoClip: (trackId: TrackId, clip: VideoClip) => void;
  addAudioClip: (trackId: TrackId, clip: AudioClip) => void;
  removeClip: (clipId: ClipId) => void;
  /** Delete several clips at once (one undo step). */
  removeClips: (clipIds: ClipId[]) => void;
  /** Ripple-delete several clips; each track closes its own gaps. */
  rippleDeleteClips: (clipIds: ClipId[]) => void;
  /**
   * Delete a clip AND pull every subsequent clip on the same track
   * left by the deleted clip's timeline duration. Closes the gap so
   * downstream content moves up. Cross-track clips are untouched.
   */
  rippleDeleteClip: (clipId: ClipId) => void;
  /**
   * Reposition a clip. An ungrouped clip lands in the free slot
   * nearest `startOffset` — so it can be dragged past neighbors —
   * on its own track or, when `targetTrackId` names a different track
   * OF THE SAME TYPE, on that one. A grouped clip moves with its
   * group on its own track and is clamped against neighbors.
   */
  moveClip: (
    clipId: ClipId,
    startOffset: number,
    targetTrackId?: TrackId,
  ) => void;

  /**
   * Adjust the in/out points of a clip. `trimStart` and `trimEnd` are
   * absolute offsets within the source file; `duration` is recomputed.
   * Out-of-range values are clamped by the caller — the store trusts inputs.
   */
  trimClip: (clipId: ClipId, trimStart: number, trimEnd: number) => void;

  /**
   * Rearrange: move a clip to directly before / after another clip,
   * closing its old spot and pushing later clips to make room.
   */
  reorderClip: (
    clipId: ClipId,
    target: Pick<ReorderTarget, 'trackId' | 'targetClipId' | 'side'>,
  ) => void;

  /**
   * Shift several clips (plus their group-mates) by `delta` seconds in
   * lockstep, clamped so none overlaps a non-moving clip.
   */
  moveClips: (clipIds: ClipId[], delta: number) => void;

  /**
   * Trim the start (`'start'`) or end (`'end'`) of clips to the
   * playhead. Targets the selected clips the playhead crosses, or
   * every clip it crosses when none is selected. `ripple` shifts
   * downstream same-track clips to close / open the space.
   */
  trimClipsToPlayhead: (side: 'start' | 'end', ripple: boolean) => void;

  /**
   * Join clips that are continuous pieces of the same source back
   * into one (the inverse of split). No-op unless `checkJoin` passes.
   */
  joinClips: (clipIds: ClipId[]) => void;

  /** Close the gaps between clips on each listed track. */
  closeGaps: (trackIds: TrackId[]) => void;

  /**
   * Drag the LEFT trim handle to a new `trimStart`. The clip's
   * `startOffset` advances by the same delta so the visible portion of
   * the timeline stays anchored under the new handle position. Values
   * are clamped to `[0, trimEnd - MIN_CLIP_DURATION]`.
   */
  trimClipLeft: (clipId: ClipId, newTrimStart: number) => void;

  /**
   * Drag the RIGHT trim handle to a new `trimEnd`. The clip's
   * `startOffset` is unchanged. Clamped to
   * `[trimStart + MIN_CLIP_DURATION, sourceDuration]`.
   */
  trimClipRight: (clipId: ClipId, newTrimEnd: number) => void;

  /**
   * Ripple version of `trimClipLeft` — the clip's `startOffset`
   * stays put, `trimStart` advances to `newTrimStart`, duration
   * shrinks by the same delta, and every downstream same-track
   * clip is pulled left by the timeline-delta so they stay
   * contiguous with the moving right edge. Data-model bounds
   * still apply (trimStart >= 0, MIN_CLIP_DURATION).
   */
  rippleTrimLeft: (clipId: ClipId, newTrimStart: number) => void;

  /**
   * Ripple version of `trimClipRight` — `trimEnd` moves to
   * `newTrimEnd`, duration changes by the delta, and every
   * downstream same-track clip shifts by the same delta. No
   * neighbor clamp; data-model bounds still apply (trimEnd <=
   * sourceDuration, MIN_CLIP_DURATION).
   */
  rippleTrimRight: (clipId: ClipId, newTrimEnd: number) => void;

  selectClip: (clipId: ClipId | null) => void;
  /**
   * Toggle a clip's presence in the multi-select set. Doesn't
   * clear other selections — pair with `selectClip(null)` first
   * if you want a fresh start.
   */
  toggleClipSelection: (clipId: ClipId) => void;
  /** Replace the multi-select set wholesale. */
  setSelectedClipIds: (clipIds: ClipId[]) => void;
  selectOverlay: (overlayId: OverlayId | null) => void;

  /** Assign a fresh group id to the listed clip ids. */
  groupClips: (clipIds: ClipId[]) => void;
  /** Clear `groupId` on every clip in the given group. */
  ungroupClips: (groupId: string) => void;

  addOverlay: (overlay: AnyOverlay) => void;
  /**
   * Append multiple overlays in a single mutation (one history
   * entry). Used by auto-captions, which adds many overlays at once.
   */
  addOverlays: (overlays: TextOverlay[]) => void;
  removeOverlay: (overlayId: OverlayId) => void;
  updateOverlay: (
    overlayId: OverlayId,
    patch: Partial<Omit<TextOverlay, 'id'>>,
  ) => void;
  /** Patch an annotation shape (geometry, style, text, timing). */
  updateShape: (
    overlayId: OverlayId,
    patch: Partial<Omit<ShapeOverlay, 'id' | 'kind'>>,
  ) => void;

  /**
   * Set (or clear with null) the transition into a V1 video clip from
   * the clip touching its left edge. Duration is clamped to what fits.
   */
  setClipTransitionIn: (
    clipId: ClipId,
    transition: { kind: TransitionKind; duration: number } | null,
  ) => void;

  /** Replace (or clear with null) a video clip's zoom & pan keyframes. */
  setZoomKeyframes: (clipId: ClipId, keyframes: ZoomKeyframe[] | null) => void;

  /** Set the volume of an audio clip. Values are clamped to [0, 2]. */
  setClipVolume: (clipId: ClipId, volume: number) => void;

  /**
   * Set a clip's fade-in / fade-out duration in seconds. Each is
   * clamped to `[0, duration - other-fade]` so the two fades can
   * never sum past the clip's total duration.
   */
  setClipFadeIn: (clipId: ClipId, fadeIn: number) => void;
  setClipFadeOut: (clipId: ClipId, fadeOut: number) => void;

  /**
   * Change the clip's playback rate. Clamped to [0.25, 4]. The
   * clip's effective timeline duration is recomputed; everything
   * else (trim, fades) stays in source-time.
   */
  setClipPlaybackRate: (clipId: ClipId, rate: number) => void;

  /**
   * Override the clip's background color, or clear the override
   * by passing `null`. Color string is expected to be `#RRGGBB`.
   */
  setClipColor: (clipId: ClipId, color: string | null) => void;

  /**
   * Patch a video clip's color effects. Passing `null` clears all
   * effects on the clip. Values outside the documented ranges are
   * clamped on the consumer side; the store stores them as-is so
   * round-trips through serialize/rehydrate stay lossless.
   */
  setClipEffects: (
    clipId: ClipId,
    patch: Partial<VideoClipEffects> | null,
  ) => void;

  /**
   * Patch a video clip's PiP transform (overlay tracks only).
   * Passing `null` clears the transform (full-frame letterbox).
   * Position/scale clamped to 0–1; rotation to [-360, 360];
   * opacity to [0, 1].
   */
  setClipTransform: (
    clipId: ClipId,
    patch: Partial<{
      x: number;
      y: number;
      scale: number;
      rotation: number;
      opacity: number;
    }> | null,
  ) => void;

  /**
   * Manually override the `hasAudio` flag on a video clip — useful
   * when the import-time probe mis-classifies (e.g., reports audio
   * for a silent screen recording). Affects export only; preview
   * playback always uses the video element's native audio.
   */
  setVideoClipHasAudio: (clipId: ClipId, hasAudio: boolean) => void;

  /** 60fps-hot path. Keep this allocation-free. */
  updatePlayhead: (seconds: number) => void;
  setPlaying: (playing: boolean) => void;
  setShuttleSpeed: (speed: number) => void;

  /**
   * Split whichever clip on the given track currently sits under the
   * playhead. The left half keeps the original id; the right half receives
   * `newClipId`. No-op if no clip is under the playhead.
   */
  splitClipAtPlayhead: (trackId: TrackId, newClipId: ClipId) => void;

  /**
   * Razor across every track at the current playhead. With no
   * options, every clip the playhead strictly crosses splits; with
   * `onlySelectedIds`, only the listed ids are eligible. Left
   * halves retain their original ids; right halves get fresh ones.
   */
  splitClipsAtPlayhead: (opts?: { onlySelectedIds?: ClipId[] }) => void;

  /**
   * Snapshot the listed clips into a module-level clipboard.
   * Subsequent `pasteClipboardAtPlayhead` calls reproduce them on
   * the timeline. Pure side-effect — does not modify the project.
   */
  copyClipsToClipboard: (clipIds: ClipId[]) => void;

  /**
   * Drop the clipboard's clips onto the timeline starting at the
   * playhead. Relative offsets between clipboard entries are
   * preserved; each entry tries to land on its original track and
   * falls through to any same-kind track that fits. Entries that
   * can't fit on any same-kind track are silently skipped.
   * Grouped clipboard entries get a fresh shared groupId so the
   * pasted set stays linked without merging with the originals.
   */
  pasteClipboardAtPlayhead: () => void;

  /**
   * Set the in-point to a specific time (or null to clear). When
   * the new in-point would pass the existing out-point, the two
   * swap so the range stays valid.
   */
  setInPoint: (seconds: number | null) => void;
  setOutPoint: (seconds: number | null) => void;
  /** Drop both in- and out-points. */
  clearInOutPoints: () => void;

  /**
   * Crop the project to the in/out range. Clips fully outside the
   * window are removed; clips spanning a boundary are trimmed to
   * the boundary; text overlays are cropped the same way. No-op
   * when neither in nor out is set. Surviving content keeps its
   * absolute timeline position — the user can ripple-delete the
   * leading gap if they want it to start at t=0.
   */
  trimToRange: () => void;

  /**
   * Delete everything inside the in/out range and ripple downstream
   * content left by the range duration to close the gap. The
   * complement of `trimToRange`. Requires both points to be set —
   * a half-range has no closing duration to ripple by.
   */
  deleteRange: () => void;

  /**
   * Set both inPoint and outPoint as a small range centered around
   * the current playhead. Clamps to >= 0 (and to the project
   * duration if known) so the marks never sit on top of each other
   * at t=0. Width is ~2s by default.
   */
  markRangeAtPlayhead: () => void;

  exportTimelineToJSON: () => string;
}

export type TimelineStore = TimelineState & TimelineActions;

const initialState: TimelineState = {
  currentProject: null,
  playheadPosition: 0,
  isPlaying: false,
  shuttleSpeed: 1,
  selectedClipId: null,
  selectedClipIds: [],
  selectedOverlayId: null,
  clipboardSize: 0,
  inPoint: null,
  outPoint: null,
};

/** Hard floor for clip length — prevents zero-width clips during a trim. */
export const MIN_CLIP_DURATION = 0.1;

/**
 * Split a single clip at an absolute timeline position. The generic
 * preserves the variant — splitting a `VideoClip` returns `[VideoClip,
 * VideoClip]`, splitting an `AudioClip` (with its `volume`) returns
 * `[AudioClip, AudioClip]`. Zero runtime cost vs. a runtime kind check.
 *
 * Caller must guarantee the playhead actually lies strictly inside the
 * clip's timeline span — `splitClipAtPlayhead` enforces this.
 */
function splitClipAt<T extends AnyClip>(
  clip: T,
  playhead: number,
  newClipId: ClipId,
): [T, T] {
  const rate = clip.playbackRate ?? 1;
  // `playhead - startOffset` is in timeline-seconds; multiply by
  // rate to convert into source-seconds so the trim cut lands at
  // the right frame of the original file.
  const splitOffsetIntoSource =
    clip.trimStart + (playhead - clip.startOffset) * rate;
  const left = {
    ...clip,
    trimEnd: splitOffsetIntoSource,
    duration: computeTimelineDuration(
      clip.trimStart,
      splitOffsetIntoSource,
      rate,
    ),
  } as T;
  // The right half starts at a fresh cut inside the old clip, so a
  // transition into the original clip stays with the left half.
  const { transitionIn: _keepOnLeft, ...rest } = clip as AnyClip & {
    transitionIn?: unknown;
  };
  const right = {
    ...rest,
    id: newClipId,
    startOffset: playhead,
    trimStart: splitOffsetIntoSource,
    duration: computeTimelineDuration(
      splitOffsetIntoSource,
      clip.trimEnd,
      rate,
    ),
  } as T;
  return [left, right];
}

function buildBlankProject(name: string): VideoProject {
  return {
    id: newId(),
    name,
    resolution: { width: 1920, height: 1080 },
    frameRate: 30,
    audioSampleRate: 48000,
    tracks: [
      { id: newId(), type: 'video', clips: [] },
      { id: newId(), type: 'audio', clips: [] },
    ],
    overlays: [],
    media: [],
  };
}

export const useTimelineStore = create<TimelineStore>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    createProject: (name) => {
      const project = buildBlankProject(name);
      set({
        currentProject: project,
        playheadPosition: 0,
        isPlaying: false,
        selectedClipId: null,
        selectedClipIds: [],
        selectedOverlayId: null,
        inPoint: null,
        outPoint: null,
      });
      return project;
    },

    loadProject: (project) =>
      set({
        currentProject: project,
        playheadPosition: 0,
        isPlaying: false,
        selectedClipId: null,
        selectedClipIds: [],
        selectedOverlayId: null,
        inPoint: null,
        outPoint: null,
      }),

    // Preserve `clipboardSize` (and the module-level clipboard
    // itself) across project close — users routinely copy in one
    // project and paste in another.
    closeProject: () =>
      set((state) => ({ ...initialState, clipboardSize: state.clipboardSize })),

    renameProject: (name) =>
      set((state) => {
        if (!state.currentProject) return state;
        const trimmed = name.trim();
        if (!trimmed || trimmed === state.currentProject.name) return state;
        return {
          currentProject: { ...state.currentProject, name: trimmed },
        };
      }),

    addTrack: (type) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            tracks: [
              ...state.currentProject.tracks,
              { id: newId(), type, clips: [] },
            ],
          },
        };
      }),

    setTrackMuted: (trackId, muted) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((t) =>
              t.id !== trackId ? t : { ...t, muted: muted || undefined },
            ),
          },
        };
      }),

    setTrackSolo: (trackId, solo) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((t) =>
              t.id !== trackId ? t : { ...t, solo: solo || undefined },
            ),
          },
        };
      }),

    removeTrack: (trackId) =>
      set((state) => {
        if (!state.currentProject) return state;
        const target = state.currentProject.tracks.find(
          (t) => t.id === trackId,
        );
        if (!target) return state;
        // Don't allow removing the last track of its type — the
        // project needs at least one of each for the timeline UI
        // and the export pipeline to remain coherent.
        const sameTypeCount = state.currentProject.tracks.filter(
          (t) => t.type === target.type,
        ).length;
        if (sameTypeCount <= 1) return state;

        const removedClipIds = new Set(target.clips.map((c) => c.id));
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.filter(
              (t) => t.id !== trackId,
            ),
          },
          selectedClipId:
            state.selectedClipId && removedClipIds.has(state.selectedClipId)
              ? null
              : state.selectedClipId,
        };
      }),

    updateProjectSettings: (patch) =>
      set((state) => {
        if (!state.currentProject) return state;
        // Resolution caps at 4K (3840×2160) — wasm builds can
        // technically go higher but the linear-memory ceiling
        // makes that risky; the export dialog warns above 1080p.
        const next = { ...state.currentProject };
        if (patch.resolution) {
          next.resolution = {
            width: Math.max(16, Math.min(3840, Math.round(patch.resolution.width))),
            height: Math.max(16, Math.min(2160, Math.round(patch.resolution.height))),
          };
        }
        if (patch.frameRate !== undefined) {
          next.frameRate = Math.max(1, Math.min(60, Math.round(patch.frameRate)));
        }
        if (patch.audioSampleRate !== undefined) {
          next.audioSampleRate = patch.audioSampleRate;
        }
        return { currentProject: next };
      }),

    addMediaAssets: (assets) =>
      set((state) => {
        if (!state.currentProject || assets.length === 0) return state;
        return {
          currentProject: {
            ...state.currentProject,
            media: [...state.currentProject.media, ...assets],
          },
        };
      }),

    renameMediaAsset: (mediaId, name) =>
      set((state) => {
        const project = state.currentProject;
        if (!project) return state;
        const trimmed = name.trim();
        const asset = project.media.find((m) => m.id === mediaId);
        if (!asset || !trimmed || trimmed === asset.name) return state;
        return {
          currentProject: {
            ...project,
            media: project.media.map((m) =>
              m.id === mediaId ? { ...m, name: trimmed } : m,
            ),
            tracks: project.tracks.map((t) => ({
              ...t,
              clips: t.clips.map((c) =>
                c.mediaId === mediaId && c.name === asset.name
                  ? { ...c, name: trimmed }
                  : c,
              ),
            })),
          },
        };
      }),

    removeMediaAsset: (mediaId) =>
      set((state) => {
        if (!state.currentProject) return state;
        const next = removeMediaAssetOp(state.currentProject, mediaId);
        return { currentProject: next, ...pruneSelection(state, next) };
      }),

    removeUnusedMedia: () =>
      set((state) => {
        if (!state.currentProject) return state;
        const next = removeUnusedMediaOp(state.currentProject);
        return next === state.currentProject ? state : { currentProject: next };
      }),

    insertMediaClip: (mediaId, opts) => {
      const project = get().currentProject;
      const asset = project?.media.find((m) => m.id === mediaId);
      if (!project || !asset) return null;
      const result = insertAssetClip(project, asset, opts);
      if (!result) return null;
      set({
        currentProject: result.project,
        selectedClipId: result.clip.id,
        selectedClipIds: [result.clip.id],
        selectedOverlayId: null,
      });
      return result.clip.id;
    },

    addVideoClip: (trackId, clip) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) =>
              track.id === trackId
                ? { ...track, clips: [...track.clips, clip] }
                : track,
            ),
          },
        };
      }),

    addAudioClip: (trackId, clip) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) =>
              track.id === trackId
                ? { ...track, clips: [...track.clips, clip] }
                : track,
            ),
          },
        };
      }),

    removeClip: (clipId) => get().removeClips([clipId]),

    removeClips: (clipIds) =>
      set((state) => {
        if (!state.currentProject || clipIds.length === 0) return state;
        const next = removeClipsOp(state.currentProject, new Set(clipIds));
        return { currentProject: next, ...pruneSelection(state, next) };
      }),

    rippleDeleteClip: (clipId) => get().rippleDeleteClips([clipId]),

    rippleDeleteClips: (clipIds) =>
      set((state) => {
        if (!state.currentProject || clipIds.length === 0) return state;
        const next = rippleRemoveClips(state.currentProject, new Set(clipIds));
        return { currentProject: next, ...pruneSelection(state, next) };
      }),

    moveClip: (clipId, startOffset, targetTrackId) =>
      set((state) => {
        const project = state.currentProject;
        if (!project) return state;
        const clip = findClip(project, clipId);
        if (!clip) return state;
        const crossTrack =
          targetTrackId !== undefined && targetTrackId !== clip.trackId;
        // Grouped clips move as a unit on their own tracks; jumping
        // into a free slot would break the group's relative timing.
        const next =
          clip.groupId && !crossTrack
            ? moveClipsBy(project, [clipId], startOffset - clip.startOffset)
            : placeClip(project, clipId, startOffset, targetTrackId);
        return next === project ? state : { currentProject: next };
      }),

    reorderClip: (clipId, target) =>
      set((state) => {
        const project = state.currentProject;
        if (!project) return state;
        const next = reorderClipOp(project, clipId, target);
        return next === project ? state : { currentProject: next };
      }),

    moveClips: (clipIds, delta) =>
      set((state) => {
        const project = state.currentProject;
        if (!project) return state;
        const next = moveClipsBy(project, clipIds, delta);
        return next === project ? state : { currentProject: next };
      }),

    trimClipsToPlayhead: (side, ripple) => {
      const state = get();
      const project = state.currentProject;
      if (!project) return;
      const playhead = state.playheadPosition;
      const crossed = project.tracks.flatMap((t) =>
        t.clips.filter(
          (c) =>
            playhead > c.startOffset + MIN_CLIP_DURATION / 2 &&
            playhead < c.startOffset + c.duration - MIN_CLIP_DURATION / 2,
        ),
      );
      const selected = new Set(state.selectedClipIds);
      const targets =
        selected.size > 0 ? crossed.filter((c) => selected.has(c.id)) : crossed;
      for (const clip of targets) {
        // Playhead (timeline) → source time inside this clip.
        const sourceAt =
          clip.trimStart + (playhead - clip.startOffset) * (clip.playbackRate ?? 1);
        const s = get();
        if (side === 'start') {
          if (ripple) s.rippleTrimLeft(clip.id, sourceAt);
          else s.trimClipLeft(clip.id, sourceAt);
        } else if (ripple) {
          s.rippleTrimRight(clip.id, sourceAt);
        } else {
          s.trimClipRight(clip.id, sourceAt);
        }
      }
      // A ripple start-trim pulls the trimmed clip's content left
      // under a fixed start, so park the playhead on the new edit
      // point — like Premiere's Q.
      if (ripple && side === 'start' && targets.length > 0) {
        const first = targets.reduce((a, b) =>
          a.startOffset < b.startOffset ? a : b,
        );
        get().updatePlayhead(first.startOffset);
      }
    },

    joinClips: (clipIds) =>
      set((state) => {
        if (!state.currentProject) return state;
        const result = joinClipsOp(state.currentProject, clipIds);
        if (!result) return state;
        return {
          currentProject: result.project,
          selectedClipId: result.joinedId,
          selectedClipIds: [result.joinedId],
          selectedOverlayId: null,
        };
      }),

    closeGaps: (trackIds) =>
      set((state) => {
        if (!state.currentProject || trackIds.length === 0) return state;
        return {
          currentProject: closeGapsOp(state.currentProject, new Set(trackIds)),
        };
      }),

    trimClip: (clipId, trimStart, trimEnd) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((clip) =>
                clip.id === clipId
                  ? {
                      ...clip,
                      trimStart,
                      trimEnd,
                      duration: computeTimelineDuration(
                        trimStart,
                        trimEnd,
                        clip.playbackRate,
                      ),
                    }
                  : clip,
              ),
            })),
          },
        };
      }),

    trimClipLeft: (clipId, newTrimStart) =>
      set((state) => {
        if (!state.currentProject) return state;
        const clip = findClip(state.currentProject, clipId);
        if (!clip) return state;
        const requestedDelta = newTrimStart - clip.trimStart;
        const range = computeDeltaRange(clip, 'trim-left', state.currentProject);
        const deltaSec = clampDelta(range, requestedDelta);
        const finalTrimStart = clip.trimStart + deltaSec;
        // Source-time delta scales by rate when projecting to
        // the timeline — a 1s left-trim only consumes 1/rate of
        // timeline because each source-second occupies less of it.
        const rate = clip.playbackRate ?? 1;
        const timelineDelta = deltaSec / rate;
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((c) =>
                c.id !== clipId
                  ? c
                  : {
                      ...c,
                      trimStart: finalTrimStart,
                      startOffset: c.startOffset + timelineDelta,
                      duration: computeTimelineDuration(
                        finalTrimStart,
                        c.trimEnd,
                        c.playbackRate,
                      ),
                    },
              ),
            })),
          },
        };
      }),

    trimClipRight: (clipId, newTrimEnd) =>
      set((state) => {
        if (!state.currentProject) return state;
        const clip = findClip(state.currentProject, clipId);
        if (!clip) return state;
        const requestedDelta = newTrimEnd - clip.trimEnd;
        const range = computeDeltaRange(clip, 'trim-right', state.currentProject);
        const deltaSec = clampDelta(range, requestedDelta);
        const finalTrimEnd = clip.trimEnd + deltaSec;
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((c) =>
                c.id !== clipId
                  ? c
                  : {
                      ...c,
                      trimEnd: finalTrimEnd,
                      duration: computeTimelineDuration(
                        c.trimStart,
                        finalTrimEnd,
                        c.playbackRate,
                      ),
                    },
              ),
            })),
          },
        };
      }),

    rippleTrimLeft: (clipId, newTrimStart) =>
      set((state) => {
        if (!state.currentProject) return state;
        const located = (() => {
          for (const track of state.currentProject.tracks) {
            for (const clip of track.clips) {
              if (clip.id === clipId) return { track, clip };
            }
          }
          return null;
        })();
        if (!located) return state;
        const { track: hostTrack, clip } = located;
        const rate = clip.playbackRate ?? 1;
        // Source-time bounds: trimStart >= 0; leave at least
        // MIN_CLIP_DURATION worth of source after the new start.
        const minTrimStart = 0;
        const maxTrimStart = clip.trimEnd - MIN_CLIP_DURATION * rate;
        const requestedTrimStart = Math.max(
          minTrimStart,
          Math.min(maxTrimStart, newTrimStart),
        );
        // Right-edge moves LEFT by `requestedShift` when trimStart
        // grows (clip shrunk from the left with startOffset pinned).
        // Downstream shifts by that same negative timeline-delta.
        const requestedShift = -(requestedTrimStart - clip.trimStart) / rate;
        const originalEnd = clip.startOffset + clip.duration;
        // If the ripple would push a downstream clip past zero
        // (already-overlapping legacy clips), cap the shift at the
        // largest magnitude that keeps everything non-negative.
        let safeShift = requestedShift;
        for (const other of hostTrack.clips) {
          if (other.id === clipId) continue;
          if (other.startOffset >= originalEnd) {
            const projected = other.startOffset + safeShift;
            if (projected < 0) safeShift = -other.startOffset;
          }
        }
        const cappedTrimStart =
          clip.trimStart + (-safeShift) * rate;
        const cappedDuration = computeTimelineDuration(
          cappedTrimStart,
          clip.trimEnd,
          clip.playbackRate,
        );
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) => {
              if (track.id !== hostTrack.id) return track;
              return {
                ...track,
                clips: track.clips.map((c) => {
                  if (c.id === clipId) {
                    return {
                      ...c,
                      trimStart: cappedTrimStart,
                      duration: cappedDuration,
                    };
                  }
                  if (c.startOffset >= originalEnd) {
                    return {
                      ...c,
                      startOffset: c.startOffset + safeShift,
                    };
                  }
                  return c;
                }),
              };
            }),
          },
        };
      }),

    rippleTrimRight: (clipId, newTrimEnd) =>
      set((state) => {
        if (!state.currentProject) return state;
        const located = (() => {
          for (const track of state.currentProject.tracks) {
            for (const clip of track.clips) {
              if (clip.id === clipId) return { track, clip };
            }
          }
          return null;
        })();
        if (!located) return state;
        const { track: hostTrack, clip } = located;
        const rate = clip.playbackRate ?? 1;
        const minTrimEnd = clip.trimStart + MIN_CLIP_DURATION * rate;
        const maxTrimEnd = clip.sourceDuration;
        const finalTrimEnd = Math.max(
          minTrimEnd,
          Math.min(maxTrimEnd, newTrimEnd),
        );
        const sourceDelta = finalTrimEnd - clip.trimEnd;
        const timelineDelta = sourceDelta / rate;
        const originalEnd = clip.startOffset + clip.duration;
        const newDuration = computeTimelineDuration(
          clip.trimStart,
          finalTrimEnd,
          clip.playbackRate,
        );
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) => {
              if (track.id !== hostTrack.id) return track;
              return {
                ...track,
                clips: track.clips.map((c) => {
                  if (c.id === clipId) {
                    return {
                      ...c,
                      trimEnd: finalTrimEnd,
                      duration: newDuration,
                    };
                  }
                  if (c.startOffset >= originalEnd) {
                    return {
                      ...c,
                      startOffset: Math.max(0, c.startOffset + timelineDelta),
                    };
                  }
                  return c;
                }),
              };
            }),
          },
        };
      }),

    selectClip: (clipId) =>
      set({
        selectedClipId: clipId,
        selectedClipIds: clipId ? [clipId] : [],
        selectedOverlayId: null,
      }),

    toggleClipSelection: (clipId) =>
      set((state) => {
        const next = state.selectedClipIds.includes(clipId)
          ? state.selectedClipIds.filter((id) => id !== clipId)
          : [...state.selectedClipIds, clipId];
        return {
          selectedClipIds: next,
          // Primary selection stays as the most-recently-added id,
          // or null when the set is empty.
          selectedClipId: next.length > 0 ? next[next.length - 1] ?? null : null,
          selectedOverlayId: null,
        };
      }),

    setSelectedClipIds: (clipIds) =>
      set({
        selectedClipIds: clipIds,
        selectedClipId:
          clipIds.length > 0 ? clipIds[clipIds.length - 1] ?? null : null,
        selectedOverlayId: null,
      }),

    selectOverlay: (overlayId) =>
      set({
        selectedOverlayId: overlayId,
        selectedClipId: null,
        selectedClipIds: [],
      }),

    groupClips: (clipIds) =>
      set((state) => {
        if (!state.currentProject) return state;
        if (clipIds.length === 0) return state;
        const groupId = newId();
        const targetSet = new Set(clipIds);
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((c) =>
                targetSet.has(c.id) ? { ...c, groupId } : c,
              ),
            })),
          },
        };
      }),

    ungroupClips: (groupId) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((c) => {
                if (c.groupId !== groupId) return c;
                const { groupId: _drop, ...rest } = c;
                return rest as typeof c;
              }),
            })),
          },
        };
      }),

    addOverlay: (overlay) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            overlays: [...state.currentProject.overlays, overlay],
          },
          selectedOverlayId: overlay.id,
          selectedClipId: null,
        };
      }),

    addOverlays: (overlays) =>
      set((state) => {
        if (!state.currentProject || overlays.length === 0) return state;
        return {
          currentProject: {
            ...state.currentProject,
            overlays: [...state.currentProject.overlays, ...overlays],
          },
          selectedOverlayId:
            overlays[overlays.length - 1]?.id ?? state.selectedOverlayId,
          selectedClipId: null,
        };
      }),

    removeOverlay: (overlayId) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            overlays: state.currentProject.overlays.filter(
              (o) => o.id !== overlayId,
            ),
          },
          selectedOverlayId:
            state.selectedOverlayId === overlayId
              ? null
              : state.selectedOverlayId,
        };
      }),

    updateOverlay: (overlayId, patch) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            // Each patch type only carries its own kind's fields; the
            // caller picks the kind (updateOverlay for text,
            // updateShape for annotations).
            overlays: state.currentProject.overlays.map((o) =>
              o.id === overlayId ? ({ ...o, ...patch } as AnyOverlay) : o,
            ),
          },
        };
      }),

    // Same shallow merge as updateOverlay; the separate action exists
    // so callers get the shape's field types instead of the text's.
    updateShape: (overlayId, patch) =>
      get().updateOverlay(
        overlayId,
        patch as Partial<Omit<TextOverlay, 'id'>>,
      ),

    setClipVolume: (clipId, volume) =>
      set((state) => {
        if (!state.currentProject) return state;
        const clamped = Math.max(0, Math.min(2, volume));
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((clip) =>
                clip.kind === 'audio' && clip.id === clipId
                  ? { ...clip, volume: clamped }
                  : clip,
              ),
            })),
          },
        };
      }),

    setClipTransitionIn: (clipId, transition) =>
      set((state) => {
        const project = state.currentProject;
        if (!project) return state;
        const clips = baseTrackClips(project);
        const clip = clips.find((c) => c.id === clipId);
        if (!clip) return state;
        let next: VideoClip;
        if (transition === null) {
          const { transitionIn: _drop, ...rest } = clip;
          next = rest;
        } else {
          const prev = previousTouching(clips, clip);
          const max = prev ? maxTransitionDuration(prev, clip) : MAX_TRANSITION_DURATION;
          next = {
            ...clip,
            transitionIn: {
              kind: transition.kind,
              duration: Math.max(
                MIN_TRANSITION_DURATION,
                Math.min(max, transition.duration),
              ),
            },
          };
        }
        return {
          currentProject: {
            ...project,
            tracks: project.tracks.map((t) => ({
              ...t,
              clips: t.clips.map((c) => (c.id === clipId ? next : c)),
            })),
          },
        };
      }),

    setZoomKeyframes: (clipId, keyframes) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((clip) => {
                if (clip.id !== clipId || clip.kind !== 'video') return clip;
                if (!keyframes || keyframes.length === 0) {
                  const { zoomKeyframes: _drop, ...rest } = clip;
                  return rest;
                }
                return { ...clip, zoomKeyframes: keyframes };
              }),
            })),
          },
        };
      }),

    setClipFadeIn: (clipId, fadeIn) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((clip) => {
                if (clip.id !== clipId) return clip;
                const maxFadeIn = Math.max(0, clip.duration - clip.fadeOut);
                const clamped = Math.max(0, Math.min(maxFadeIn, fadeIn));
                return { ...clip, fadeIn: clamped };
              }),
            })),
          },
        };
      }),

    setClipPlaybackRate: (clipId, rate) =>
      set((state) => {
        if (!state.currentProject) return state;
        const located = (() => {
          for (const track of state.currentProject.tracks) {
            for (const clip of track.clips) {
              if (clip.id === clipId) return { track, clip };
            }
          }
          return null;
        })();
        if (!located) return state;
        const { track: hostTrack, clip: targetClip } = located;

        // Slowing a clip stretches its timeline duration; if that
        // pushes it into the next neighbor on the same track, we'd
        // silently produce an overlap. Compute the gap to the next
        // neighbor and floor the rate so the new duration fits.
        const sourceSpan = targetClip.trimEnd - targetClip.trimStart;
        const currentEnd = targetClip.startOffset + targetClip.duration;
        let nextStart = Infinity;
        for (const other of hostTrack.clips) {
          if (other.id === clipId) continue;
          // Mirror findNeighborBounds: ignore already-overlapping
          // siblings (legacy data, race conditions). Only neighbors
          // that begin at or after the current clip's end constrain
          // how far we can stretch.
          if (other.startOffset >= currentEnd) {
            if (other.startOffset < nextStart) nextStart = other.startOffset;
          }
        }
        const gap = nextStart - targetClip.startOffset;
        const minRateFromNeighbor =
          gap === Infinity || gap <= 0 ? 0 : sourceSpan / gap;
        const clamped = Math.max(
          0.25,
          Math.max(minRateFromNeighbor, Math.min(4, rate)),
        );
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((clip) => {
                if (clip.id !== clipId) return clip;
                if (clamped === 1) {
                  // Identity — drop the field so persistence stays
                  // compact and `clip.playbackRate ?? 1` keeps working.
                  const { playbackRate: _drop, ...rest } = clip;
                  return {
                    ...rest,
                    duration: computeTimelineDuration(
                      clip.trimStart,
                      clip.trimEnd,
                      1,
                    ),
                  } as typeof clip;
                }
                return {
                  ...clip,
                  playbackRate: clamped,
                  duration: computeTimelineDuration(
                    clip.trimStart,
                    clip.trimEnd,
                    clamped,
                  ),
                };
              }),
            })),
          },
        };
      }),

    setClipFadeOut: (clipId, fadeOut) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((clip) => {
                if (clip.id !== clipId) return clip;
                const maxFadeOut = Math.max(0, clip.duration - clip.fadeIn);
                const clamped = Math.max(0, Math.min(maxFadeOut, fadeOut));
                return { ...clip, fadeOut: clamped };
              }),
            })),
          },
        };
      }),

    setClipColor: (clipId, color) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((clip) => {
                if (clip.id !== clipId) return clip;
                if (color === null) {
                  const { color: _drop, ...rest } = clip;
                  return rest as typeof clip;
                }
                return { ...clip, color };
              }),
            })),
          },
        };
      }),

    setClipTransform: (clipId, patch) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((clip) => {
                if (clip.id !== clipId || clip.kind !== 'video') return clip;
                if (patch === null) {
                  const { transform: _drop, ...rest } = clip;
                  return rest as typeof clip;
                }
                const existing =
                  clip.transform ?? { x: 0.05, y: 0.05, scale: 0.25 };
                const merged = { ...existing, ...patch };
                merged.x = Math.max(0, Math.min(1, merged.x));
                merged.y = Math.max(0, Math.min(1, merged.y));
                merged.scale = Math.max(0.05, Math.min(1, merged.scale));
                if (merged.rotation !== undefined) {
                  const r = Math.max(-360, Math.min(360, merged.rotation));
                  // Drop the field at exactly 0 so persistence stays
                  // compact and "no rotation" is a single canonical shape.
                  if (r === 0) {
                    delete merged.rotation;
                  } else {
                    merged.rotation = r;
                  }
                }
                if (merged.opacity !== undefined) {
                  const o = Math.max(0, Math.min(1, merged.opacity));
                  if (o === 1) {
                    delete merged.opacity;
                  } else {
                    merged.opacity = o;
                  }
                }
                return { ...clip, transform: merged };
              }),
            })),
          },
        };
      }),

    setClipEffects: (clipId, patch) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((clip) => {
                if (clip.id !== clipId || clip.kind !== 'video') return clip;
                if (patch === null) {
                  const { effects: _drop, ...rest } = clip;
                  return rest as typeof clip;
                }
                const next = { ...(clip.effects ?? {}), ...patch };
                // Drop default-valued keys so the persisted shape
                // stays compact and effects can be detected by
                // simple presence checks.
                if (next.brightness === 1) delete next.brightness;
                if (next.contrast === 1) delete next.contrast;
                if (next.saturation === 1) delete next.saturation;
                if (next.blur === 0) delete next.blur;
                if (Object.keys(next).length === 0) {
                  const { effects: _drop, ...rest } = clip;
                  return rest as typeof clip;
                }
                return { ...clip, effects: next };
              }),
            })),
          },
        };
      }),

    setVideoClipHasAudio: (clipId, hasAudio) =>
      set((state) => {
        if (!state.currentProject) return state;
        return {
          currentProject: {
            ...state.currentProject,
            tracks: state.currentProject.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((clip) =>
                clip.kind === 'video' && clip.id === clipId
                  ? { ...clip, hasAudio }
                  : clip,
              ),
            })),
          },
        };
      }),

    // Hot path: bypass shallow-equal short-circuiting cost by writing the
    // primitive directly. Subscribers using selectors will only fire when
    // the number actually changes.
    updatePlayhead: (seconds) => set({ playheadPosition: seconds }),

    // Stopping always returns the shuttle to 1×, so the next plain
    // "play" (Space, transport button) runs at normal speed.
    setPlaying: (playing) =>
      set(playing ? { isPlaying: true } : { isPlaying: false, shuttleSpeed: 1 }),
    setShuttleSpeed: (speed) => set({ shuttleSpeed: speed }),

    splitClipAtPlayhead: (trackId, newClipId) =>
      set((state) => {
        const project = state.currentProject;
        if (!project) return state;
        const playhead = state.playheadPosition;

        return {
          currentProject: {
            ...project,
            tracks: project.tracks.map((track) => {
              if (track.id !== trackId) return track;
              const nextClips: AnyClip[] = [];
              for (const clip of track.clips) {
                const clipEnd = clip.startOffset + clip.duration;
                if (playhead <= clip.startOffset || playhead >= clipEnd) {
                  nextClips.push(clip);
                  continue;
                }
                const [left, right] = splitClipAt(clip, playhead, newClipId);
                nextClips.push(left, right);
              }
              return { ...track, clips: nextClips };
            }),
          },
        };
      }),

    splitClipsAtPlayhead: (opts) =>
      set((state) => {
        const project = state.currentProject;
        if (!project) return state;
        const playhead = state.playheadPosition;
        const filter = opts?.onlySelectedIds
          ? new Set(opts.onlySelectedIds)
          : null;
        return {
          currentProject: {
            ...project,
            tracks: project.tracks.map((track) => {
              const nextClips: AnyClip[] = [];
              for (const clip of track.clips) {
                const clipEnd = clip.startOffset + clip.duration;
                const inRange =
                  playhead > clip.startOffset && playhead < clipEnd;
                const eligible = filter ? filter.has(clip.id) : true;
                if (!inRange || !eligible) {
                  nextClips.push(clip);
                  continue;
                }
                const [left, right] = splitClipAt(clip, playhead, newId());
                nextClips.push(left, right);
              }
              return { ...track, clips: nextClips };
            }),
          },
        };
      }),

    copyClipsToClipboard: (clipIds) => {
      const project = get().currentProject;
      if (!project) {
        clipboard = [];
        set({ clipboardSize: 0 });
        return;
      }
      const idSet = new Set(clipIds);
      const snapshot: ClipboardEntry[] = [];
      for (const track of project.tracks) {
        for (const clip of track.clips) {
          if (idSet.has(clip.id)) {
            snapshot.push({
              clip: { ...clip },
              originalTrackId: track.id,
            });
          }
        }
      }
      clipboard = snapshot;
      set({ clipboardSize: snapshot.length });
    },

    pasteClipboardAtPlayhead: () =>
      set((state) => {
        if (!state.currentProject || clipboard.length === 0) return state;
        const playhead = state.playheadPosition;
        const anchor = clipboard.reduce(
          (min, e) => Math.min(min, e.clip.startOffset),
          Infinity,
        );

        // Working copy: mutable clip array per track so successive
        // paste entries see each other's placements and don't pile
        // on top of one another.
        const work = state.currentProject.tracks.map((t) => ({
          track: t,
          clips: [...t.clips],
        }));

        // Re-key groupIds: any group represented in the clipboard
        // gets a fresh id so the pasted set stays linked but doesn't
        // merge with the originals (which keep their old id).
        const groupRemap = new Map<string, string>();
        const pastedIds: ClipId[] = [];

        for (const entry of clipboard) {
          const { clip, originalTrackId } = entry;
          const targetStart = Math.max(
            0,
            playhead + (clip.startOffset - anchor),
          );

          // Candidate tracks: original first, then any other
          // same-kind track. Cross-kind landing is never allowed
          // (audio on video tracks is structurally invalid).
          const orig = work.find((w) => w.track.id === originalTrackId);
          const candidates: typeof work = [];
          if (orig && orig.track.type === clip.kind) candidates.push(orig);
          for (const w of work) {
            if (w === orig) continue;
            if (w.track.type === clip.kind) candidates.push(w);
          }

          for (const cand of candidates) {
            if (!fits(cand.clips, targetStart, clip.duration)) continue;
            const newClipId = newId();
            const newClip: AnyClip = {
              ...clip,
              id: newClipId,
              trackId: cand.track.id,
              startOffset: targetStart,
            };
            if (clip.groupId) {
              let mapped = groupRemap.get(clip.groupId);
              if (!mapped) {
                mapped = newId();
                groupRemap.set(clip.groupId, mapped);
              }
              newClip.groupId = mapped;
            }
            cand.clips.push(newClip);
            pastedIds.push(newClipId);
            break;
          }
        }

        if (pastedIds.length === 0) return state;

        return {
          currentProject: {
            ...state.currentProject,
            tracks: work.map((w) => ({ ...w.track, clips: w.clips })),
          },
          // Auto-select the pasted set so the user can immediately
          // nudge / delete / inspect it.
          selectedClipIds: pastedIds,
          selectedClipId: pastedIds[pastedIds.length - 1] ?? null,
          selectedOverlayId: null,
        };
      }),

    setInPoint: (seconds) =>
      set((state) => {
        if (seconds === null) return { inPoint: null };
        const clamped = Math.max(0, seconds);
        // Swap if the new in-point lands past the existing
        // out-point — keeps the range valid no matter the order
        // the user marks them.
        if (state.outPoint !== null && clamped > state.outPoint) {
          return { inPoint: state.outPoint, outPoint: clamped };
        }
        return { inPoint: clamped };
      }),

    setOutPoint: (seconds) =>
      set((state) => {
        if (seconds === null) return { outPoint: null };
        const clamped = Math.max(0, seconds);
        if (state.inPoint !== null && clamped < state.inPoint) {
          return { inPoint: clamped, outPoint: state.inPoint };
        }
        return { outPoint: clamped };
      }),

    clearInOutPoints: () => set({ inPoint: null, outPoint: null }),

    trimToRange: () =>
      set((state) => {
        const project = state.currentProject;
        if (!project) return state;
        const { inPoint, outPoint } = state;
        if (inPoint === null && outPoint === null) return state;
        const lo = inPoint ?? 0;
        const hi = outPoint ?? Infinity;
        if (hi <= lo) return state;

        const droppedClipIds = new Set<ClipId>();
        const nextTracks = project.tracks.map((track) => {
          const nextClips: AnyClip[] = [];
          for (const clip of track.clips) {
            const clipEnd = clip.startOffset + clip.duration;
            // Fully outside the keep-range → drop.
            if (clipEnd <= lo || clip.startOffset >= hi) {
              droppedClipIds.add(clip.id);
              continue;
            }
            const rate = clip.playbackRate ?? 1;
            let nextStart = clip.startOffset;
            let nextTrimStart = clip.trimStart;
            let nextTrimEnd = clip.trimEnd;
            // Spans the in-point: shrink from the left so the
            // visible left edge lands on `lo`. The trim cut in
            // source-time scales by rate.
            if (clip.startOffset < lo) {
              const timelineDelta = lo - clip.startOffset;
              nextTrimStart = clip.trimStart + timelineDelta * rate;
              nextStart = lo;
            }
            // Spans the out-point: shrink from the right so the
            // visible right edge lands on `hi`.
            if (clipEnd > hi) {
              const timelineDelta = clipEnd - hi;
              nextTrimEnd = clip.trimEnd - timelineDelta * rate;
            }
            if (nextTrimEnd - nextTrimStart < MIN_CLIP_DURATION) {
              // Range collapsed the clip below the minimum — drop
              // instead of producing a zero-width artifact.
              droppedClipIds.add(clip.id);
              continue;
            }
            nextClips.push({
              ...clip,
              startOffset: nextStart,
              trimStart: nextTrimStart,
              trimEnd: nextTrimEnd,
              duration: computeTimelineDuration(
                nextTrimStart,
                nextTrimEnd,
                clip.playbackRate,
              ),
            });
          }
          return { ...track, clips: nextClips };
        });

        const nextOverlays = project.overlays.flatMap((overlay) => {
          const end = overlay.startOffset + overlay.duration;
          if (end <= lo || overlay.startOffset >= hi) return [];
          const newStart = Math.max(overlay.startOffset, lo);
          const newEnd = Math.min(end, hi);
          if (newEnd - newStart < MIN_CLIP_DURATION) return [];
          return [
            {
              ...overlay,
              startOffset: newStart,
              duration: newEnd - newStart,
            },
          ];
        });

        // Selection cleanup: drop ids that no longer exist.
        const nextSelectedClipIds = state.selectedClipIds.filter(
          (id) => !droppedClipIds.has(id),
        );

        return {
          currentProject: {
            ...project,
            tracks: nextTracks,
            overlays: nextOverlays,
          },
          selectedClipId:
            state.selectedClipId && !droppedClipIds.has(state.selectedClipId)
              ? state.selectedClipId
              : null,
          selectedClipIds: nextSelectedClipIds,
          // Trimming is a one-shot — drop the markers so the next
          // razor pass starts fresh.
          inPoint: null,
          outPoint: null,
        };
      }),

    deleteRange: () =>
      set((state) => {
        const project = state.currentProject;
        if (!project) return state;
        const { inPoint, outPoint } = state;
        if (inPoint === null || outPoint === null) return state;
        const lo = Math.min(inPoint, outPoint);
        const hi = Math.max(inPoint, outPoint);
        const shift = hi - lo;
        if (shift <= 0) return state;

        const droppedClipIds = new Set<ClipId>();
        const nextTracks = project.tracks.map((track) => {
          const nextClips: AnyClip[] = [];
          for (const clip of track.clips) {
            const clipEnd = clip.startOffset + clip.duration;
            // Fully inside the range → drop.
            if (clip.startOffset >= lo && clipEnd <= hi) {
              droppedClipIds.add(clip.id);
              continue;
            }
            // Fully outside (left of range) → keep as-is.
            if (clipEnd <= lo) {
              nextClips.push(clip);
              continue;
            }
            // Fully outside (right of range) → shift left by `shift`.
            if (clip.startOffset >= hi) {
              nextClips.push({
                ...clip,
                startOffset: Math.max(0, clip.startOffset - shift),
              });
              continue;
            }
            // Spans the range. We split into the surviving left half
            // (if any) and shifted right half (if any), then merge
            // them when possible — but a span that crosses both
            // boundaries actually has TWO surviving pieces.
            const rate = clip.playbackRate ?? 1;
            if (clip.startOffset < lo && clipEnd > hi) {
              // Both boundaries: produces a left segment and a right
              // segment with different ids.
              const leftTimelineLen = lo - clip.startOffset;
              const leftTrimEnd = clip.trimStart + leftTimelineLen * rate;
              const rightTrimStart =
                clip.trimStart + (hi - clip.startOffset) * rate;
              if (leftTrimEnd - clip.trimStart >= MIN_CLIP_DURATION) {
                nextClips.push({
                  ...clip,
                  trimEnd: leftTrimEnd,
                  duration: computeTimelineDuration(
                    clip.trimStart,
                    leftTrimEnd,
                    clip.playbackRate,
                  ),
                });
              }
              if (clip.trimEnd - rightTrimStart >= MIN_CLIP_DURATION) {
                nextClips.push({
                  ...clip,
                  id: newId(),
                  startOffset: lo,
                  trimStart: rightTrimStart,
                  duration: computeTimelineDuration(
                    rightTrimStart,
                    clip.trimEnd,
                    clip.playbackRate,
                  ),
                });
              }
              continue;
            }
            if (clip.startOffset < lo && clipEnd > lo) {
              // Spans only the left boundary — keep the left half.
              const leftTimelineLen = lo - clip.startOffset;
              const leftTrimEnd = clip.trimStart + leftTimelineLen * rate;
              if (leftTrimEnd - clip.trimStart < MIN_CLIP_DURATION) {
                droppedClipIds.add(clip.id);
                continue;
              }
              nextClips.push({
                ...clip,
                trimEnd: leftTrimEnd,
                duration: computeTimelineDuration(
                  clip.trimStart,
                  leftTrimEnd,
                  clip.playbackRate,
                ),
              });
              continue;
            }
            // Spans only the right boundary — keep the right half,
            // shifted so its left edge lands on `lo`.
            const rightTrimStart =
              clip.trimStart + (hi - clip.startOffset) * rate;
            if (clip.trimEnd - rightTrimStart < MIN_CLIP_DURATION) {
              droppedClipIds.add(clip.id);
              continue;
            }
            nextClips.push({
              ...clip,
              startOffset: lo,
              trimStart: rightTrimStart,
              duration: computeTimelineDuration(
                rightTrimStart,
                clip.trimEnd,
                clip.playbackRate,
              ),
            });
          }
          return { ...track, clips: nextClips };
        });

        const nextOverlays = project.overlays.flatMap((overlay) => {
          const end = overlay.startOffset + overlay.duration;
          if (overlay.startOffset >= lo && end <= hi) return [];
          if (end <= lo) return [overlay];
          if (overlay.startOffset >= hi) {
            return [
              {
                ...overlay,
                startOffset: Math.max(0, overlay.startOffset - shift),
              },
            ];
          }
          // Spans the boundary (overlays don't split — clip to the
          // surviving half closest to the original position).
          if (overlay.startOffset < lo && end > hi) {
            // Both sides — keep the left half, length = lo - start.
            const newDur = lo - overlay.startOffset;
            if (newDur < MIN_CLIP_DURATION) return [];
            return [{ ...overlay, duration: newDur }];
          }
          if (overlay.startOffset < lo) {
            const newDur = lo - overlay.startOffset;
            if (newDur < MIN_CLIP_DURATION) return [];
            return [{ ...overlay, duration: newDur }];
          }
          // overlay.startOffset >= lo && end > hi → right-half shift.
          const newDur = end - hi;
          if (newDur < MIN_CLIP_DURATION) return [];
          return [
            { ...overlay, startOffset: lo, duration: newDur },
          ];
        });

        const nextSelectedClipIds = state.selectedClipIds.filter(
          (id) => !droppedClipIds.has(id),
        );

        // Pull the playhead back if it sat inside the deleted range
        // (it's now floating in nothing).
        let nextPlayhead = state.playheadPosition;
        if (nextPlayhead > lo && nextPlayhead < hi) {
          nextPlayhead = lo;
        } else if (nextPlayhead >= hi) {
          nextPlayhead = Math.max(0, nextPlayhead - shift);
        }

        return {
          currentProject: {
            ...project,
            tracks: nextTracks,
            overlays: nextOverlays,
          },
          selectedClipId:
            state.selectedClipId && !droppedClipIds.has(state.selectedClipId)
              ? state.selectedClipId
              : null,
          selectedClipIds: nextSelectedClipIds,
          playheadPosition: nextPlayhead,
          inPoint: null,
          outPoint: null,
        };
      }),

    markRangeAtPlayhead: () =>
      set((state) => {
        const project = state.currentProject;
        if (!project) return state;
        const playhead = state.playheadPosition;
        // Compute the project's actual end (max of any clip or
        // overlay end) so we can pin the second mark to it when
        // the playhead sits past content.
        let projectEnd = 0;
        for (const track of project.tracks) {
          for (const clip of track.clips) {
            const e = clip.startOffset + clip.duration;
            if (e > projectEnd) projectEnd = e;
          }
        }
        for (const overlay of project.overlays) {
          const e = overlay.startOffset + overlay.duration;
          if (e > projectEnd) projectEnd = e;
        }
        const cap = projectEnd > 0 ? projectEnd : Infinity;
        const halfSpan = 1; // ~2s window
        let lo = Math.max(0, playhead - halfSpan);
        let hi = Math.min(cap, playhead + halfSpan);
        // Playhead near an edge — widen on the other side so the
        // visual range is roughly the same width regardless of
        // where the user dropped it.
        const targetSpan = halfSpan * 2;
        if (hi - lo < targetSpan) {
          if (lo === 0) hi = Math.min(cap, lo + targetSpan);
          else if (hi === cap) lo = Math.max(0, cap - targetSpan);
        }
        return { inPoint: lo, outPoint: hi };
      }),

    exportTimelineToJSON: () => {
      const project = get().currentProject;
      if (!project) return 'null';
      return JSON.stringify(serializeProject(project));
    },
  })),
);

interface ClipboardEntry {
  clip: AnyClip;
  originalTrackId: TrackId;
}

let clipboard: ClipboardEntry[] = [];

function fits(clips: AnyClip[], start: number, duration: number): boolean {
  const end = start + duration;
  for (const c of clips) {
    const cEnd = c.startOffset + c.duration;
    if (!(end <= c.startOffset || start >= cEnd)) return false;
  }
  return true;
}

/** Drop selection ids that no longer exist in `project`. */
function pruneSelection(
  state: TimelineState,
  project: VideoProject,
): Pick<TimelineState, 'selectedClipId' | 'selectedClipIds'> {
  const alive = new Set<ClipId>();
  for (const t of project.tracks) for (const c of t.clips) alive.add(c.id);
  const selectedClipIds = state.selectedClipIds.filter((id) => alive.has(id));
  return {
    selectedClipIds,
    selectedClipId:
      state.selectedClipId && alive.has(state.selectedClipId)
        ? state.selectedClipId
        : (selectedClipIds[selectedClipIds.length - 1] ?? null),
  };
}
