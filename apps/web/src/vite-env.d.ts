/// <reference types="vite/client" />

/**
 * Strongly-typed Vite environment variables. These are the optional
 * developer-convenience fallbacks for the BYOK STT providers — when
 * present in `.env.local`, the app uses them so the developer doesn't
 * have to paste keys into the UI on every reload.
 *
 * NOTE: anything prefixed with `VITE_` is inlined into the client
 * bundle at build time, so only use these for local development —
 * never ship a production build with real keys baked in.
 */
interface ImportMetaEnv {
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_DEEPGRAM_API_KEY?: string;
  readonly VITE_GEMINI_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
