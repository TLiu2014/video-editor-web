import { clipRate, ffmpegAtempoChain } from './clipRate';
import { ffmpegEffectFilters } from './effects';
import { isTrackAudible } from './trackAudibility';
import type {
  AudioClip,
  TextOverlay,
  TimelineTrack,
  VideoClip,
  VideoProject,
} from '../types/timeline';

/**
 * Translate a `VideoProject` into a concrete FFmpeg invocation.
 *
 * The pipeline:
 *   1. Each unique source file becomes an `-i input_N.<ext>` input.
 *   2. Per-clip filter segments apply trim → setpts → scale/pad → fps
 *      (or `atrim → asetpts → aresample → aformat → volume` for audio).
 *   3. Gaps between clips on a track are filled with `color=black` or
 *      `anullsrc` segments so concat preserves wall-clock positioning.
 *   4. Each track is concat'd into a single stream. Audio from video
 *      clips and audio from explicit audio clips are mixed via `amix`.
 *   5. Output is encoded H.264 + AAC into MP4 with faststart.
 *
 * Important: this filter graph assumes every imported video file has an
 * audio stream. Files without audio will fail to decode the `[i:a]`
 * pad; the export dialog surfaces ffmpeg stderr verbatim so users can
 * see why.
 */

const VIDEO_EXT_BY_TYPE: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
};

const AUDIO_EXT_BY_TYPE: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
};

function chooseExt(file: File): string {
  const fromType =
    VIDEO_EXT_BY_TYPE[file.type] ?? AUDIO_EXT_BY_TYPE[file.type];
  if (fromType) return fromType;
  const dotIdx = file.name.lastIndexOf('.');
  if (dotIdx >= 0) return file.name.slice(dotIdx + 1).toLowerCase();
  // Fallback: assume mp4 — FFmpeg will sniff the container regardless.
  return 'mp4';
}

export interface ExportOptions {
  /** Default 30. Capped to 30 by the UI's resolution guard rails. */
  fps?: number;
  /** Default 48000 Hz. */
  audioSampleRate?: number;
  /** libx264 CRF, lower = higher quality. Default 23. */
  crf?: number;
  /** libx264 preset. Default `ultrafast` — wasm builds are single-threaded. */
  preset?: string;
}

export interface ExportPlan {
  /** Media inputs in argv order — these get written via fetchFile. */
  inputs: { name: string; file: File }[];
  /**
   * Overlay PNG inputs in argv order, appended after media inputs.
   * The hook is responsible for rasterizing each `overlay` and
   * writing it to `name` before exec.
   */
  overlayInputs: { name: string; overlay: TextOverlay }[];
  /** The full argv passed to `ffmpeg.exec`. */
  args: string[];
  /** Virtual FS filename of the output, e.g. `output.mp4`. */
  outputFile: string;
}

interface SegmentList {
  /** Emitted filter graph statements (semicolon-separated when joined). */
  parts: string[];
  /** Output labels in order to be concatenated. */
  labels: string[];
}

const GAP_EPSILON_S = 0.001;

/**
 * Concat helper that handles n=1 cleanly: FFmpeg's `concat` filter rejects
 * `n=1`, so a single segment is re-labeled via `null` (video) or `anull`
 * (audio) instead.
 */
function concatStmt(
  labels: string[],
  outLabel: string,
  kind: 'v' | 'a',
): string {
  if (labels.length === 1) {
    const pass = kind === 'v' ? 'null' : 'anull';
    return `[${labels[0]}]${pass}[${outLabel}]`;
  }
  const refs = labels.map((l) => `[${l}]`).join('');
  return `${refs}concat=n=${labels.length}:v=${kind === 'v' ? 1 : 0}:a=${kind === 'a' ? 1 : 0}[${outLabel}]`;
}

function videoFadeSuffix(clip: VideoClip): string {
  const parts: string[] = [];
  if (clip.fadeIn > 0) {
    parts.push(`fade=t=in:st=0:d=${clip.fadeIn.toFixed(3)}`);
  }
  if (clip.fadeOut > 0) {
    const start = Math.max(0, clip.duration - clip.fadeOut);
    parts.push(`fade=t=out:st=${start.toFixed(3)}:d=${clip.fadeOut.toFixed(3)}`);
  }
  return parts.length === 0 ? '' : ',' + parts.join(',');
}

