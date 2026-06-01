import { createContext, useContext, type ReactNode } from 'react';
import { useFFmpeg, type UseFFmpegResult } from '../hooks/useFFmpeg';
import {
  useProjectPersistence,
  type UseProjectPersistenceResult,
} from '../hooks/useProjectPersistence';

/**
 * The FFmpeg hook owns a WebAssembly instance and the persistence hook
 * owns a debounced auto-save timer. Both are expensive to duplicate, so
 * we mount them once at the root and fan out via context instead of
 * letting individual components re-call the hooks.
 */
interface SystemContextValue {
  ffmpeg: UseFFmpegResult;
  persistence: UseProjectPersistenceResult;
}

const SystemContext = createContext<SystemContextValue | null>(null);

export function AppProviders({ children }: { children: ReactNode }) {
  const ffmpeg = useFFmpeg();
  const persistence = useProjectPersistence();
  return (
    <SystemContext.Provider value={{ ffmpeg, persistence }}>
      {children}
    </SystemContext.Provider>
  );
}

function useSystem(): SystemContextValue {
  const ctx = useContext(SystemContext);
  if (!ctx) {
    throw new Error('useSystem must be used inside <AppProviders>');
  }
  return ctx;
}

export function useFFmpegContext(): UseFFmpegResult {
  return useSystem().ffmpeg;
}

export function usePersistenceContext(): UseProjectPersistenceResult {
  return useSystem().persistence;
}
