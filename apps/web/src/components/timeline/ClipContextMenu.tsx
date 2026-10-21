import {
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  BlendIcon,
  BetweenHorizontalStartIcon,
  ClipboardCopyIcon,
  CombineIcon,
  FolderInputIcon,
  Link2Icon,
  Link2OffIcon,
  ScissorsIcon,
  Trash2Icon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  addTransitionInto,
  closeGapsForSelection,
  deleteSelection,
  joinBlocker,
  joinSelection,
  revealSelectionInMedia,
  splitSelection,
  trimSelectionToPlayhead,
} from '../../lib/editActions';
import { isMac } from '../../lib/platform';
import { baseTrackClips, previousTouching } from '../../lib/transitions';
import { useTimelineStore } from '../../store/useTimelineStore';
import { useTimelineViewStore } from '../../store/useTimelineViewStore';

const MOD = isMac ? '⌘' : 'Ctrl+';

interface Item {
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  /** Shown as a tooltip — used to explain why an item is disabled. */
  hint?: string;
  danger?: boolean;
  action: () => void;
}

/**
 * Right-click menu for timeline clips. Acts on the current selection
 * (right-clicking an unselected clip selects it first — see `Clip`).
 * Closes on outside click, Escape, scroll, or after running an item.
 */
export function ClipContextMenu() {
  const pos = useTimelineViewStore((s) => s.clipContextMenu);
  const close = () => useTimelineViewStore.getState().setClipContextMenu(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ x: number; y: number } | null>(null);

  // Keep the menu on-screen when opened near the right/bottom edge.
  useLayoutEffect(() => {
    if (!pos) {
      setPlaced(null);
      return;
    }
    const el = menuRef.current;
    const w = el?.offsetWidth ?? 240;
    const h = el?.offsetHeight ?? 320;
    setPlaced({
      x: Math.max(8, Math.min(pos.x, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(pos.y, window.innerHeight - h - 8)),
    });
  }, [pos]);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('blur', close);
    };
  }, [pos]);

  if (!pos) return null;

  const s = useTimelineStore.getState();
  const project = s.currentProject;
  const ids = new Set(s.selectedClipIds);
  const selectedClips = (project?.tracks ?? []).flatMap((t) =>
    t.clips.filter((c) => ids.has(c.id)),
  );
  const playhead = s.playheadPosition;
  const underPlayhead = selectedClips.some(
    (c) => playhead > c.startOffset && playhead < c.startOffset + c.duration,
  );
  const joinReason = joinBlocker();
  const groupIds = new Set(
    selectedClips.map((c) => c.groupId).filter((g): g is string => !!g),
  );
  const noPlayhead = 'Move the playhead over the clip first.';
  const baseClips = project ? baseTrackClips(project) : [];
  const single = selectedClips.length === 1 ? selectedClips[0] : undefined;
  const singleOnBase = single
    ? baseClips.find((c) => c.id === single.id)
    : undefined;
  const transitionTarget =
    singleOnBase && previousTouching(baseClips, singleOnBase)
      ? singleOnBase.id
      : null;

  const sections: Item[][] = [
    [
      {
        label: 'Split at Playhead',
        icon: <ScissorsIcon />,
        shortcut: 'S',
        disabled: !underPlayhead,
        hint: underPlayhead ? undefined : noPlayhead,
        action: splitSelection,
      },
      {
        label: 'Trim Start to Playhead',
        icon: <ArrowLeftToLineIcon />,
        shortcut: 'Q',
        disabled: !underPlayhead,
        hint: underPlayhead ? undefined : noPlayhead,
        action: () => trimSelectionToPlayhead('start', false),
      },
      {
        label: 'Trim End to Playhead',
        icon: <ArrowRightToLineIcon />,
        shortcut: 'W',
        disabled: !underPlayhead,
        hint: underPlayhead ? undefined : noPlayhead,
        action: () => trimSelectionToPlayhead('end', false),
      },
      {
        label: 'Add Transition In',
        icon: <BlendIcon />,
        shortcut: `${MOD}D`,
        disabled: transitionTarget === null,
        hint: transitionTarget ? undefined : 'Only for a V1 clip touching the previous clip.',
        action: () => {
          if (transitionTarget) addTransitionInto(transitionTarget);
        },
      },
      {
        label: 'Join Clips',
        icon: <CombineIcon />,
        shortcut: `${MOD}J`,
        disabled: joinReason !== null,
        hint: joinReason ?? undefined,
        action: joinSelection,
      },
    ],
    [
      {
        label: 'Copy',
        icon: <ClipboardCopyIcon />,
        shortcut: `${MOD}C`,
        action: () => s.copyClipsToClipboard(s.selectedClipIds),
      },
      selectedClips.length > 1 && groupIds.size !== 1
        ? {
            label: 'Group',
            icon: <Link2Icon />,
            shortcut: `${MOD}G`,
            action: () => s.groupClips(s.selectedClipIds),
          }
        : {
            label: 'Ungroup',
            icon: <Link2OffIcon />,
            shortcut: `⇧${MOD}G`,
            disabled: groupIds.size === 0,
            action: () => {
              for (const g of groupIds) s.ungroupClips(g);
            },
          },
      {
        label: 'Close Gaps on Track',
        icon: <BetweenHorizontalStartIcon />,
        action: closeGapsForSelection,
      },
      {
        label: 'Show in Media',
        icon: <FolderInputIcon />,
        disabled: selectedClips.length !== 1 || !selectedClips[0]?.mediaId,
        action: revealSelectionInMedia,
      },
    ],
    [
      {
        label: 'Delete',
        icon: <Trash2Icon />,
        shortcut: '⌫',
        danger: true,
        action: () => deleteSelection(false),
      },
      {
        label: 'Ripple Delete',
        icon: <Trash2Icon />,
        shortcut: '⇧⌫',
        danger: true,
        action: () => deleteSelection(true),
      },
    ],
  ];

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 w-64 rounded-lg border border-border bg-panel-elevated p-1 text-[12px] shadow-2xl"
      style={{
        left: placed?.x ?? pos.x,
        top: placed?.y ?? pos.y,
        visibility: placed ? 'visible' : 'hidden',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {sections.map((items, i) => (
        <div
          key={i}
          className={i > 0 ? 'mt-1 border-t border-border pt-1' : undefined}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.hint}
              onClick={() => {
                close();
                item.action();
              }}
              className={
                item.danger
                  ? 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-danger transition hover:bg-danger/10 disabled:opacity-40'
                  : 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-primary transition hover:bg-chrome disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'
              }
            >
              <span className="flex size-4 items-center justify-center [&>svg]:size-4">
                {item.icon}
              </span>
              <span className="flex-1">
                {item.label}
                {item.disabled && item.hint ? (
                  <span className="block text-[10px] leading-tight text-text-muted">
                    {item.hint}
                  </span>
                ) : null}
              </span>
              {item.shortcut ? (
                <span className="font-mono text-[11px] text-text-muted">
                  {item.shortcut}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
