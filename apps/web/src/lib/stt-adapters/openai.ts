import type { TranscriptionProvider } from '../../types/stt';
import { audioExtensionForMime, ensureOk } from './utils';

const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

/**
 * OpenAI Whisper adapter.
 *
 * Whisper's transcription endpoint accepts `multipart/form-data` and
 * can emit SubRip directly via `response_format=srt`, so there's no
 * client-side JSON-to-SRT conversion to do — we return the body text
 * verbatim.
 *
 * Docs: https://platform.openai.com/docs/api-reference/audio/createTranscription
 */
export const openAiProvider: TranscriptionProvider = {
  id: 'openai',
  name: 'OpenAI Whisper',
  envVar: 'VITE_OPENAI_API_KEY',
  keyHint: 'Create a key at platform.openai.com → API keys (starts with "sk-").',
  // Whisper accepts m4a; AAC-in-MP4 keeps the upload tiny.
  preferredAudioFormat: 'm4a',
  // Whisper's hard per-file limit is 25 MB; stay a hair under.
  maxUploadBytes: 24 * 1024 * 1024,

  async transcribe(audioBlob: Blob, apiKey: string): Promise<string> {
    if (!apiKey) throw new Error('OpenAI API key is missing.');

    const form = new FormData();
    // Whisper infers the format from the filename extension, so name
    // the upload to match the blob's actual MIME type.
    const ext = audioExtensionForMime(audioBlob.type);
    form.append('file', audioBlob, `audio.${ext}`);
    form.append('model', 'whisper-1');
    form.append('response_format', 'srt');

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        // Do NOT set Content-Type — the browser must add the
        // multipart boundary itself.
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    await ensureOk(res, 'OpenAI Whisper');
    return (await res.text()).trim();
  },
};