function audioFadeSuffix(
  clipDuration: number,
  fadeIn: number,
  fadeOut: number,
): string {
  const parts: string[] = [];
  if (fadeIn > 0) {
    parts.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
  }
  if (fadeOut > 0) {
    const start = Math.max(0, clipDuration - fadeOut);
    parts.push(`afade=t=out:st=${start.toFixed(3)}:d=${fadeOut.toFixed(3)}`);
  }
  return parts.length === 0 ? '' : ',' + parts.join(',');
}

function buildVideoSegments(
  clips: VideoClip[],
  clipInputIndex: Map<string, number>,
  width: number,
  height: number,
  fps: number,
): SegmentList {
  const parts: string[] = [];
  const labels: string[] = [];
  let cursor = 0;

  clips.forEach((clip, i) => {
    const gap = clip.startOffset - cursor;
    if (gap > GAP_EPSILON_S) {
      const gapLabel = `vg${i}`;
      parts.push(
        `color=black:s=${width}x${height}:r=${fps}:d=${gap.toFixed(3)}[${gapLabel}]`,
      );
      labels.push(gapLabel);
    }
    const inputIdx = clipInputIndex.get(clip.id);
    if (inputIdx === undefined) return;
    const vLabel = `v${i}`;
    const rate = clipRate(clip);
    // setpts divides the trimmed segment's presentation timestamps
    // by the playback rate, so a rate of 2 makes each source-second
    // present in 0.5 timeline-seconds (fast forward). rate < 1
    // stretches the segment (slow motion).
    const setptsExpr =
      rate === 1 ? 'PTS-STARTPTS' : `(PTS-STARTPTS)/${rate.toFixed(3)}`;
    parts.push(
      `[${inputIdx}:v]trim=start=${clip.trimStart.toFixed(3)}:end=${clip.trimEnd.toFixed(3)},` +
        `setpts=${setptsExpr},` +
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `fps=${fps},format=yuv420p` +
        (clip.effects ? ffmpegEffectFilters(clip.effects) : '') +
        videoFadeSuffix(clip) +
        `[${vLabel}]`,
    );
    labels.push(vLabel);
    cursor = clip.startOffset + clip.duration;
  });

  return { parts, labels };
}

function buildAudioSegmentsFromVideo(
  clips: VideoClip[],
  clipInputIndex: Map<string, number>,
  sampleRate: number,
): SegmentList {
  const parts: string[] = [];
  const labels: string[] = [];
  let cursor = 0;

  clips.forEach((clip, i) => {
    const gap = clip.startOffset - cursor;
    if (gap > GAP_EPSILON_S) {
      const gapLabel = `vag${i}`;
      parts.push(
        `anullsrc=channel_layout=stereo:sample_rate=${sampleRate}:duration=${gap.toFixed(3)}[${gapLabel}]`,
      );
      labels.push(gapLabel);
    }
    const inputIdx = clipInputIndex.get(clip.id);
    if (inputIdx === undefined) return;
    const aLabel = `va${i}`;
    if (!clip.hasAudio) {
      // Clip has no audio stream — substitute silence of matching
      // length so the audio timeline stays aligned with video.
      parts.push(
        `anullsrc=channel_layout=stereo:sample_rate=${sampleRate}:duration=${clip.duration.toFixed(3)}[${aLabel}]`,
      );
    } else {
      const rate = clipRate(clip);
      parts.push(
        `[${inputIdx}:a]atrim=start=${clip.trimStart.toFixed(3)}:end=${clip.trimEnd.toFixed(3)},` +
          `asetpts=PTS-STARTPTS,` +
          `aresample=${sampleRate},aformat=channel_layouts=stereo:sample_fmts=fltp` +
          ffmpegAtempoChain(rate) +
          audioFadeSuffix(clip.duration, clip.fadeIn, clip.fadeOut) +
          `[${aLabel}]`,
      );
    }
    labels.push(aLabel);
    cursor = clip.startOffset + clip.duration;
  });

  return { parts, labels };
}

