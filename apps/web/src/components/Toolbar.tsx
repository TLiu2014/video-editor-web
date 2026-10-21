import {
  CaptionsIcon,
  DownloadIcon,
  FilmIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  HomeIcon,
  PackageIcon,
  PackageOpenIcon,
  Redo2Icon,
  SettingsIcon,
  Trash2Icon,
  TypeIcon,
  Undo2Icon,
  UploadIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  consumePlaceOnTimeline,
  registerArchiveInput,
  registerMediaInput,
} from '../lib/filePickers';
import { newId } from '../lib/ids';
import { isMac } from '../lib/platform';
import { importFilesToLibrary } from '../lib/importMedia';
import { trackEnd } from '../lib/projectMetrics';
import {
  downloadCurrentProjectAsZip,
  loadArchiveFromFile,
} from '../lib/archiveActions';
import { useFFmpegContext } from '../providers/AppProviders';
import { useDialogsStore } from '../store/useDialogsStore';
import { useHistoryStore } from '../store/useHistoryStore';
import { useTimelineStore } from '../store/useTimelineStore';
import { ExportDialog } from './ExportDialog';
import { ProjectListDialog } from './ProjectListDialog';
import { ProjectSwitcher } from './ProjectSwitcher';
import { CaptionsDialog } from './CaptionsDialog';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { SettingsModal } from './SettingsModal';
import { ThemeToggle } from './ThemeToggle';
import { Button } from './ui/Button';
import * as Menu from './ui/DropdownMenu';

const MOD = isMac ? '⌘' : 'Ctrl';

