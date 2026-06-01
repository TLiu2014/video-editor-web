/**
 * Core timeline domain types for the browser-based NLE.
 *
 * All time-based values (startOffset, trimStart, trimEnd, duration) are
 * expressed in **seconds** as floating-point numbers. This matches FFmpeg's
 * native time format and avoids integer-overflow concerns for long projects.
 *
 * `File` references are kept in-memory only — they cannot be serialized to
 * JSON. The auto-save layer is responsible for persisting raw bytes to
 * IndexedDB separately and rehydrating them by id on project load.
 */

export type ClipId = string;
export type TrackId = string;
export type OverlayId = string;
export type ProjectId = string;

export type TrackKind = 'video' | 'audio';

export interface BaseClip {
  id: ClipId;
  name: string;
  /** In-memory handle to the source media. Not serialized. */
  file: File;
  /** Position on the global timeline where this clip begins playing (seconds). */
  startOffset: number;
  /** Offset from the start of the source file at which playback begins (seconds). */
  trimStart: number;
  /** Offset from the start of the source file at which playback ends (seconds). */
  trimEnd: number;
  /** Effective playback duration, i.e. `trimEnd - trimStart` (seconds). */
  duration: number;
  /**
   * The source file's intrinsic length, in seconds. Captured once at
   * import time and never changes. The trim-right handle clamps to
   * this so users can extend a clip back out toward the original
   * media's end after trimming it shorter.
   */
  sourceDuration: number;
  /**
   * Fade-in / fade-out durations applied at the clip's edges. Used
   * by the preview opacity (video) and the audio engine gain ramp,
   * and burned into export via `fade` / `afade` filters. Default 0.
   * Clamped so `fadeIn + fadeOut <= duration`.
   */
  fadeIn: number;
  fadeOut: number;
  /**
   * Optional hex color (`#RRGGBB`) overriding the default clip
   * background. Undefined means "use kind-specific default" from
   * the theme tokens.
   */
  color?: string;
  /**
   * Shared identifier for clips that move together. Set/cleared via
   * `groupClips` / `ungroupClips`. Members can live on different
   * tracks; the move propagation respects per-track neighbor clamps.
   */
  groupId?: string;
  /**
   * Playback rate multiplier. > 1 = fast, < 1 = slow motion.
   * Default 1 (treat undefined as 1 on read). Effective timeline
   * duration is `(trimEnd - trimStart) / playbackRate`.
   */
  playbackRate?: number;
  trackId: TrackId;
}

export interface VideoClipEffects {
  /** CSS `brightness()` factor — 1 = no change, range ~[0.5, 1.5]. */
  brightness?: number;
  /** CSS `contrast()` factor — 1 = no change, range ~[0.5, 1.5]. */
  contrast?: number;
  /** CSS `saturate()` factor — 1 = no change, range [0, 2]. */
  saturation?: number;
  /** CSS `blur(px)` radius — 0 = none, range [0, 20]. */
  blur?: number;
}

export interface VideoClipTransform {
  /** Top-left X in 0–1 fractions of the project frame. */
  x: number;
  /** Top-left Y in 0–1 fractions of the project frame. */
  y: number;
  /** Width as a 0–1 fraction of the project frame. Aspect is preserved. */
  scale: number;
  /**
   * Clockwise rotation in degrees, around the PiP layer's center.
   * Optional — undefined and 0 are equivalent. Range [-360, 360];
   * values outside collapse modulo 360 in the renderer.
   */
  rotation?: number;
  /**
   * Layer opacity in [0, 1]. Multiplies with `fadeEnvelope`, so a
   * 0.5 opacity layer with no fade still composites at 50%, and a
   * mid-fade-in tick at the same layer composites lower. Optional —
   * undefined means fully opaque.
   */
  opacity?: number;
}

export interface VideoClip extends BaseClip {
  kind: 'video';
  /**
   * Best-effort probe at import time. When false, the export pipeline
   * substitutes silence for this clip's audio span instead of
   * referencing `[i:a]`, which would fail to decode for files with no
   * audio stream (e.g., screen recordings).
   */
  hasAudio: boolean;
  /** Optional color effects burned in at export and previewed via CSS. */
  effects?: VideoClipEffects;
  /**
   * Picture-in-picture transform. Only honored for overlay (V2+)
   * tracks — V1 always fills the frame with letterboxing. Undefined
   * means "full frame."
   */
  transform?: VideoClipTransform;
}

export interface AudioClip extends BaseClip {
  kind: 'audio';
  /** Linear gain, 0.0 (muted) – 1.0 (unity). Higher values risk clipping. */
  volume: number;
}

export type AnyClip = VideoClip | AudioClip;

export interface TextOverlayStyle {
  /** Normalized 0–1 coordinates, anchored top-left of the canvas. */
  position: { x: number; y: number };
  /** Any valid CSS color string (`#RRGGBB`, `rgba(...)`, etc.). */
  color: string;
  /** Font size in pixels at the project's native resolution. */
  size: number;
}

export interface TextOverlay {
  id: OverlayId;
  text: string;
  startOffset: number;
  duration: number;
  style: TextOverlayStyle;
}

export interface TimelineTrack {
  id: TrackId;
  type: TrackKind;
  clips: AnyClip[];
  /** When true, the track's audio contribution is silenced (preview + export). Video remains visible for video tracks. */
  muted?: boolean;
  /**
   * Solo flag. When ANY track in the project has `solo: true`, only
   * solo'd tracks contribute audio to the mix. Use to audition
   * specific layers without toggling mutes elsewhere.
   */
  solo?: boolean;
}

export interface ProjectResolution {
  width: number;
  height: number;
}

export interface VideoProject {
  id: ProjectId;
  name: string;
  resolution: ProjectResolution;
  /** Output frame rate (fps). Capped to 30 by the UI's resolution guard rails. */
  frameRate: number;
  /** Output audio sample rate (Hz). Standard values: 44100 or 48000. */
  audioSampleRate: number;
  tracks: TimelineTrack[];
  overlays: TextOverlay[];
}

/**
 * JSON-safe view of a project. `File` handles are stripped and replaced with
 * a lightweight descriptor that the persistence layer can resolve back to raw
 * bytes stored in IndexedDB.
 */
export interface SerializedClip extends Omit<BaseClip, 'file'> {
  fileRef: { name: string; size: number; type: string };
}

export interface SerializedTrack extends Omit<TimelineTrack, 'clips'> {
  clips: SerializedClip[];
}

export interface SerializedProject extends Omit<VideoProject, 'tracks'> {
  tracks: SerializedTrack[];
}
