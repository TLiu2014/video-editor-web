/**
 * Module-level handles to the hidden `<input type="file">` elements
 * mounted by the Toolbar. Lets non-Toolbar surfaces (the command
 * palette) trigger media / archive imports without prop-drilling
 * refs or wiring callbacks across providers.
 *
 * The Toolbar registers each input's ref on mount and unregisters
 * on unmount. Triggers no-op silently when no input is registered.
 */
let mediaInput: HTMLInputElement | null = null;
let archiveInput: HTMLInputElement | null = null;

export function registerMediaInput(el: HTMLInputElement | null): void {
  mediaInput = el;
}

export function registerArchiveInput(el: HTMLInputElement | null): void {
  archiveInput = el;
}

export function triggerMediaPicker(): void {
  mediaInput?.click();
}

export function triggerArchivePicker(): void {
  archiveInput?.click();
}