export function Toolbar() {
  const project = useTimelineStore((s) => s.currentProject);
  const createProject = useTimelineStore((s) => s.createProject);
  const addOverlay = useTimelineStore((s) => s.addOverlay);
  const removeClips = useTimelineStore((s) => s.removeClips);
  const removeOverlay = useTimelineStore((s) => s.removeOverlay);

  const { isLoaded: ffmpegLoaded } = useFFmpegContext();
  const hasClips = useTimelineStore((s) =>
    (s.currentProject?.tracks ?? []).some((t) => t.clips.length > 0),
  );
  const selectedClipId = useTimelineStore((s) => s.selectedClipId);
  const selectedOverlayId = useTimelineStore((s) => s.selectedOverlayId);
  const canDelete = selectedClipId !== null || selectedOverlayId !== null;
  const canUndo = useHistoryStore((s) => s.past.length > 0);
  const canRedo = useHistoryStore((s) => s.future.length > 0);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);

  // Dialog visibility lives in the global store so the command
  // palette can open them without going through Toolbar props.
  const openDialog = useDialogsStore((s) => s.projectList);
  const setOpenDialog = useDialogsStore((s) => s.setProjectList);
  const openExport = useDialogsStore((s) => s.export);
  const setOpenExport = useDialogsStore((s) => s.setExport);
  const openSettings = useDialogsStore((s) => s.projectSettings);
  const setOpenSettings = useDialogsStore((s) => s.setProjectSettings);
  const openCaptions = useDialogsStore((s) => s.captions);
  const setOpenCaptions = useDialogsStore((s) => s.setCaptions);

  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  useEffect(() => {
    if (!archiveError) return;
    const id = window.setTimeout(() => setArchiveError(null), 5000);
    return () => window.clearTimeout(id);
  }, [archiveError]);

  useEffect(() => {
    if (!importNotice) return;
    const id = window.setTimeout(() => setImportNotice(null), 3000);
    return () => window.clearTimeout(id);
  }, [importNotice]);

  // Register the hidden file inputs so non-Toolbar surfaces (the
  // command palette) can trigger them via `triggerMediaPicker()` /
  // `triggerArchivePicker()`.
  useEffect(() => {
    registerMediaInput(fileInputRef.current);
    return () => registerMediaInput(null);
  }, []);
  useEffect(() => {
    registerArchiveInput(archiveInputRef.current);
    return () => registerArchiveInput(null);
  }, []);

  // Import adds files to the media library only (like Camtasia's
  // Media Bin / Premiere's Project panel). Putting them on the
  // timeline is a separate, explicit step from the library.
  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const placeOnTimeline = consumePlaceOnTimeline();
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!useTimelineStore.getState().currentProject || files.length === 0) {
      return;
    }
    setImporting(true);
    setImportNotice(null);
    try {
      const { assets, skipped } = await importFilesToLibrary(files);
      if (placeOnTimeline) {
        // Lay each asset at the end of its kind's first track.
        for (const asset of assets) {
          const p = useTimelineStore.getState().currentProject;
          const track = p?.tracks.find((t) => t.type === asset.kind);
          if (!p || !track) continue;
          useTimelineStore.getState().insertMediaClip(asset.id, {
            trackId: track.id,
            startOffset: trackEnd(p, track.id),
          });
        }
      }
      const parts: string[] = [];
      if (assets.length > 0) {
        parts.push(
          `Added ${assets.length} file${assets.length === 1 ? '' : 's'} to Media`,
        );
      }
      if (skipped > 0) parts.push(`skipped ${skipped} unsupported`);
      if (parts.length > 0) setImportNotice(parts.join(' · '));
    } finally {
      setImporting(false);
    }
  };

  const handleSaveArchive = async () => {
    setArchiving(true);
    setArchiveError(null);
    try {
      await downloadCurrentProjectAsZip();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setArchiving(false);
    }
  };

  const handleOpenArchive = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      await loadArchiveFromFile(file);
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setArchiving(false);
    }
  };

  const handleAddText = () => {
    if (!project) return;
    const playhead = useTimelineStore.getState().playheadPosition;
    addOverlay({
      id: newId(),
      text: 'Sample text',
      startOffset: playhead,
      duration: 3,
      style: {
        position: { x: 0.1, y: 0.85 },
        color: '#ffffff',
        size: 64,
      },
    });
  };

  const handleDelete = () => {
    const ids = useTimelineStore.getState().selectedClipIds;
    if (ids.length > 0) removeClips(ids);
    else if (selectedOverlayId) removeOverlay(selectedOverlayId);
  };

  return (
    <header className="no-select relative flex h-14 shrink-0 items-center gap-3 border-b border-border bg-panel px-4">
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-md bg-accent/15 text-accent">
          <FilmIcon className="size-5" />
        </div>
        <div className="flex flex-col leading-tight">
          {project ? (
            <ProjectSwitcher name={project.name} />
          ) : (
            <span className="text-[14px] font-semibold text-text-primary">
              video-editor-web
            </span>
          )}
          <span className="text-[11px] text-text-muted">
            {project
              ? `${project.resolution.width}×${project.resolution.height} · ${project.frameRate}fps`
              : 'No project loaded'}
          </span>
        </div>
      </div>

      <div className="mx-1 h-7 w-px bg-border" />

      <div className="flex items-center gap-1">
        <Menu.Root>
          <Menu.TriggerButton label="File" />
          <Menu.Content>
            <Menu.Item
              icon={<FolderPlusIcon />}
              onSelect={() => createProject('Untitled Project')}
            >
              New Project
            </Menu.Item>
            <Menu.Item
              icon={<FolderOpenIcon />}
              onSelect={() => setOpenDialog(true)}
            >
              Open Project…
            </Menu.Item>
            <Menu.Item
              icon={<SettingsIcon />}
              disabled={!project}
              onSelect={() => setOpenSettings(true)}
            >
              Project Settings…
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item
              icon={<UploadIcon />}
              disabled={!project || importing}
              onSelect={() => fileInputRef.current?.click()}
            >
              {importing ? 'Importing…' : 'Import Media…'}
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item
              icon={<PackageIcon />}
              disabled={!project || archiving}
              onSelect={handleSaveArchive}
            >
              Save Archive (.zip)
            </Menu.Item>
            <Menu.Item
              icon={<PackageOpenIcon />}
              disabled={archiving}
              onSelect={() => archiveInputRef.current?.click()}
            >
              Open Archive (.zip)…
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item
              icon={<DownloadIcon />}
              disabled={!project || !hasClips || !ffmpegLoaded}
              onSelect={() => setOpenExport(true)}
            >
              Export Video…
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>

        <Menu.Root>
          <Menu.TriggerButton label="Edit" />
          <Menu.Content>
            <Menu.Item
              icon={<Undo2Icon />}
              disabled={!canUndo}
              onSelect={undo}
              shortcut={`${MOD}+Z`}
            >
              Undo
            </Menu.Item>
            <Menu.Item
              icon={<Redo2Icon />}
              disabled={!canRedo}
              onSelect={redo}
              shortcut={`${MOD}+⇧+Z`}
            >
              Redo
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item
              icon={<TypeIcon />}
              disabled={!project}
              onSelect={handleAddText}
            >
              Add Text Overlay
            </Menu.Item>
            <Menu.Item
              icon={<CaptionsIcon />}
              disabled={!project || !hasClips || !ffmpegLoaded}
              onSelect={() => setOpenCaptions(true)}
            >
              Auto Captions…
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item
              icon={<Trash2Icon />}
              disabled={!canDelete}
              onSelect={handleDelete}
              shortcut="⌫"
            >
              Delete Selection
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>

        <div className="mx-1 h-7 w-px bg-border" />

        <Button
          variant="ghost"
          size="md"
          iconOnly
          icon={<Undo2Icon />}
          disabled={!canUndo}
          onClick={undo}
          title={`Undo (${MOD}+Z)`}
          aria-label="Undo"
        />
        <Button
          variant="ghost"
          size="md"
          iconOnly
          icon={<Redo2Icon />}
          disabled={!canRedo}
          onClick={redo}
          title={`Redo (${MOD}+⇧+Z)`}
          aria-label="Redo"
        />

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*,audio/*"
          hidden
          onChange={handleImport}
        />
        <input
          ref={archiveInputRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={handleOpenArchive}
        />
      </div>

      <div className="flex-1" />

      <div className="flex shrink-0 items-center gap-2">
        {/* Link back to the marketing site. Reads VITE_MARKETING_URL
            at build time; defaults to the Next dev port so a fresh
            `pnpm dev` works without env config. */}
        <a
          href={
            import.meta.env.VITE_MARKETING_URL ?? 'http://localhost:3000'
          }
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-chrome px-3 text-[12px] text-text-secondary transition hover:text-text-primary"
          title="Back to homepage"
          aria-label="Back to homepage"
        >
          <HomeIcon className="size-4" />
          Home
        </a>
        <SettingsModal />
        <ThemeToggle />

        <Button
          variant="primary"
          icon={<DownloadIcon />}
          disabled={!project || !hasClips || !ffmpegLoaded}
          onClick={() => setOpenExport(true)}
          title={
            !project
              ? 'Create a project first'
              : !hasClips
                ? 'Import media first'
                : !ffmpegLoaded
                  ? 'Engine is still loading'
                  : 'Render the project to MP4'
          }
        >
          Export
        </Button>
      </div>

      <ProjectListDialog open={openDialog} onOpenChange={setOpenDialog} />
      <ExportDialog open={openExport} onOpenChange={setOpenExport} />
      <ProjectSettingsDialog
        open={openSettings}
        onOpenChange={setOpenSettings}
      />
      <CaptionsDialog open={openCaptions} onOpenChange={setOpenCaptions} />

      {archiveError ? (
        <div
          role="alert"
          className="absolute left-1/2 top-full z-30 mt-2 max-w-md -translate-x-1/2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger shadow-xl"
        >
          {archiveError}
        </div>
      ) : null}

      {importNotice ? (
        <div
          role="status"
          className="absolute left-1/2 top-full z-30 mt-2 max-w-md -translate-x-1/2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-[12px] text-accent shadow-xl"
        >
          {importNotice}
        </div>
      ) : null}
    </header>
  );
}
