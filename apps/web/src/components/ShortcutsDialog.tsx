import { SHORTCUT_GROUPS } from '../lib/shortcuts';
import { useDialogsStore } from '../store/useDialogsStore';
import { Dialog, DialogContent } from './ui/Dialog';

/** Keyboard shortcut reference sheet, opened with `?` or from the palette. */
export function ShortcutsDialog() {
  const open = useDialogsStore((s) => s.shortcuts);
  const setOpen = useDialogsStore((s) => s.setShortcuts);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        title="Keyboard shortcuts"
        description="Where a binding follows another editor, it's noted on the right."
        className="max-w-2xl"
      >
        <div className="grid max-h-[70vh] grid-cols-1 gap-x-8 gap-y-5 overflow-y-auto pr-1 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">
                {group.title}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {group.items.map((item) => (
                  <li
                    key={item.label}
                    className="flex items-baseline gap-3 text-[12px]"
                  >
                    <span className="flex shrink-0 gap-1">
                      {item.keys.map((k) => (
                        <kbd
                          key={k}
                          className="rounded border border-border bg-chrome px-1.5 py-0.5 font-mono text-[11px] text-text-primary"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                    <span className="min-w-0 flex-1 text-text-secondary">
                      {item.label}
                      {item.origin ? (
                        <span className="ml-1 text-[10px] text-text-muted">
                          · {item.origin}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
