import {
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  BlendIcon,
  BetweenHorizontalStartIcon,
  BrushCleaningIcon,
  CaptionsIcon,
  CircleIcon,
  MessageSquareIcon,
  MoveUpRightIcon,
  SquareIcon,
  CircleDotIcon,
  ClipboardCopyIcon,
  ClipboardPasteIcon,
  CombineIcon,
  CropIcon,
  DownloadIcon,
  FilmIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  KeyboardIcon,
  Link2Icon,
  Link2OffIcon,
  MoonIcon,
  MousePointerIcon,
  PackageIcon,
  PauseIcon,
  PlayIcon,
  Redo2Icon,
  ScissorsIcon,
  SettingsIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SquareDashedIcon,
  SunIcon,
  Trash2Icon,
  TypeIcon,
  Undo2Icon,
  XSquareIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  addShapeAtPlayhead,
  addTransitionAtPlayhead,
  closeGapsForSelection,
  deleteSelection,
  joinBlocker,
  joinSelection,
  markSelectionRange,
  cutSelection,
  splitSelection,
  trimSelectionToPlayhead,
} from '../lib/editActions';
import { newId } from '../lib/ids';
import { computeProjectDuration } from '../lib/projectMetrics';
import { useDialogsStore } from '../store/useDialogsStore';
import { useHistoryStore } from '../store/useHistoryStore';
import { useThemeStore } from '../store/useThemeStore';
import { useTimelineStore } from '../store/useTimelineStore';
import { useTimelineViewStore } from '../store/useTimelineViewStore';

export interface Command {
  id: string;
  label: string;
  /** Lowercase tokens used for fuzzy matching beyond the label. */
  keywords: string[];
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
  shortcut?: string;
  action: () => void;
}

/**
 * Snapshot the current store state into a flat list of commands the
 * palette can render. We intentionally pull state via `getState()`
 * inside actions so commands fire against the latest values, even
 * if React hasn't re-rendered yet.
 */