function buildAudioSegmentsFromAudio(
  clips: AudioClip[],
  clipInputIndex: Map<string, number>,
  sampleRate: number,
  labelPrefix: string,
): SegmentList {
  const parts: string[] = [];
  const labels: string[] = [];
  let cursor = 0;

  clips.forEach((clip, i) => {
    const gap = clip.startOffset - cursor;
    if (gap > GAP_EPSILON_S) {
      const gapLabel = `${labelPrefix}g${i}`;
      parts.push(
        `anullsrc=channel_layout=stereo:sample_rate=${sampleRate}:duration=${gap.toFixed(3)}[${gapLabel}]`,
      );
      labels.push(gapLabel);
    }
    const inputIdx = clipInputIndex.get(clip.id);
    if (inputIdx === undefined) return;
    const aLabel = `${labelPrefix}${i}`;
    const rate = clipRate(clip);
    parts.push(
      `[${inputIdx}:a]atrim=start=${clip.trimStart.toFixed(3)}:end=${clip.trimEnd.toFixed(3)},` +
        `asetpts=PTS-STARTPTS,` +
        `aresample=${sampleRate},aformat=channel_layouts=stereo:sample_fmts=fltp,` +
        `volume=${clip.volume.toFixed(3)}` +
        ffmpegAtempoChain(rate) +
        audioFadeSuffix(clip.duration, clip.fadeIn, clip.fadeOut) +
        `[${aLabel}]`,
    );
    labels.push(aLabel);
    cursor = clip.startOffset + clip.duration;
  });

  return { parts, labels };
}

