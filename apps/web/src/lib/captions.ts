import type { AudioFormat } from '../types/stt';
import type { TextOverlay, VideoProject } from '../types/timeline';
import { newId } from './ids';
import { parseSrt, type SrtCue } from './stt-adapters/utils';

/** Map parsed cues to lower-third caption overlays for `project`. */
export function cuesToCaptionOverlays(
  cues: SrtCue[],
  project: VideoProject,
): TextOverlay[] {
  const { height } = project.resolution;
  // ~4.5% of frame height, clamped to a sane pixel range.
  const size = Math.round(Math.min(Math.max(height * 0.045, 24), 96));

  return cues.map((cue) => ({
    id: newId(),
    text: cue.text.replace(/\s*\n\s*/g, ' ').trim(),
    startOffset: cue.start,
    duration: Math.max(0.2, cue.end - cue.start),
    style: {
      position: { x: 0.1, y: 0.82 },
      color: '#ffffff',
      size,
    },
  }));
}

/** Single-shot helper: parse a full `.srt` into caption overlays. */
export function srtToCaptionOverlays(
  srt: string,
  project: VideoProject,
): TextOverlay[] {
  return cuesToCaptionOverlays(parseSrt(srt), project);
}

export interface CaptionProgress {
  /** What's happening right now. */
  phase: 'extracting' | 'transcribing';
  /** 0-based index of the audio piece being transcribed. */
  pieceIndex: number;
  /** Total number of pieces (1 unless the audio had to be split). */
  totalPieces: number;
}

export interface GenerateCaptionsOptions {
  project: VideoProject;
  /** Full timeline duration in seconds. */
  durationSeconds: number;
  /** Audio format to request (provider-specific). */
  format: AudioFormat;
  /**
   * Max bytes the provider accepts per upload. When the extracted
   * audio exceeds this, it's split into this-many-bytes-ish pieces;
   * omit for providers with no practical limit (sent in one request).
   */
  maxUploadBytes?: number;
  /** Decode the whole timeline once into a single compressed Blob. */
  extractFull: (format: AudioFormat) => Promise<Blob>;
  /**
   * Cheaply slice `[start, end)` (seconds) out of an already-extracted
   * Blob via stream copy (no re-decode).
   */
  sliceAudio: (
    audio: Blob,
    window: { start: number; end: number },
    format: AudioFormat,
  ) => Promise<Blob>;
  /** Send an audio Blob to the active provider; resolves to an `.srt`. */
  transcribe: (audio: Blob) => Promise<string>;
  onProgress?: (progress: CaptionProgress) => void;
}

/**
 * Generate caption overlays for the timeline.
 *
 * Decodes the audio exactly once into a single compressed file, then:
 *   - sends it whole when it fits under the provider's upload limit
 *     (the common case), or
 *   - stream-copy splits it into provider-sized time pieces (cheap, no
 *     re-decode) and transcribes each, offsetting cue times back onto
 *     the global timeline.
 *
 * This keeps memory bounded (compressed audio is tiny) and avoids the
 * repeated source decoding a per-chunk re-extraction would incur.
 */
export async function generateCaptionOverlays(
  opts: GenerateCaptionsOptions,
): Promise<TextOverlay[]> {
  const {
    project,
    durationSeconds,
    format,
    maxUploadBytes,
    extractFull,
    sliceAudio,
    transcribe,
    onProgress,
  } = opts;

  // 1. Decode once.
  onProgress?.({ phase: 'extracting', pieceIndex: 0, totalPieces: 1 });
  const fullAudio = await extractFull(format);

  // 2. Decide whether the single upload fits.
  const mustSplit =
    maxUploadBytes !== undefined &&
    fullAudio.size > maxUploadBytes &&
    durationSeconds > 0;
  const totalPieces = mustSplit
    ? Math.max(2, Math.ceil(fullAudio.size / maxUploadBytes))
    : 1;

  const allCues: SrtCue[] = [];

  if (!mustSplit) {
    onProgress?.({ phase: 'transcribing', pieceIndex: 0, totalPieces: 1 });
    for (const cue of parseSrt(await transcribe(fullAudio))) {
      allCues.push(cue);
    }
  } else {
    // 3. Split the small compressed file by time and transcribe each.
    const pieceSeconds = durationSeconds / totalPieces;
    for (let i = 0; i < totalPieces; i += 1) {
      const start = i * pieceSeconds;
      const end = Math.min((i + 1) * pieceSeconds, durationSeconds);

      onProgress?.({ phase: 'transcribing', pieceIndex: i, totalPieces });
      const piece = await sliceAudio(fullAudio, { start, end }, format);
      const srt = await transcribe(piece);

      for (const cue of parseSrt(srt)) {
        allCues.push({
          start: cue.start + start,
          end: cue.end + start,
          text: cue.text,
        });
      }
    }
  }

  allCues.sort((a, b) => a.start - b.start);
  return cuesToCaptionOverlays(allCues, project);
}
