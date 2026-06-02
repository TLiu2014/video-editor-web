import { create } from 'zustand';

/**
 * Visibility flags for the editor's modal dialogs. Each is keyed
 * independently so opening one doesn't close another.
 *
 * Lifting these out of the Toolbar lets the command palette
 * (mounted alongside the Toolbar in AppShell) trigger the same
 * dialogs without needing a callback prop chain.
 */
interface DialogsState {
  projectList: boolean;
  projectSettings: boolean;
  export: boolean;
  captions: boolean;
  setProjectList: (open: boolean) => void;
  setProjectSettings: (open: boolean) => void;
  setExport: (open: boolean) => void;
  setCaptions: (open: boolean) => void;
}

export const useDialogsStore = create<DialogsState>((set) => ({
  projectList: false,
  projectSettings: false,
  export: false,
  captions: false,
  setProjectList: (open) => set({ projectList: open }),
  setProjectSettings: (open) => set({ projectSettings: open }),
  setExport: (open) => set({ export: open }),
  setCaptions: (open) => set({ captions: open }),
}));
