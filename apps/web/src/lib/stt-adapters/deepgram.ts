import type { TranscriptionProvider } from '../../types/stt';
import { cuesToSrt, ensureOk, type SrtCue } from './utils';

// `smart_format` gives us punctuation + capitalization, which we lean
// on to break the flat word stream into readable subtitle cues.
const ENDPOINT =
  'https://api.deepgram.com/v1/listen?smart_format=true&punctuate=true';

/** Subset of Deepgram's response we actually consume. */
interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  /** Present when smart_format/punctuate is on; preferred for display. */
  punctuated_word?: string;
}

interface DeepgramResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        words?: DeepgramWord[];
      }>;
    }>;
  };
}

// Cue-splitting heuristics — Deepgram returns one flat word list, so
// we group words into cues at sentence boundaries, capping length so
// no single subtitle lingers too long or runs off-screen.
const MAX_CUE_SECONDS = 6;
const MAX_CUE_WORDS = 14;

function wordsToCues(words: DeepgramWord[]): SrtCue[] {
  const cues: SrtCue[] = [];
  let current: { start: number; end: number; tokens: string[] } | null = null;

  for (const w of words) {
    const token = (w.punctuated_word ?? w.word).trim();
    if (!token) continue;

    if (!current) {
      current = { start: w.start, end: w.end, tokens: [token] };
    } else {
      current.tokens.push(token);
      current.end = w.end;
    }

    const endsSentence = /[.!?]$/.test(token);
    const tooLong = current.end - current.start >= MAX_CUE_SECONDS;
    const tooMany = current.tokens.length >= MAX_CUE_WORDS;

    if (endsSentence || tooLong || tooMany) {
      cues.push({
        start: current.start,
        end: current.end,
        text: current.tokens.join(' '),
      });
      current = null;
    }
  }

  if (current) {
    cues.push({
      start: current.start,
      end: current.end,
      text: current.tokens.join(' '),
    });
  }

  return cues;
}

/**
 * Deepgram adapter.
 *
 * Unlike OpenAI, Deepgram wants the raw audio bytes as the request
 * body (Content-Type describing the media), and returns JSON. We map
 * its word-level timings into a standard `.srt` string here so the
 * editor still receives the same contract as every other provider.
 *
 * Docs: https://developers.deepgram.com/reference/listen-remote
 */
export const deepgramProvider: TranscriptionProvider = {
  id: 'deepgram',
  name: 'Deepgram Nova',
  envVar: 'VITE_DEEPGRAM_API_KEY',
  keyHint: 'Create a key in the Deepgram console → API Keys.',
  // Deepgram decodes m4a/AAC fine.
  preferredAudioFormat: 'm4a',
  // Deepgram's prerecorded endpoint accepts very large files, so we
  // never need to split client-side — `maxUploadBytes` is omitted.

  async transcribe(audioBlob: Blob, apiKey: string): Promise<string> {
    if (!apiKey) throw new Error('Deepgram API key is missing.');

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        // Tell Deepgram what it's decoding; fall back to a common type.
        'Content-Type': audioBlob.type || 'audio/mpeg',
      },
      body: audioBlob,
    });

    await ensureOk(res, 'Deepgram');

    const json = (await res.json()) as DeepgramResponse;
    const alternative =
      json.results?.channels?.[0]?.alternatives?.[0] ?? undefined;
    const words = alternative?.words ?? [];

    if (words.length > 0) {
      return cuesToSrt(wordsToCues(words));
    }

    // No word-level timings (e.g. silent/empty audio). Degrade
    // gracefully to a single cue if there's any transcript at all.
    const transcript = alternative?.transcript?.trim();
    if (transcript) {
      return cuesToSrt([{ start: 0, end: 5, text: transcript }]);
    }

    return '';
  },
};
