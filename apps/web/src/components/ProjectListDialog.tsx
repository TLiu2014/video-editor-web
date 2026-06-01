import { FolderIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { usePersistenceContext } from '../providers/AppProviders';
import type { ProjectListEntry } from '../storage/projectStore';
import { Button } from './ui/Button';
import { Dialog, DialogContent } from './ui/Dialog';

export function ProjectListDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { listProjects, openProject, removeProject } = usePersistenceContext();
  const [entries, setEntries] = useState<ProjectListEntry[] | null>(null);

  const refresh = useCallback(async () => {
    setEntries(await listProjects());
  }, [listProjects]);

  useEffect(() => {
    if (!open) return;
    setEntries(null);
    void refresh();
  }, [open, refresh]);

  const handleOpen = async (id: string) => {
    const ok = await openProject(id);
    if (ok) onOpenChange(false);
  };

  const handleDelete = async (id: string) => {
    await removeProject(id);
    void refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Open Project"
        description="Recently saved projects from this browser."
      >
        {entries === null ? (
          <p className="py-6 text-center text-[12px] text-text-muted">
            Loading…
          </p>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-text-muted">
            No saved projects yet. Create one and edits will auto-save here.
          </p>
        ) : (
          <ul className="-mx-1 max-h-80 overflow-y-auto">
            {entries.map((entry) => (
              <li key={entry.id}>
                <div className="group flex items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-chrome">
                  <button
                    onClick={() => handleOpen(entry.id)}
                    className="flex flex-1 items-center gap-2.5 text-left focus-visible:outline-none"
                  >
                    <FolderIcon className="size-4 text-text-secondary" />
                    <div className="flex flex-col leading-tight">
                      <span className="text-[13px] text-text-primary">
                        {entry.name}
                      </span>
                      <span className="font-mono text-[10px] text-text-muted">
                        {entry.id.slice(0, 8)}
                      </span>
                    </div>
                  </button>
                  <Button
                    variant="danger"
                    size="sm"
                    iconOnly
                    icon={<Trash2Icon />}
                    onClick={() => handleDelete(entry.id)}
                    title="Delete project"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
