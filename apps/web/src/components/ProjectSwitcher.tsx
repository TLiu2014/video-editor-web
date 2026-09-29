import * as Primitive from '@radix-ui/react-dropdown-menu';
import {
  ChevronDownIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  PencilIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePersistenceContext } from '../providers/AppProviders';
import type { ProjectListEntry } from '../storage/projectStore';
import { useDialogsStore } from '../store/useDialogsStore';
import { useTimelineStore } from '../store/useTimelineStore';
import * as Menu from './ui/DropdownMenu';

const RECENT_LIMIT = 8;

/**
 * Top-left project identity control.
 *
 * Two modes:
 *   - Default: a Radix dropdown trigger displaying the current name.
 *     The menu lists recent projects (click to switch), plus quick
 *     actions (New Project, Open Project…, Rename). Saves the user
 *     from digging into the File menu for a project switch.
 *   - Editing: an inline <input> (entered via the "Rename" menu
 *     item). Enter commits, Escape cancels, blur commits.
 */
export function ProjectSwitcher({ name }: { name: string }) {
  const renameProject = useTimelineStore((s) => s.renameProject);
  const createProject = useTimelineStore((s) => s.createProject);
  const currentProjectId = useTimelineStore((s) => s.currentProject?.id);
  const setProjectListDialog = useDialogsStore((s) => s.setProjectList);
  const { listProjects, openProject } = usePersistenceContext();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [entries, setEntries] = useState<ProjectListEntry[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the draft in sync with externally-driven renames (e.g.,
  // switching projects via the menu while we're not editing).
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  // Focus + select on entering edit mode.
  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  // Refresh the recent list whenever the menu opens. Cheap call —
  // listProjects scans only the metadata index, not blobs.
  useEffect(() => {
    if (!menuOpen) return;
    let cancelled = false;
    void listProjects().then((list) => {
      if (!cancelled) setEntries(list);
    });
    return () => {
      cancelled = true;
    };
  }, [menuOpen, listProjects]);

  const commitRename = () => {
    renameProject(draft);
    setDraft(draft.trim() || name);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitRename();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(name);
            setEditing(false);
          }
        }}
        className="-mx-1 w-[260px] rounded border border-border bg-chrome px-1 text-[13px] font-semibold text-text-primary outline-none ring-2 ring-accent"
        maxLength={120}
        aria-label="Rename project"
      />
    );
  }

  const recent = entries
    ? entries.filter((e) => e.id !== currentProjectId).slice(0, RECENT_LIMIT)
    : null;

  return (
    <Primitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
      <Primitive.Trigger asChild>
        <button
          type="button"
          className="-mx-1 inline-flex max-w-[280px] items-center gap-1 rounded px-1 text-left text-[13px] font-semibold text-text-primary transition hover:bg-chrome focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-chrome"
          title="Switch project"
        >
          <span className="truncate">{name}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
        </button>
      </Primitive.Trigger>
      <Menu.Content className="min-w-[18rem]">
        <Menu.Label>Recent projects</Menu.Label>
        {recent === null ? (
          <div className="px-2 py-3 text-[12px] text-text-muted">Loading…</div>
        ) : recent.length === 0 ? (
          <div className="px-2 py-3 text-[12px] text-text-muted">
            No other projects yet.
          </div>
        ) : (
          recent.map((entry) => (
            <Menu.Item
              key={entry.id}
              icon={<FolderIcon />}
              onSelect={() => {
                void openProject(entry.id);
              }}
            >
              {entry.name}
            </Menu.Item>
          ))
        )}
        <Menu.Separator />
        <Menu.Item
          icon={<FolderPlusIcon />}
          onSelect={() => createProject('Untitled Project')}
        >
          New Project
        </Menu.Item>
        <Menu.Item
          icon={<FolderOpenIcon />}
          onSelect={() => setProjectListDialog(true)}
        >
          Open Project…
        </Menu.Item>
        <Menu.Item icon={<PencilIcon />} onSelect={() => setEditing(true)}>
          Rename current
        </Menu.Item>
      </Menu.Content>
    </Primitive.Root>
  );
}
