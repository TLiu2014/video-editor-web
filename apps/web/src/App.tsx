import { LeftSidebar } from './components/LeftSidebar';
import { CommandPalette } from './components/CommandPalette';
import { EmptyState } from './components/EmptyState';
import { Preview } from './components/Preview';
import { PropertiesPanel } from './components/PropertiesPanel';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { StatusBar } from './components/StatusBar';
import { Timeline } from './components/timeline/Timeline';
import { Toolbar } from './components/Toolbar';
import { ResizeHandle } from './components/ui/ResizeHandle';
import { Transport } from './components/Transport';
import { useCommands } from './hooks/useCommands';
import {
  downloadCurrentProjectAsZip,
} from './lib/archiveActions';
import {
  triggerArchivePicker,
  triggerMediaPicker,
} from './lib/filePickers';
import { useDialogsStore } from './store/useDialogsStore';
import { useEffect } from 'react';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useHistoryEngine } from './hooks/useHistoryEngine';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { usePlaybackEngine } from './hooks/usePlaybackEngine';
import { AppProviders } from './providers/AppProviders';
import { useTimelineStore } from './store/useTimelineStore';
import {
  applyThemeToDocument,
  useThemeStore,
} from './store/useThemeStore';

function AppShell() {
  const hasProject = useTimelineStore((s) => s.currentProject !== null);
  usePlaybackEngine();
  useAudioEngine();
  useHistoryEngine();
  useKeyboardShortcuts();

  const setProjectList = useDialogsStore((s) => s.setProjectList);
  const setProjectSettings = useDialogsStore((s) => s.setProjectSettings);
  const setExport = useDialogsStore((s) => s.setExport);
  const setCaptions = useDialogsStore((s) => s.setCaptions);
  const commands = useCommands({
    openProject: () => setProjectList(true),
    openSettings: () => setProjectSettings(true),
    openExport: () => setExport(true),
    openCaptions: () => setCaptions(true),
    saveArchive: () => {
      void downloadCurrentProjectAsZip();
    },
    openArchive: triggerArchivePicker,
    pickMedia: triggerMediaPicker,
  });

  // Keep <html data-theme> in sync with the theme store. The initial
  // value was already applied in main.tsx; this subscription handles
  // every subsequent toggle.
  useEffect(() => {
    return useThemeStore.subscribe((s) => {
      applyThemeToDocument(s.theme);
    });
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-canvas text-text-primary">
      <Toolbar />
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          {hasProject ? <LeftSidebar /> : null}
          {hasProject ? (
            <ResizeHandle panel="sidebarWidth" axis="x" direction={1} />
          ) : null}
          {hasProject ? <Preview /> : <EmptyState />}
          {hasProject ? (
            <ResizeHandle panel="propertiesWidth" axis="x" direction={-1} />
          ) : null}
          {hasProject ? <PropertiesPanel /> : null}
        </div>
        {hasProject ? (
          <ResizeHandle panel="timelineHeight" axis="y" direction={-1} />
        ) : null}
        <Transport />
        <Timeline />
      </main>
      <StatusBar />
      <CommandPalette commands={commands} />
      <ShortcutsDialog />
    </div>
  );
}

export function App() {
  return (
    <AppProviders>
      <AppShell />
    </AppProviders>
  );
}
