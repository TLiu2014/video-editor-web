/**
 * Speech-to-Text (STT) abstraction for the auto-captions feature.
 *
 * The editor extracts audio locally with FFmpeg, then hands the
 * resulting `Blob` to a `TranscriptionProvider`. Because we run
 * 100% client-side with no backend, every provider talks directly
 * to its vendor's REST API using a user-supplied ("bring your own
 * key") credential.
 *
 * The contract is intentionally tiny: the core editor only knows
 * about `transcribe(blob, key) -> srt string`. It never imports a
 * concrete vendor adapter, so swapping or adding providers never
 * touches editor code.
 */

/** Stable identifiers for the providers we ship. */
export type TranscriptionProviderId = 'openai' | 'deepgram' | 'gemini';

/**
 * Audio container/codec the extraction pipeline can emit. Providers
 * disagree on what they accept, so each provider declares the format
 * it wants:
 *   - `m4a`  — AAC in an MP4 container (`audio/mp4`). OpenAI/Deepgram.
 *   - `aac`  — raw ADTS AAC (`audio/aac`). Gemini (rejects `.m4a`).
 *   - `wav`  — uncompressed PCM. Universal fallback (large).
 * `mp3`/`ogg`/`flac` are listed for completeness but aren't emitted
 * (the wasm core has no mp3/vorbis encoder).
 */
export type AudioFormat = 'wav' | 'm4a' | 'aac' | 'mp3' | 'ogg' | 'flac';

export interface TranscriptionProvider {
  /** Stable machine id, also used as the localStorage key namespace. */
  readonly id: TranscriptionProviderId;

  /** Human-readable name shown in the settings UI. */
  readonly name: string;

  /**
   * Name of the Vite env var consulted as a developer-convenience
   * fallback when the user hasn't pasted a key into the UI, e.g.
   * `VITE_OPENAI_API_KEY`. Kept on the provider so the key-resolution
   * logic stays generic.
   */
  readonly envVar: string;

  /** Short hint rendered under the key field (where to get a key). */
  readonly keyHint?: string;

  /**
   * Compressed audio format this provider accepts. The extraction
   * pipeline encodes to this so uploads stay small.
   */
  readonly preferredAudioFormat: AudioFormat;

  /**
   * Maximum size (bytes) of a single upload this provider accepts.
   * The captions flow sends the whole extracted audio when it fits
   * under this, and only stream-copy splits it into time pieces when
   * it doesn't. Omit for providers with no practical limit (the audio
   * is sent in one request regardless of length).
   */
  readonly maxUploadBytes?: number;

  /**
   * Transcribe `audioBlob` and resolve to a valid SubRip (`.srt`)
   * subtitle string. Implementations must throw on transport or
   * auth errors with a human-readable message.
   */
  transcribe(audioBlob: Blob, apiKey: string): Promise<string>;
}
