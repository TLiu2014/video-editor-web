import clsx from 'clsx';
import { useLayoutStore } from '../store/useLayoutStore';
import { useTimelineViewStore } from '../store/useTimelineViewStore';
import { ClipsSidebar } from './ClipsSidebar';
import { MediaLibrary } from './MediaLibrary';

/**
 * Left rail with two tabs: **Media** — the project's source library —
 * and **Clips** — every clip currently on the timeline, by track.
 */
export function LeftSidebar() {
  const tab = useTimelineViewStore((s) => s.sidebarTab);
  const setTab = useTimelineViewStore((s) => s.setSidebarTab);
  const width = useLayoutStore((s) => s.sidebarWidth);
  return (
    <aside
      className="no-select flex shrink-0 flex-col border-r border-border bg-panel"
      style={{ width }}
    >
      <div className="flex h-9 shrink-0 items-end gap-1 border-b border-border px-2">
        <TabButton active={tab === 'media'} onClick={() => setTab('media')}>
          Media
        </TabButton>
        <TabButton active={tab === 'clips'} onClick={() => setTab('clips')}>
          Clips
        </TabButton>
      </div>
      {tab === 'media' ? <MediaLibrary /> : <ClipsSidebar />}
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        '-mb-px rounded-t border-x border-t px-3 py-1.5 text-[12px] transition',
        active
          ? 'border-border bg-panel text-text-primary'
          : 'border-transparent text-text-muted hover:text-text-secondary',
      )}
    >
      {children}
    </button>
  );
}
