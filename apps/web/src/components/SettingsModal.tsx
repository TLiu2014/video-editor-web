import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import {
  CheckIcon,
  ChevronDownIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  SettingsIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  isUsingEnvFallback,
  transcriptionProviderList,
  useSettingsStore,
} from '../store/useSettingsStore';
import type { TranscriptionProviderId } from '../types/stt';
import { Dialog, DialogContent, DialogTrigger } from './ui/Dialog';
import * as Menu from './ui/DropdownMenu';

/**
 * Top-right settings entry point for the BYOK auto-captions feature.
 *
 * Self-contained: it renders its own gear trigger and a Radix Dialog,
 * so it can be dropped straight into the header without wiring up
 * external open/close state.
 */
export function SettingsModal() {
  const selectedProviderId = useSettingsStore((s) => s.selectedProviderId);
  const setSelectedProvider = useSettingsStore((s) => s.setSelectedProvider);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const setApiKey = useSettingsStore((s) => s.setApiKey);

  const [revealed, setRevealed] = useState(false);

  const activeProvider =
    transcriptionProviderList.find((p) => p.id === selectedProviderId) ??
    transcriptionProviderList[0];
  // The registry is a non-empty constant, so this never triggers at
  // runtime — it's here to satisfy `noUncheckedIndexedAccess`.
  if (!activeProvider) return null;

  const currentKey = apiKeys[selectedProviderId] ?? '';
  const usingEnv = isUsingEnvFallback(selectedProviderId);

  const handleSelectProvider = (id: TranscriptionProviderId) => {
    setSelectedProvider(id);
    setRevealed(false); // re-mask when the active provider changes
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          title="Settings"
          aria-label="Settings"
          className="inline-flex size-8 items-center justify-center rounded-md text-text-secondary transition hover:bg-chrome hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <SettingsIcon className="size-4" />
        </button>
      </DialogTrigger>

      <DialogContent
        title="Settings"
        description="Auto-captions speech-to-text provider"
      >
        <div className="flex flex-col gap-5">
          {/* Provider selector --------------------------------- */}
          <Field hint="Audio is extracted locally, then sent to this provider for transcription.">
            <FieldLabel>AI provider</FieldLabel>
            <DropdownPrimitive.Root>
              <DropdownPrimitive.Trigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-chrome px-3 text-[13px] text-text-primary transition hover:border-border-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 data-[state=open]:border-accent"
                >
                  <span>{activeProvider.name}</span>
                  <ChevronDownIcon className="size-4 opacity-60" />
                </button>
              </DropdownPrimitive.Trigger>
              <Menu.Content className="min-w-[var(--radix-dropdown-menu-trigger-width)]">
                {transcriptionProviderList.map((provider) => (
                  <Menu.Item
                    key={provider.id}
                    icon={
                      provider.id === selectedProviderId ? (
                        <CheckIcon />
                      ) : (
                        <span className="block size-4" />
                      )
                    }
                    onSelect={() => handleSelectProvider(provider.id)}
                  >
                    {provider.name}
                  </Menu.Item>
                ))}
              </Menu.Content>
            </DropdownPrimitive.Root>
          </Field>

          {/* API key input ------------------------------------- */}
          <Field hint={activeProvider.keyHint}>
            <FieldLabel>{activeProvider.name} API key</FieldLabel>
            <div className="relative flex items-center">
              <KeyRoundIcon className="pointer-events-none absolute left-2.5 size-4 text-text-muted" />
              <input
                type={revealed ? 'text' : 'password'}
                value={currentKey}
                onChange={(e) => setApiKey(selectedProviderId, e.target.value)}
                placeholder={
                  usingEnv ? 'Using key from .env (VITE_…)' : 'Paste your API key'
                }
                autoComplete="off"
                spellCheck={false}
                className="h-9 w-full rounded-md border border-border bg-chrome pl-8 pr-9 text-[13px] text-text-primary placeholder:text-text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              />
              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                title={revealed ? 'Hide key' : 'Show key'}
                aria-label={revealed ? 'Hide key' : 'Show key'}
                className="absolute right-1.5 inline-flex size-7 items-center justify-center rounded text-text-muted transition hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {revealed ? (
                  <EyeOffIcon className="size-4" />
                ) : (
                  <EyeIcon className="size-4" />
                )}
              </button>
            </div>

            {usingEnv ? (
              <p className="mt-1.5 text-[11px] text-accent">
                A development key was found in{' '}
                <code className="font-mono">{activeProvider.envVar}</code> and
                will be used until you paste one here.
              </p>
            ) : null}
          </Field>

          {/* Privacy reassurance ------------------------------- */}
          <p className="rounded-md border border-border bg-chrome/60 px-3 py-2.5 text-[11px] leading-relaxed text-text-secondary">
            Your key is stored only in this browser (localStorage) and is sent
            directly to the selected AI provider when you generate captions. We
            have no server, so it never passes through us.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  hint,
  children,
}: {
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {children}
      {hint ? <p className="text-[11px] text-text-muted">{hint}</p> : null}
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="text-[12px] font-medium text-text-primary">
      {children}
    </label>
  );
}
