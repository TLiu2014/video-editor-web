import { useEffect, useRef, useState } from 'react';
import { useTimelineStore } from '../store/useTimelineStore';

/**
 * Click-to-edit project name. Enter commits, Escape cancels, blur
 * commits. The input is auto-focused and the existing text is
 * pre-selected so retyping replaces the whole name.
 */
export function ProjectNameEditor({ name }: { name: string }) {
  const renameProject = useTimelineStore((s) => s.renameProject);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the draft in sync with externally-driven renames (e.g.,
  // opening a different project while we're not editing).
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  const commit = () => {
    renameProject(draft);
    setDraft(draft.trim() || name);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="-mx-1 max-w-[260px] truncate rounded px-1 text-left text-[13px] font-semibold text-text-primary transition hover:bg-chrome focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        title="Rename project"
      >
        {name}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(name);
          setEditing(false);
        }
      }}
      className="-mx-1 w-[260px] rounded border border-border bg-chrome px-1 text-[13px] font-semibold text-text-primary outline-none ring-2 ring-accent"
      maxLength={120}
    />
  );
}
