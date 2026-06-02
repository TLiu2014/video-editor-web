/**
 * Shared helpers for the STT adapters. Kept vendor-agnostic so each
 * adapter file only contains the bits that are actually specific to
 * its API (endpoint, auth header shape, response parsing).
 */

/** Format seconds as a SubRip timestamp: `HH:MM:SS,mmm`. */
export function formatSrtTimestamp(totalSeconds: number): string {
  const ms = Math.max(0, Math.round(totalSeconds * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

/** A single subtitle cue prior to serialization. */
export interface SrtCue {
  start: number;
  end: number;
  text: string;
}

/** Serialize cues to a complete `.srt` document (1-indexed entries). */
export function cuesToSrt(cues: SrtCue[]): string {
  return cues
    .map((cue, i) => {
      const index = i + 1;
      const time = `${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}`;
      return `${index}\n${time}\n${cue.text.trim()}\n`;
    })
    .join('\n')
    .trim();
}

/** Parse a SubRip timestamp (`HH:MM:SS,mmm` or `.mmm`) to seconds. */
function srtTimestampToSeconds(stamp: string): number {
  const normalized = stamp.trim().replace(',', '.');
  const [clock = '0:0:0', fraction = '0'] = normalized.split('.');
  const segments = clock.split(':').map(Number);
  // Support both HH:MM:SS and MM:SS just in case.
  const [h, m, s] =
    segments.length === 3
      ? segments
      : [0, segments[0] ?? 0, segments[1] ?? 0];
  const ms = Number(`0.${fraction}`) || 0;
  return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0) + ms;
}

/**
 * Parse a `.srt` document into cues. Tolerant of CRLF line endings,
 * missing index lines, and blank padding between blocks — robust
 * enough for the slightly-varied output of different STT vendors.
 */
export function parseSrt(srt: string): SrtCue[] {
  const cues: SrtCue[] = [];
  const blocks = srt
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.split('\n');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx === -1) continue;

    const match = lines[timeIdx]?.match(
      /(\d{1,2}:\d{1,2}:\d{1,2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{1,2}:\d{1,2}[.,]\d{1,3})/,
    );
    if (!match || !match[1] || !match[2]) continue;

    const text = lines
      .slice(timeIdx + 1)
      .join('\n')
      .trim();
    if (!text) continue;

    cues.push({
      start: srtTimestampToSeconds(match[1]),
      end: srtTimestampToSeconds(match[2]),
      text,
    });
  }

  return cues;
}

/**
 * Best-guess file extension for an audio Blob's MIME type. Used to
 * name the multipart upload so vendors that sniff by extension
 * (notably OpenAI Whisper) accept the file.
 */
export function audioExtensionForMime(mime: string): string {
  const map: Record<string, string> = {
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
    'audio/webm': 'webm',
  };
  return map[mime] ?? 'wav';
}

/**
 * Read a `Blob` as a base64 string (no `data:` URI prefix). Used by
 * providers that want the audio embedded inline in a JSON body.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error('Failed to read audio blob'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unexpected FileReader result'));
        return;
      }
      // result looks like `data:<mime>;base64,<payload>` — keep payload only.
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Throw a readable error for a non-2xx response. Includes a short
 * slice of the response body so auth/quota problems are debuggable
 * from the surfaced message.
 */
export async function ensureOk(
  res: Response,
  providerName: string,
): Promise<void> {
  if (res.ok) return;
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {
    /* body already consumed or unreadable — ignore */
  }
  throw new Error(
    `${providerName} request failed (${res.status} ${res.statusText})` +
      (detail ? `: ${detail}` : ''),
  );
}

/**
 * Strip Markdown code fences that chat-style models (Gemini) often
 * wrap structured output in, e.g. ```srt ... ``` — leaving just the
 * raw SRT text.
 */
export function stripCodeFences(text: string): string {
  return text
    .replace(/^\s*```(?:srt|text|plaintext)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}
