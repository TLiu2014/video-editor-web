import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TranscriptionProviderId } from '../types/stt';
import { getProvider, transcriptionProviderList } from '../lib/stt-adapters';

export const SETTINGS_STORAGE_KEY = 'video-editor-web/settings';

type ApiKeyMap = Record<TranscriptionProviderId, string>;

const EMPTY_KEYS: ApiKeyMap = {
  openai: '',
  deepgram: '',
  gemini: '',
};

interface SettingsState {
  /** Which STT provider auto-captions will use. */
  selectedProviderId: TranscriptionProviderId;
  /**
   * User-pasted keys, persisted to localStorage. These take priority
   * over the Vite env fallbacks. NEVER sent anywhere except the
   * provider's own API at request time.
   */
  apiKeys: ApiKeyMap;
}

interface SettingsActions {
  setSelectedProvider: (id: TranscriptionProviderId) => void;
  setApiKey: (id: TranscriptionProviderId, key: string) => void;
  clearApiKey: (id: TranscriptionProviderId) => void;
}

export type SettingsStore = SettingsState & SettingsActions;

/**
 * BYOK settings for the auto-captions feature. Persisted to
 * localStorage so keys survive reloads — there is no server to store
 * them on, by design.
 */
export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      selectedProviderId: 'openai',
      apiKeys: { ...EMPTY_KEYS },

      setSelectedProvider: (id) => set({ selectedProviderId: id }),

      setApiKey: (id, key) =>
        set((s) => ({ apiKeys: { ...s.apiKeys, [id]: key } })),

      clearApiKey: (id) =>
        set((s) => ({ apiKeys: { ...s.apiKeys, [id]: '' } })),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      // Persist only the data, never derived/runtime values.
      partialize: (s) => ({
        selectedProviderId: s.selectedProviderId,
        apiKeys: s.apiKeys,
      }),
      // Merge persisted keys onto the full key map so adding a new
      // provider later doesn't leave its slot `undefined`.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          ...p,
          apiKeys: { ...EMPTY_KEYS, ...(p.apiKeys ?? {}) },
        };
      },
    },
  ),
);

/**
 * Read the effective API key for a provider.
 *
 * Resolution order:
 *   1. The key the user pasted into the UI (persisted in the store).
 *   2. The matching `VITE_*` env var — a developer-convenience
 *      fallback so local dev doesn't require re-pasting keys.
 *
 * Returns an empty string when neither is set.
 */
export function resolveApiKey(id: TranscriptionProviderId): string {
  const stored = useSettingsStore.getState().apiKeys[id]?.trim();
  if (stored) return stored;

  const envVar = getProvider(id).envVar;
  const fromEnv = import.meta.env[envVar as keyof ImportMetaEnv];
  return typeof fromEnv === 'string' ? fromEnv.trim() : '';
}

/** True when a key is available (UI or env) for the given provider. */
export function hasApiKey(id: TranscriptionProviderId): boolean {
  return resolveApiKey(id).length > 0;
}

/**
 * True when the only available key for `id` comes from the env
 * fallback (i.e. nothing pasted in the UI). Lets the settings UI
 * surface "using a dev key from .env" without revealing the value.
 */
export function isUsingEnvFallback(id: TranscriptionProviderId): boolean {
  const stored = useSettingsStore.getState().apiKeys[id]?.trim();
  if (stored) return false;
  const envVar = getProvider(id).envVar;
  const fromEnv = import.meta.env[envVar as keyof ImportMetaEnv];
  return typeof fromEnv === 'string' && fromEnv.trim().length > 0;
}

/**
 * Convenience orchestration for the core editor: hand it the locally
 * extracted audio `Blob` and get back an `.srt` string from whichever
 * provider is currently selected, using the resolved key.
 *
 * This keeps the editor's call site to a single line and fully
 * decoupled from concrete vendor adapters.
 */
export async function transcribeWithActiveProvider(
  audioBlob: Blob,
): Promise<string> {
  const id = useSettingsStore.getState().selectedProviderId;
  const provider = getProvider(id);
  const apiKey = resolveApiKey(id);

  if (!apiKey) {
    throw new Error(
      `No API key configured for ${provider.name}. Add one in Settings.`,
    );
  }

  return provider.transcribe(audioBlob, apiKey);
}

export { transcriptionProviderList };