export function buildExportPlan(
  project: VideoProject,
  options: ExportOptions = {},
): ExportPlan {
  // Project-level settings win over the export call's defaults so a
  // user-configured fps/sample rate carries straight into the
  // encoder without the caller having to plumb it.
  const fps = options.fps ?? project.frameRate ?? 30;
  const sampleRate =
    options.audioSampleRate ?? project.audioSampleRate ?? 48000;
  const crf = options.crf ?? 23;
  const preset = options.preset ?? 'ultrafast';
  const { width, height } = project.resolution;

  const videoTracks = project.tracks.filter((t) => t.type === 'video');
  // All audible audio tracks contribute to the mix. Muted or
  // non-solo'd (when any track is solo'd) tracks drop out here so
  // export matches preview.
  const audioTracks = project.tracks.filter(
    (t): t is TimelineTrack =>
      t.type === 'audio' && isTrackAudible(t, project.tracks),
  );
  const baseVideoTrack = videoTracks[0];
  const overlayVideoTracks = videoTracks.slice(1);
  // Whether V1's embedded audio should land in the mix.
  const v1Audible = baseVideoTrack
    ? isTrackAudible(baseVideoTrack, project.tracks)
    : false;

  const videoClips = ((baseVideoTrack?.clips ?? []) as VideoClip[])
    .filter((c): c is VideoClip => c.kind === 'video')
    .slice()
    .sort((a, b) => a.startOffset - b.startOffset);

  const overlayClipsByTrack: VideoClip[][] = overlayVideoTracks.map((track) =>
    (track.clips as VideoClip[])
      .filter((c): c is VideoClip => c.kind === 'video')
      .slice()
      .sort((a, b) => a.startOffset - b.startOffset),
  );
  const allVideoOverlayClips = overlayClipsByTrack.flat();

  const audioClipsByTrack: AudioClip[][] = audioTracks.map((track) =>
    (track.clips as AudioClip[])
      .filter((c): c is AudioClip => c.kind === 'audio')
      .slice()
      .sort((a, b) => a.startOffset - b.startOffset),
  );
  const allAudioClips = audioClipsByTrack.flat();

  if (
    videoClips.length === 0 &&
    allVideoOverlayClips.length === 0 &&
    allAudioClips.length === 0
  ) {
    throw new Error('Project has no clips to export.');
  }
  if (videoClips.length === 0) {
    throw new Error(
      'MVP export requires at least one clip on the base video track (V1).',
    );
  }

  // Map each clip's source File to a virtual input. Two clips that
  // reference the same File still get separate inputs — FFmpeg can
  // tolerate the duplicate and the FS layer dedupes via filename.
  const inputs: { name: string; file: File }[] = [];
  const clipInputIndex = new Map<string, number>();
  const seenFiles = new Map<File, number>();

  for (const clip of [
    ...videoClips,
    ...allVideoOverlayClips,
    ...allAudioClips,
  ]) {
    let idx = seenFiles.get(clip.file);
    if (idx === undefined) {
      idx = inputs.length;
      inputs.push({ name: `input_${idx}.${chooseExt(clip.file)}`, file: clip.file });
      seenFiles.set(clip.file, idx);
    }
    clipInputIndex.set(clip.id, idx);
  }

  const video = buildVideoSegments(
    videoClips,
    clipInputIndex,
    width,
    height,
    fps,
  );
  const videoAudio = v1Audible
    ? buildAudioSegmentsFromVideo(videoClips, clipInputIndex, sampleRate)
    : { parts: [], labels: [] };
  // Build a separate concat stream per audio track. Each track's
  // own concat is added to the mix only if it produced segments.
  const audioTrackResults = audioClipsByTrack.map((clips, idx) =>
    buildAudioSegmentsFromAudio(
      clips,
      clipInputIndex,
      sampleRate,
      `at${idx}_`,
    ),
  );

  const filterParts: string[] = [
    ...video.parts,
    ...videoAudio.parts,
    ...audioTrackResults.flatMap((r) => r.parts),
  ];

  filterParts.push(concatStmt(video.labels, 'vbase', 'v'));

  // Chain V2+ video tracks as overlays on top of [vbase].
  //
  // Per clip:
  //   - Without `transform`: full-frame letterbox (matches V1).
  //   - With `transform`: PiP. Scale to (width*scale):-2 (preserve
  //     aspect, auto-compute even-rounded height) and overlay at
  //     the configured (x, y). No pad — the PiP source keeps its
  //     own aspect, and the base shows through outside it.
  //
  // PTS is shifted by startOffset so the clip's content aligns
  // with the base's wall-clock; `enable='between(t,start,end)'`
  // gates the overlay to the clip's time window so gaps stay
  // clean and base shows through.
  let videoOutLabel = 'vbase';
  let overlayCounter = 0;
  for (const [tIdx, clips] of overlayClipsByTrack.entries()) {
    for (const [cIdx, clip] of clips.entries()) {
      const inputIdx = clipInputIndex.get(clip.id);
      if (inputIdx === undefined) continue;
      const segLabel = `vt${tIdx}_${cIdx}`;
      const isPiP = clip.transform !== undefined;
      const scaleAndPad = isPiP
        ? `scale=${Math.round(width * clip.transform!.scale)}:-2`
        : `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`;
      const rate = clipRate(clip);
      // Overlay clips need their PTS aligned to wall-clock so the
      // overlay filter's `enable` window picks the right frame.
      // Rate division happens first (compress trimmed segment),
      // then we shift forward by `startOffset` to land it on the
      // base timeline at the right moment.
      const setptsExpr =
        rate === 1
          ? `PTS-STARTPTS+${clip.startOffset.toFixed(3)}/TB`
          : `(PTS-STARTPTS)/${rate.toFixed(3)}+${clip.startOffset.toFixed(3)}/TB`;
      // Rotation: applied AFTER scale so the rotated frame keeps
      // the user-specified PiP size. `ow`/`oh` auto-fit the rotated
      // bounding box; the fill color is transparent so the base
      // shows through the corners. Opacity is composited via
      // `format=rgba,colorchannelmixer=aa=<o>`, multiplying the
      // existing alpha plane so transparent corners stay transparent.
      const rotationDeg = clip.transform?.rotation;
      const rotateFilter =
        rotationDeg !== undefined && rotationDeg !== 0
          ? `,format=rgba,rotate=${(rotationDeg * Math.PI) / 180}:ow='hypot(iw,ih)':oh='hypot(iw,ih)':c=none`
          : '';
      const layerOpacity = clip.transform?.opacity;
      const opacityFilter =
        layerOpacity !== undefined && layerOpacity < 1
          ? `,format=rgba,colorchannelmixer=aa=${layerOpacity.toFixed(3)}`
          : '';
      // yuv420p is the safe pixel format for x264, but rotate/opacity
      // need an alpha plane upstream. The overlay filter
      // re-quantizes to the base layer's format on composite.
      const pixFmt = rotateFilter || opacityFilter ? '' : ',format=yuv420p';
      filterParts.push(
        `[${inputIdx}:v]trim=start=${clip.trimStart.toFixed(3)}:end=${clip.trimEnd.toFixed(3)},` +
          `setpts=${setptsExpr},` +
          `${scaleAndPad},` +
          `fps=${fps}${pixFmt}` +
          (clip.effects ? ffmpegEffectFilters(clip.effects) : '') +
          videoFadeSuffix(clip) +
          rotateFilter +
          opacityFilter +
          `[${segLabel}]`,
      );
      const nextLabel = `vlayer${overlayCounter++}`;
      const overlayX = isPiP
        ? Math.round(width * clip.transform!.x)
        : 0;
      const overlayY = isPiP
        ? Math.round(height * clip.transform!.y)
        : 0;
      filterParts.push(
        `[${videoOutLabel}][${segLabel}]overlay=x=${overlayX}:y=${overlayY}:enable='between(t,${clip.startOffset.toFixed(3)},${(clip.startOffset + clip.duration).toFixed(3)})'[${nextLabel}]`,
      );
      videoOutLabel = nextLabel;
    }
  }

  // Chain text overlays onto the layered video. Each overlay takes
  // one extra input (a PNG sized to its rendered text) and produces
  // a new labeled stream. `enable='between(t,a,b)'` composites the
  // PNG only while the overlay is active.
  const overlays = project.overlays.slice().sort(
    (a, b) => a.startOffset - b.startOffset,
  );
  const overlayInputs: { name: string; overlay: TextOverlay }[] = overlays.map(
    (overlay, i) => ({ name: `overlay_${i}.png`, overlay }),
  );

  const mediaInputCount = inputs.length;
  overlays.forEach((overlay, i) => {
    const inputIdx = mediaInputCount + i;
    const nextLabel = i === overlays.length - 1 ? 'outv' : `vov${i}`;
    const startSec = overlay.startOffset.toFixed(3);
    const endSec = (overlay.startOffset + overlay.duration).toFixed(3);
    filterParts.push(
      `[${videoOutLabel}][${inputIdx}:v]overlay=` +
        `x=${(overlay.style.position.x * width).toFixed(0)}:` +
        `y=${(overlay.style.position.y * height).toFixed(0)}:` +
        `enable='between(t,${startSec},${endSec})'[${nextLabel}]`,
    );
    videoOutLabel = nextLabel;
  });

  if (videoOutLabel !== 'outv') {
    // No text overlays produced an [outv] — re-label whatever we
    // ended on so the -map at the end has a stable target.
    filterParts.push(`[${videoOutLabel}]null[outv]`);
    videoOutLabel = 'outv';
  }

  // Build a list of pre-concat'd audio stream labels: one for the
  // video clips' embedded audio, plus one per audio track. Then
  // amix them with `normalize=0` so we don't accidentally divide
  // every stream's amplitude by the input count.
  const audioMixSources: string[] = [];
  if (videoAudio.labels.length > 0) {
    filterParts.push(concatStmt(videoAudio.labels, 'mix_v', 'a'));
    audioMixSources.push('mix_v');
  }
  audioTrackResults.forEach((result, idx) => {
    if (result.labels.length === 0) return;
    const label = `mix_a${idx}`;
    filterParts.push(concatStmt(result.labels, label, 'a'));
    audioMixSources.push(label);
  });

  let audioOutLabel: string | null = null;
  if (audioMixSources.length === 1) {
    filterParts.push(`[${audioMixSources[0]}]anull[outa]`);
    audioOutLabel = 'outa';
  } else if (audioMixSources.length > 1) {
    const refs = audioMixSources.map((l) => `[${l}]`).join('');
    filterParts.push(
      `${refs}amix=inputs=${audioMixSources.length}:duration=longest:dropout_transition=0:normalize=0,aresample=${sampleRate}[outa]`,
    );
    audioOutLabel = 'outa';
  }

  const filterComplex = filterParts.join(';');

  const args: string[] = [];
  for (const input of inputs) {
    args.push('-i', input.name);
  }
  for (const ov of overlayInputs) {
    args.push('-i', ov.name);
  }
  args.push('-filter_complex', filterComplex);
  args.push('-map', '[outv]');
  if (audioOutLabel) args.push('-map', `[${audioOutLabel}]`);

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p',
  );

  if (audioOutLabel) {
    args.push('-c:a', 'aac', '-b:a', '192k');
  } else {
    args.push('-an');
  }

  const outputFile = 'output.mp4';
  args.push('-movflags', '+faststart', '-y', outputFile);

  return { inputs, overlayInputs, args, outputFile };
}