export function useCommands(triggers: {
  openProject: () => void;
  openSettings: () => void;
  openExport: () => void;
  openCaptions: () => void;
  saveArchive: () => void;
  openArchive: () => void;
  pickMedia: () => void;
}): Command[] {
  const project = useTimelineStore((s) => s.currentProject);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const selectedClipId = useTimelineStore((s) => s.selectedClipId);
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const selectedOverlayId = useTimelineStore((s) => s.selectedOverlayId);
  const clipboardSize = useTimelineStore((s) => s.clipboardSize);
  const inPoint = useTimelineStore((s) => s.inPoint);
  const outPoint = useTimelineStore((s) => s.outPoint);
  const hasRange = inPoint !== null || outPoint !== null;
  // Recomputed each render; `project` / `selectedClipIds` subscriptions
  // above re-render the palette whenever the answer could change.
  const joinReason = joinBlocker();
  const canUndo = useHistoryStore((s) => s.past.length > 0);
  const canRedo = useHistoryStore((s) => s.future.length > 0);
  const theme = useThemeStore((s) => s.theme);

  const hasProject = project !== null;
  const hasClips =
    project?.tracks.some((t) => t.clips.length > 0) ?? false;
  const canDelete = selectedClipId !== null || selectedOverlayId !== null;
  // Selected groupIds among the current multi-selection. A non-
  // empty set means the user has at least one grouped clip
  // selected, which is enough to trigger "Ungroup."
  const selectedGroupIds = (() => {
    if (!project) return new Set<string>();
    const ids = new Set<string>();
    for (const t of project.tracks) {
      for (const c of t.clips) {
        if (c.groupId && selectedClipIds.includes(c.id)) ids.add(c.groupId);
      }
    }
    return ids;
  })();
  const canGroup = selectedClipIds.length >= 2;
  const canUngroup = selectedGroupIds.size > 0;
  const projectDuration = project ? computeProjectDuration(project) : 0;

  return [
    {
      id: 'new-project',
      label: 'New Project',
      keywords: ['create', 'fresh', 'start'],
      icon: <FolderPlusIcon />,
      action: () =>
        useTimelineStore.getState().createProject('Untitled Project'),
    },
    {
      id: 'open-project',
      label: 'Open Project…',
      keywords: ['load', 'list'],
      icon: <FolderOpenIcon />,
      action: triggers.openProject,
    },
    {
      id: 'project-settings',
      label: 'Project Settings…',
      keywords: ['resolution', 'fps', 'frame rate', 'sample rate'],
      icon: <SettingsIcon />,
      disabled: !hasProject,
      action: triggers.openSettings,
    },
    {
      id: 'import-media',
      label: 'Import Media…',
      keywords: ['add', 'video', 'audio', 'upload'],
      icon: <FilmIcon />,
      shortcut: '⌘I',
      disabled: !hasProject,
      action: triggers.pickMedia,
    },
    {
      id: 'save-archive',
      label: 'Save Archive (.zip)',
      keywords: ['download', 'export', 'zip', 'backup'],
      icon: <PackageIcon />,
      disabled: !hasProject,
      action: triggers.saveArchive,
    },
    {
      id: 'open-archive',
      label: 'Open Archive (.zip)…',
      keywords: ['import', 'load', 'zip'],
      icon: <PackageIcon />,
      action: triggers.openArchive,
    },
    {
      id: 'export-video',
      label: 'Export Video…',
      keywords: ['render', 'mp4', 'download'],
      icon: <DownloadIcon />,
      shortcut: '⌘E',
      disabled: !hasClips,
      action: triggers.openExport,
    },
    {
      id: 'add-text',
      label: 'Add Text Overlay',
      keywords: ['caption', 'title', 'overlay'],
      icon: <TypeIcon />,
      shortcut: 'T',
      disabled: !hasProject,
      action: () => {
        const s = useTimelineStore.getState();
        if (!s.currentProject) return;
        s.addOverlay({
          id: newId(),
          text: 'Sample text',
          startOffset: s.playheadPosition,
          duration: 3,
          style: {
            position: { x: 0.1, y: 0.85 },
            color: '#ffffff',
            size: 64,
          },
        });
      },
    },
    ...(
      [
        ['callout', 'Add Callout', <MessageSquareIcon key="i" />, ['annotation', 'bubble', 'note', 'box']],
        ['arrow', 'Add Arrow', <MoveUpRightIcon key="i" />, ['annotation', 'pointer']],
        ['rect', 'Add Rectangle', <SquareIcon key="i" />, ['annotation', 'box', 'highlight', 'shape']],
        ['ellipse', 'Add Ellipse', <CircleIcon key="i" />, ['annotation', 'circle', 'shape']],
      ] as const
    ).map(([kind, label, icon, keywords]) => ({
      id: `add-${kind}`,
      label,
      keywords: [...keywords],
      icon,
      disabled: !hasProject,
      action: () => addShapeAtPlayhead(kind),
    })),
    {
      id: 'auto-captions',
      label: 'Auto Captions…',
      keywords: ['caption', 'subtitle', 'transcribe', 'speech', 'srt', 'ai'],
      icon: <CaptionsIcon />,
      disabled: !hasClips,
      action: triggers.openCaptions,
    },
    {
      id: 'split',
      label: 'Split at Playhead',
      keywords: ['cut', 'divide', 'razor'],
      icon: <ScissorsIcon />,
      shortcut: 'S',
      disabled: !hasProject,
      action: splitSelection,
    },
    {
      id: 'trim-start-to-playhead',
      label: 'Trim Clip Start to Playhead',
      keywords: ['trim', 'in', 'head', 'q'],
      icon: <ArrowLeftToLineIcon />,
      shortcut: 'Q',
      disabled: !hasClips,
      action: () => trimSelectionToPlayhead('start', false),
    },
    {
      id: 'trim-end-to-playhead',
      label: 'Trim Clip End to Playhead',
      keywords: ['trim', 'out', 'tail', 'w'],
      icon: <ArrowRightToLineIcon />,
      shortcut: 'W',
      disabled: !hasClips,
      action: () => trimSelectionToPlayhead('end', false),
    },
    {
      id: 'ripple-trim-start-to-playhead',
      label: 'Ripple Trim Clip Start to Playhead',
      keywords: ['trim', 'ripple', 'in', 'head'],
      icon: <ArrowLeftToLineIcon />,
      shortcut: '⇧Q',
      disabled: !hasClips,
      action: () => trimSelectionToPlayhead('start', true),
    },
    {
      id: 'ripple-trim-end-to-playhead',
      label: 'Ripple Trim Clip End to Playhead',
      keywords: ['trim', 'ripple', 'out', 'tail'],
      icon: <ArrowRightToLineIcon />,
      shortcut: '⇧W',
      disabled: !hasClips,
      action: () => trimSelectionToPlayhead('end', true),
    },
    {
      id: 'join-clips',
      label: 'Join Clips',
      keywords: ['merge', 'heal', 'combine', 'stitch', 'through edit'],
      icon: <CombineIcon />,
      shortcut: '⌘J',
      hint: joinReason ?? undefined,
      disabled: joinReason !== null,
      action: joinSelection,
    },
    {
      id: 'add-transition',
      label: 'Add Transition',
      keywords: ['dissolve', 'crossfade', 'wipe', 'slide', 'cut'],
      icon: <BlendIcon />,
      shortcut: '⌘D',
      hint: 'At the V1 cut nearest the playhead',
      disabled: !hasClips,
      action: addTransitionAtPlayhead,
    },
    {
      id: 'close-gaps',
      label: 'Close Gaps',
      keywords: ['gap', 'remove space', 'pack', 'ripple'],
      icon: <BetweenHorizontalStartIcon />,
      hint:
        selectedClipIds.length > 0
          ? "On the selected clips' tracks"
          : 'On every track',
      disabled: !hasClips,
      action: closeGapsForSelection,
    },
    {
      id: 'delete',
      label: 'Delete Selection',
      keywords: ['remove'],
      icon: <Trash2Icon />,
      shortcut: '⌫',
      disabled: !canDelete,
      action: () => deleteSelection(false),
    },
    {
      id: 'ripple-delete',
      label: 'Ripple Delete Clips',
      keywords: ['remove', 'close gap', 'shift'],
      icon: <Trash2Icon />,
      shortcut: '⇧⌫',
      disabled: selectedClipIds.length === 0,
      action: () => deleteSelection(true),
    },
    {
      id: 'remove-unused-media',
      label: 'Remove Unused Media',
      keywords: ['library', 'bin', 'clean', 'purge'],
      icon: <BrushCleaningIcon />,
      disabled: !hasProject,
      action: () => useTimelineStore.getState().removeUnusedMedia(),
    },
    {
      id: 'cut-clips',
      label: 'Cut Selected Clips',
      keywords: ['clipboard', 'remove'],
      icon: <ScissorsIcon />,
      shortcut: '⌘X',
      disabled: selectedClipIds.length === 0,
      action: cutSelection,
    },
    {
      id: 'copy-clips',
      label: 'Copy Selected Clips',
      keywords: ['clipboard', 'duplicate'],
      icon: <ClipboardCopyIcon />,
      shortcut: '⌘C',
      disabled: selectedClipIds.length === 0,
      action: () => {
        const s = useTimelineStore.getState();
        if (s.selectedClipIds.length > 0) {
          s.copyClipsToClipboard(s.selectedClipIds);
        }
      },
    },
    {
      id: 'paste-clips',
      label: 'Paste Clips at Playhead',
      keywords: ['clipboard', 'insert'],
      icon: <ClipboardPasteIcon />,
      shortcut: '⌘V',
      disabled: !hasProject || clipboardSize === 0,
      action: () => useTimelineStore.getState().pasteClipboardAtPlayhead(),
    },
    {
      id: 'set-in-point',
      label: 'Mark In at Playhead',
      keywords: ['range', 'crop', 'in'],
      icon: <SquareDashedIcon />,
      shortcut: 'I',
      disabled: !hasProject,
      action: () => {
        const s = useTimelineStore.getState();
        s.setInPoint(s.playheadPosition);
      },
    },
    {
      id: 'set-out-point',
      label: 'Mark Out at Playhead',
      keywords: ['range', 'crop', 'out'],
      icon: <SquareDashedIcon />,
      shortcut: 'O',
      disabled: !hasProject,
      action: () => {
        const s = useTimelineStore.getState();
        s.setOutPoint(s.playheadPosition);
      },
    },
    {
      id: 'trim-to-range',
      label: 'Trim to In/Out Range',
      keywords: ['crop', 'range', 'cut'],
      icon: <CropIcon />,
      shortcut: "⇧'",
      disabled: !hasRange,
      action: () => useTimelineStore.getState().trimToRange(),
    },
    {
      id: 'clear-range',
      label: 'Clear In/Out Range',
      keywords: ['range', 'reset'],
      icon: <XSquareIcon />,
      shortcut: '⇧X',
      disabled: !hasRange,
      action: () => useTimelineStore.getState().clearInOutPoints(),
    },
    {
      id: 'mark-clip',
      label: 'Mark Selected Clips (In/Out)',
      keywords: ['range', 'in', 'out', 'mark clip'],
      icon: <SquareDashedIcon />,
      shortcut: 'X',
      disabled: !hasProject,
      action: markSelectionRange,
    },
    {
      id: 'delete-range',
      label: 'Delete In/Out Range (Close Gap)',
      keywords: ['extract', 'range', 'remove', 'ripple'],
      icon: <Trash2Icon />,
      shortcut: "'",
      disabled: inPoint === null || outPoint === null,
      action: () => useTimelineStore.getState().deleteRange(),
    },
    {
      id: 'group-clips',
      label: 'Group Selected Clips',
      keywords: ['link', 'bind', 'multi'],
      icon: <Link2Icon />,
      shortcut: '⌘G',
      disabled: !canGroup,
      action: () => {
        const s = useTimelineStore.getState();
        s.groupClips(s.selectedClipIds);
      },
    },
    {
      id: 'ungroup-clips',
      label: 'Ungroup Selected Clips',
      keywords: ['unlink', 'unbind'],
      icon: <Link2OffIcon />,
      shortcut: '⇧⌘G',
      disabled: !canUngroup,
      action: () => {
        const s = useTimelineStore.getState();
        for (const gid of selectedGroupIds) s.ungroupClips(gid);
      },
    },
    {
      id: 'select-all-clips',
      label: 'Select All Clips',
      keywords: ['selection', 'all'],
      icon: <MousePointerIcon />,
      shortcut: '⌘A',
      disabled: !hasClips,
      action: () => {
        const s = useTimelineStore.getState();
        const p = s.currentProject;
        if (!p) return;
        const ids = p.tracks.flatMap((t) => t.clips.map((c) => c.id));
        s.setSelectedClipIds(ids);
      },
    },
    {
      id: 'select-track-clips',
      label: 'Select Clips on Same Track',
      keywords: ['selection', 'track'],
      icon: <MousePointerIcon />,
      disabled: !selectedClipId,
      action: () => {
        const s = useTimelineStore.getState();
        const p = s.currentProject;
        if (!p || !s.selectedClipId) return;
        const track = p.tracks.find((t) =>
          t.clips.some((c) => c.id === s.selectedClipId),
        );
        if (!track) return;
        s.setSelectedClipIds(track.clips.map((c) => c.id));
      },
    },
    {
      id: 'select-after-playhead',
      label: 'Select Clips After Playhead',
      keywords: ['selection', 'forward'],
      icon: <CircleDotIcon />,
      disabled: !hasClips,
      action: () => {
        const s = useTimelineStore.getState();
        const p = s.currentProject;
        if (!p) return;
        const ph = s.playheadPosition;
        const ids = p.tracks.flatMap((t) =>
          t.clips.filter((c) => c.startOffset >= ph).map((c) => c.id),
        );
        s.setSelectedClipIds(ids);
      },
    },
    {
      id: 'select-before-playhead',
      label: 'Select Clips Before Playhead',
      keywords: ['selection', 'past'],
      icon: <CircleDotIcon />,
      disabled: !hasClips,
      action: () => {
        const s = useTimelineStore.getState();
        const p = s.currentProject;
        if (!p) return;
        const ph = s.playheadPosition;
        const ids = p.tracks.flatMap((t) =>
          t.clips
            .filter((c) => c.startOffset + c.duration <= ph)
            .map((c) => c.id),
        );
        s.setSelectedClipIds(ids);
      },
    },
    {
      id: 'clear-selection',
      label: 'Clear Selection',
      keywords: ['deselect'],
      icon: <MousePointerIcon />,
      disabled: selectedClipIds.length === 0 && !selectedOverlayId,
      action: () => {
        useTimelineStore.getState().setSelectedClipIds([]);
      },
    },
    {
      id: 'play-pause',
      label: isPlaying ? 'Pause' : 'Play',
      keywords: ['transport', 'space'],
      icon: isPlaying ? <PauseIcon /> : <PlayIcon />,
      shortcut: 'Space',
      disabled: !hasClips,
      action: () =>
        useTimelineStore.getState().setPlaying(
          !useTimelineStore.getState().isPlaying,
        ),
    },
    {
      id: 'goto-start',
      label: 'Go to Start',
      keywords: ['rewind', 'beginning'],
      icon: <SkipBackIcon />,
      shortcut: 'Home',
      disabled: !hasProject,
      action: () => useTimelineStore.getState().updatePlayhead(0),
    },
    {
      id: 'goto-end',
      label: 'Go to End',
      keywords: ['forward'],
      icon: <SkipForwardIcon />,
      shortcut: 'End',
      disabled: !hasProject,
      action: () =>
        useTimelineStore.getState().updatePlayhead(projectDuration),
    },
    {
      id: 'keyboard-shortcuts',
      label: 'Keyboard Shortcuts',
      keywords: ['keys', 'help', 'hotkeys', 'bindings'],
      icon: <KeyboardIcon />,
      shortcut: '?',
      action: () => useDialogsStore.getState().setShortcuts(true),
    },
    {
      id: 'undo',
      label: 'Undo',
      keywords: ['revert'],
      icon: <Undo2Icon />,
      disabled: !canUndo,
      action: () => useHistoryStore.getState().undo(),
    },
    {
      id: 'redo',
      label: 'Redo',
      keywords: ['restore'],
      icon: <Redo2Icon />,
      disabled: !canRedo,
      action: () => useHistoryStore.getState().redo(),
    },
    {
      id: 'zoom-in',
      label: 'Zoom In',
      keywords: ['timeline', 'detail'],
      icon: <ZoomInIcon />,
      shortcut: '=',
      action: () => useTimelineViewStore.getState().zoomIn(),
    },
    {
      id: 'zoom-out',
      label: 'Zoom Out',
      keywords: ['timeline', 'overview'],
      icon: <ZoomOutIcon />,
      shortcut: '-',
      action: () => useTimelineViewStore.getState().zoomOut(),
    },
    {
      id: 'zoom-reset',
      label: 'Reset Zoom',
      keywords: ['timeline', 'default'],
      shortcut: '0',
      action: () => useTimelineViewStore.getState().resetZoom(),
    },
    {
      id: 'theme',
      label: theme === 'light' ? 'Switch to Dark Theme' : 'Switch to Light Theme',
      keywords: ['theme', 'appearance', 'dark', 'light', 'color'],
      icon: theme === 'light' ? <MoonIcon /> : <SunIcon />,
      action: () => useThemeStore.getState().toggleTheme(),
    },
  ];
}
