import { FilmIcon, FolderOpenIcon, SparklesIcon } from 'lucide-react';
import { useState } from 'react';
import { useTimelineStore } from '../store/useTimelineStore';
import { ProjectListDialog } from './ProjectListDialog';
import { Button } from './ui/Button';

export function EmptyState() {
  const createProject = useTimelineStore((s) => s.createProject);
  const [openDialog, setOpenDialog] = useState(false);

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
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            icon={<SparklesIcon />}
            onClick={() => createProject('Untitled Project')}
          >
            New Project
          </Button>
          <Button
            variant="default"
            icon={<FolderOpenIcon />}
            onClick={() => setOpenDialog(true)}
          >
            Open Project
          </Button>
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
