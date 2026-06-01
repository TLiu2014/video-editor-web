import * as Primitive from '@radix-ui/react-dropdown-menu';
import clsx from 'clsx';
import { ChevronDownIcon } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';

export const Root = Primitive.Root;
export const Portal = Primitive.Portal;

interface TriggerButtonProps {
  label: string;
  className?: string;
}

/**
 * Renders the menu's clickable trigger as a flat, toolbar-style
 * button with a small chevron indicator. Keep this looking unlike
 * the primary `Button` so menus visually read as "open me" rather
 * than "primary action."
 */
export const TriggerButton = forwardRef<HTMLButtonElement, TriggerButtonProps>(
  function TriggerButton({ label, className }, ref) {
    return (
      <Primitive.Trigger asChild>
        <button
          ref={ref}
          type="button"
          className={clsx(
            'inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[13px] font-medium text-text-secondary transition',
            'hover:bg-chrome hover:text-text-primary',
            'data-[state=open]:bg-chrome data-[state=open]:text-text-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
            className,
          )}
        >
          {label}
          <ChevronDownIcon className="size-3.5 opacity-60" />
        </button>
      </Primitive.Trigger>
    );
  },
);

export function Content({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align="start"
        sideOffset={6}
        className={clsx(
          'z-40 min-w-[14rem] overflow-hidden rounded-md border border-border bg-panel-elevated p-1 shadow-2xl',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          className,
        )}
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}

export interface ItemProps {
  onSelect?: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  /** Right-aligned shortcut hint, e.g. "⌘N". Display-only. */
  shortcut?: string;
  children: ReactNode;
}

export function Item({
  onSelect,
  disabled,
  icon,
  shortcut,
  children,
}: ItemProps) {
  return (
    <Primitive.Item
      disabled={disabled}
      onSelect={() => onSelect?.()}
      className={clsx(
        'group flex h-8 cursor-pointer items-center gap-2.5 rounded px-2 text-[13px] text-text-primary outline-none',
        'data-[highlighted]:bg-accent data-[highlighted]:text-white',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[disabled]:data-[highlighted]:bg-transparent data-[disabled]:data-[highlighted]:text-text-primary',
      )}
    >
      {icon ? (
        <span className="shrink-0 text-text-secondary group-data-[highlighted]:text-white [&>svg]:size-4">
          {icon}
        </span>
      ) : null}
      <span className="flex-1 truncate">{children}</span>
      {shortcut ? (
        <span className="font-mono text-[11px] text-text-muted group-data-[highlighted]:text-white/80">
          {shortcut}
        </span>
      ) : null}
    </Primitive.Item>
  );
}

export function Separator() {
  return (
    <Primitive.Separator className="my-1 h-px bg-border" />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <Primitive.Label className="px-2 py-1 text-[10px] uppercase tracking-wide text-text-muted">
      {children}
    </Primitive.Label>
  );
}
