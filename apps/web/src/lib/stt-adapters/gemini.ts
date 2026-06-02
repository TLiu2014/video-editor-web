import type { TranscriptionProvider } from '../../types/stt';
import { blobToBase64, ensureOk, stripCodeFences } from './utils';

const MODEL = 'gemini-1.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const PROMPT =
  'Transcribe this audio exactly and return ONLY a valid SRT format ' +
  'string. Do not add commentary, explanations, or Markdown code ' +
  'fences — output the raw SRT only.';

/**
 * Map a blob MIME type to one of Gemini's documented audio types.
 * Gemini lists `audio/mp3` (not `audio/mpeg`) and doesn't accept the
 * `audio/mp4` (.m4a) container, so normalize to the closest match
 * and default to wav, which the extraction pipeline emits.
 */
function geminiMimeType(blobType: string): string {
  const supported = new Set([
    'audio/wav',
    'audio/mp3',
    'audio/aiff',
    'audio/aac',
    'audio/ogg',
    'audio/flac',
  ]);
  if (blobType === 'audio/mpeg') return 'audio/mp3';
  if (blobType === 'audio/x-wav' || blobType === 'audio/wave') return 'audio/wav';
  return supported.has(blobType) ? blobType : 'audio/wav';
}

/** Subset of the Gemini generateContent response we read. */
interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

/**
 * Google Gemini adapter.
 *
 * Gemini is a general multimodal model rather than a dedicated STT
 * service, so we embed the audio as base64 `inlineData` in a JSON
 * body and prompt it to emit SRT directly. The API key goes in the
 * query string (`?key=`) per Google's REST convention. We strip any
 * stray code fences the model wraps the output in.
 *
 * Docs: https://ai.google.dev/api/generate-content
 */
export const geminiProvider: TranscriptionProvider = {
  id: 'gemini',
  name: 'Google Gemini',
  envVar: 'VITE_GEMINI_API_KEY',
  keyHint: 'Create a key at aistudio.google.com → API keys.',
  // Gemini lists `audio/aac` but not the `.m4a` (audio/mp4)
  // container, so emit raw ADTS AAC.
  preferredAudioFormat: 'aac',
  // Inline-data requests must stay under ~20 MB total. Base64
  // inflates payloads ~4/3, so cap raw audio at 14 MB to leave room.
  maxUploadBytes: 14 * 1024 * 1024,

  async transcribe(audioBlob: Blob, apiKey: string): Promise<string> {
    if (!apiKey) throw new Error('Gemini API key is missing.');

    const base64Audio = await blobToBase64(audioBlob);

    const body = {
      contents: [
        {
          parts: [
            { text: PROMPT },
            {
              inlineData: {
                mimeType: geminiMimeType(audioBlob.type),
                data: base64Audio,
              },
            },
          ],
        },
      ],
    };

    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    await ensureOk(res, 'Gemini');

    const json = (await res.json()) as GeminiResponse;
    const text = json.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim();

    if (!text) {
      throw new Error('Gemini returned an empty transcription.');
    }

    return stripCodeFences(text);
  },
};
