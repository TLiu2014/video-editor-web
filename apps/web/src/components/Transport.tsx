import {
  CrosshairIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { formatTime, parseTime } from '../lib/formatTime';
import { computeProjectDuration } from '../lib/projectMetrics';
import { useTimelineStore } from '../store/useTimelineStore';
import { useTimelineViewStore } from '../store/useTimelineViewStore';
import { Button } from './ui/Button';

/**
 * Subscribe to playhead changes outside React's render cycle: the
 * value flips ~60 times per second during playback, but only the
 * time display needs to repaint. Using `useSyncExternalStore` keeps
 * this component opted into concurrent rendering correctness without
 * pulling the entire transport bar into the hot path.
 */
function usePlayhead(): number {
  return useSyncExternalStore(
    (cb) => useTimelineStore.subscribe((s) => s.playheadPosition, cb),
    () => useTimelineStore.getState().playheadPosition,
  );
}

export function Transport() {
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const project = useTimelineStore((s) => s.currentProject);
  const setPlaying = useTimelineStore((s) => s.setPlaying);
  const updatePlayhead = useTimelineStore((s) => s.updatePlayhead);
  const previewContentWidth = useTimelineViewStore(
    (s) => s.previewContentWidth,
  );
  const playhead = usePlayhead();

  const duration = project ? computeProjectDuration(project) : 0;
  const disabled = !project;

  const togglePlay = () => setPlaying(!isPlaying);
  const goToStart = () => updatePlayhead(0);
  const goToEnd = () => updatePlayhead(duration);

  // Mirror the preview frame's visible width so transport controls
  // sit underneath the video instead of stretching to the panel
  // width. Falls back to "auto" (full row) when the preview hasn't
  // measured yet.
  const innerStyle: React.CSSProperties =
    previewContentWidth > 0
      ? { width: previewContentWidth, maxWidth: '100%' }
      : {};

  return (
    <div className="no-select flex h-12 shrink-0 items-center justify-center border-t border-b border-border bg-panel px-4">
      <div
        className="flex h-full items-center justify-between"
        style={innerStyle}
      >
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={<SkipBackIcon />}
          disabled={disabled}
          onClick={goToStart}
          title="Go to start"
        />
        <Button
          variant="primary"
          size="sm"
          iconOnly
          icon={isPlaying ? <PauseIcon /> : <PlayIcon />}
          disabled={disabled}
          onClick={togglePlay}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        />
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={<SkipForwardIcon />}
          disabled={disabled}
          onClick={goToEnd}
          title="Go to end"
        />
      </div>

      <div className="flex items-center gap-2 font-mono text-[12px] tabular-nums text-text-secondary">
        <PlayheadInput playhead={playhead} duration={duration} disabled={disabled} />
        <span className="text-text-muted">/</span>
        <span>{formatTime(duration)}</span>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={<CrosshairIcon />}
          disabled={disabled}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent('timeline:scroll-to-time', {
                detail: { seconds: playhead },
              }),
            )
          }
          title="Bring playhead into view"
        />
      </div>
      </div>
    </div>
  );
}

/**
 * Inline editor for the playhead time. Display mode shows the
 * formatted time; entering edit mode (click or focus) reveals an
 * input that parses `ss`, `mm:ss(.cc)`, or `h:mm:ss(.cc)`. Enter
 * commits, Escape cancels. While the user is typing, we stop
 * mirroring the live playhead — otherwise the displayed value
 * would jump during playback.
 */
function PlayheadInput({
  playhead,
  duration,
  disabled,
}: {
  playhead: number;
  duration: number;
  disabled: boolean;
}) {
  const updatePlayhead = useTimelineStore((s) => s.updatePlayhead);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  // Keep the field's draft pinned to the latest playhead value
  // whenever we're NOT editing — otherwise the user's in-progress
  // text gets overwritten on every frame during playback.
  useEffect(() => {
    if (!editing) setDraft(formatTime(playhead));
  }, [playhead, editing]);

  const commit = () => {
    const parsed = parseTime(draft);
    if (parsed !== null) {
      const clamped = Math.max(0, duration > 0 ? Math.min(duration, parsed) : parsed);
      updatePlayhead(clamped);
    }
    setEditing(false);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={editing ? draft : formatTime(playhead)}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        if (disabled) return;
        setEditing(true);
        setDraft(formatTime(playhead));
        e.currentTarget.select();
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setEditing(false);
          setDraft(formatTime(playhead));
          e.currentTarget.blur();
        }
      }}
      disabled={disabled}
      className="w-[88px] cursor-text rounded border border-transparent bg-transparent px-1.5 py-0.5 text-right text-[12px] tabular-nums text-text-primary outline-none transition hover:border-border hover:bg-chrome/60 focus:border-accent focus:bg-chrome focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
      aria-label="Playhead time (editable)"
      title="Type a time to jump the playhead (mm:ss or h:mm:ss)"
    />
  );
}
