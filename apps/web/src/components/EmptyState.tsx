import {
  FilmIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  UploadIcon,
} from 'lucide-react';
import { useState } from 'react';
import { triggerMediaPicker } from '../lib/filePickers';
import { useTimelineStore } from '../store/useTimelineStore';
import { ProjectListDialog } from './ProjectListDialog';
import { Button } from './ui/Button';

export function EmptyState() {
  const createProject = useTimelineStore((s) => s.createProject);
  const [openDialog, setOpenDialog] = useState(false);

  // Single-click cold start: spin up a fresh project AND open the
  // OS file picker. Zustand's set() is synchronous, so by the time
  // the user selects a file, the picker handler in Toolbar.tsx
  // (which reads currentProject via getState()) sees a real project
  // to attach the clip to.
  const handleStartEditing = () => {
    createProject('Untitled Project');
    triggerMediaPicker();
  };

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-canvas p-8">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <FilmIcon className="size-7" />
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-text-primary">
            Start a project
          </h2>
          <p className="text-[13px] leading-relaxed text-text-secondary">
            video-editor-web is fully client-side. Your media never leaves the
            browser, and projects auto-save to local storage.
          </p>
        </div>
        <div className="flex flex-col items-center gap-3">
          <Button
            variant="primary"
            icon={<UploadIcon />}
            onClick={handleStartEditing}
          >
            Start Editing — Pick Media
          </Button>
          <div className="flex items-center gap-2 text-[12px] text-text-muted">
            <span>or</span>
            <button
              type="button"
              onClick={() => createProject('Untitled Project')}
              className="inline-flex items-center gap-1 rounded text-text-secondary transition hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <FolderPlusIcon className="size-3.5" />
              start blank
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => setOpenDialog(true)}
              className="inline-flex items-center gap-1 rounded text-text-secondary transition hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <FolderOpenIcon className="size-3.5" />
              open existing
            </button>
          </div>
        </div>
        <p className="font-mono text-[11px] text-text-muted">
          Tip: <kbd className="rounded bg-chrome px-1.5 py-0.5">Space</kbd>{' '}
          plays · <kbd className="rounded bg-chrome px-1.5 py-0.5">S</kbd>{' '}
          splits
        </p>
      </div>
      <ProjectListDialog open={openDialog} onOpenChange={setOpenDialog} />
    </div>
  );
}
