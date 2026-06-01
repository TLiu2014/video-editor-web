import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CornerDownLeftIcon, SearchIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Command } from '../hooks/useCommands';
import { usePaletteHistoryStore } from '../store/usePaletteHistoryStore';
import { usePaletteStore } from '../store/usePaletteStore';

/**
 * Global command palette. Triggered by Cmd/Ctrl+K, shows a fuzzy-
 * searchable list of every action the toolbar/menus expose, plus
 * playback and zoom controls. Keyboard-only by design — Arrow
 * Up/Down navigates, Enter executes, Escape closes.
 *
 * Built on the same Radix Dialog primitive as the rest of the
 * editor for consistent focus trapping and overlay behavior, but
 * styled into a compact "Spotlight" form.
 */
export function CommandPalette({ commands }: { commands: Command[] }) {
  const open = usePaletteStore((s) => s.open);
  const setOpen = usePaletteStore((s) => s.setOpen);
  const usage = usePaletteHistoryStore((s) => s.usage);
  const recordUsage = usePaletteHistoryStore((s) => s.recordUsage);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(
    () => filterCommands(commands, query, usage),
    [commands, query, usage],
  );

  // Reset search + selection whenever the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIdx(0);
  }, [open]);

  // Clamp the highlighted index when the filtered set shrinks.
  useEffect(() => {
    if (selectedIdx >= filtered.length) {
      setSelectedIdx(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIdx]);

  // Keep the highlighted item scrolled into view as the user
  // arrows through long result sets.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const child = list.children[selectedIdx] as HTMLElement | undefined;
    child?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, filtered.length]);

  const run = (cmd: Command) => {
    if (cmd.disabled) return;
    recordUsage(cmd.id);
    cmd.action();
    setOpen(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[selectedIdx];
      if (cmd) run(cmd);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[18%] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-panel-elevated shadow-2xl focus:outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            Command palette
          </DialogPrimitive.Title>

          <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
            <SearchIcon className="size-4 text-text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIdx(0);
              }}
              onKeyDown={handleKey}
              placeholder="Type a command…"
              aria-label="Command search"
              className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted"
            />
            <span className="font-mono text-[10px] text-text-muted">esc</span>
          </div>

          {filtered.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-text-muted">
              No matching commands.
            </div>
          ) : (
            <ul
              ref={listRef}
              className="scrollbar-thin max-h-80 overflow-y-auto py-1"
            >
              {filtered.map((cmd, i) => {
                const isSelected = i === selectedIdx;
                return (
                  <li key={cmd.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setSelectedIdx(i)}
                      onClick={() => run(cmd)}
                      disabled={cmd.disabled}
                      className={`flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left text-[13px] transition ${
                        cmd.disabled
                          ? 'cursor-not-allowed text-text-muted'
                          : isSelected
                            ? 'bg-accent text-white'
                            : 'text-text-primary hover:bg-chrome'
                      }`}
                    >
                      {cmd.icon ? (
                        <span
                          className={`shrink-0 ${
                            isSelected && !cmd.disabled
                              ? 'text-white'
                              : 'text-text-secondary'
                          } [&>svg]:size-4`}
                        >
                          {cmd.icon}
                        </span>
                      ) : null}
                      <span className="flex-1 truncate">{cmd.label}</span>
                      {cmd.shortcut ? (
                        <span
                          className={`font-mono text-[10px] ${
                            isSelected && !cmd.disabled
                              ? 'text-white/80'
                              : 'text-text-muted'
                          }`}
                        >
                          {cmd.shortcut}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center justify-between border-t border-border px-3.5 py-1.5 text-[10px] text-text-muted">
            <span>
              {filtered.length} of {commands.length} commands
            </span>
            <span className="flex items-center gap-1">
              <CornerDownLeftIcon className="size-3" />
              <span>to run</span>
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Cheap "contains every token" fuzzy filter — words in the query
 * must each appear (case-insensitive) somewhere in the label or
 * keywords.
 *
 * Empty-query view: ordered by frecency (recently used first, then
 * declaration order). With a query: label-prefix matches still
 * outweigh frecency so search feels predictable.
 */
function filterCommands(
  commands: Command[],
  query: string,
  usage: Record<string, { count: number; lastUsedAt: number } | undefined>,
): Command[] {
  const q = query.trim().toLowerCase();

  if (!q) {
    // No query: surface used commands by most-recent-first, then
    // never-used commands in declaration order.
    const decorated = commands.map((cmd, index) => ({
      cmd,
      index,
      lastUsedAt: usage[cmd.id]?.lastUsedAt ?? 0,
    }));
    decorated.sort((a, b) => {
      // Both unused: keep declaration order
      if (a.lastUsedAt === 0 && b.lastUsedAt === 0) return a.index - b.index;
      // One unused: used wins
      if (a.lastUsedAt === 0) return 1;
      if (b.lastUsedAt === 0) return -1;
      // Both used: more recent wins
      return b.lastUsedAt - a.lastUsedAt;
    });
    return decorated.map((d) => d.cmd);
  }

  const tokens = q.split(/\s+/);
  const scored: { cmd: Command; score: number; index: number }[] = [];
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (!cmd) continue;
    const hay = `${cmd.label} ${cmd.keywords.join(' ')}`.toLowerCase();
    if (!tokens.every((tok) => hay.includes(tok))) continue;
    let score = 0;
    if (cmd.label.toLowerCase().startsWith(q)) score += 100;
    if (cmd.label.toLowerCase().includes(q)) score += 50;
    score -= cmd.disabled ? 5 : 0;
    // Tiny frecency bonus so previously-used matches edge out
    // never-used ones at equal relevance.
    if (usage[cmd.id]) score += 5;
    scored.push({ cmd, score, index: i });
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.cmd);
}
