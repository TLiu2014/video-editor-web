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

let placePickedOnTimeline = false;

/**
 * Open the media picker. Imports always land in the library; with
 * `placeOnTimeline` (the empty-state "Start Editing" path) the picked
 * files are also laid end to end on the timeline so a first-time user
 * sees their footage immediately.
 */
export function triggerMediaPicker(opts?: { placeOnTimeline?: boolean }): void {
  placePickedOnTimeline = opts?.placeOnTimeline ?? false;
  mediaInput?.click();
}

/** Read-and-reset the flag set by `triggerMediaPicker`. */
export function consumePlaceOnTimeline(): boolean {
  const v = placePickedOnTimeline;
  placePickedOnTimeline = false;
  return v;
}

export function triggerArchivePicker(): void {
  archiveInput?.click();
}
