import type {
  TranscriptionProvider,
  TranscriptionProviderId,
} from '../../types/stt';
import { deepgramProvider } from './deepgram';
import { geminiProvider } from './gemini';
import { openAiProvider } from './openai';

/**
 * Registry of all available STT providers. This is the single place
 * the rest of the app touches — the editor and settings UI iterate
 * `transcriptionProviderList` and look providers up by id; they never
 * import a concrete adapter directly. Adding a new provider is a
 * one-line change here.
 */

/** Display order in the settings UI. */
export const transcriptionProviderList: readonly TranscriptionProvider[] = [
  openAiProvider,
  deepgramProvider,
  geminiProvider,
];

/** Lookup by id, derived from the ordered list. */
export const transcriptionProviders = Object.fromEntries(
  transcriptionProviderList.map((p) => [p.id, p]),
) as Record<TranscriptionProviderId, TranscriptionProvider>;

export function getProvider(
  id: TranscriptionProviderId,
): TranscriptionProvider {
  const provider = transcriptionProviders[id];
  if (!provider) {
    throw new Error(`Unknown transcription provider: ${id}`);
  }
  return provider;
}

export { openAiProvider, deepgramProvider, geminiProvider };
