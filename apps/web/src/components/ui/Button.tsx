import clsx from 'clsx';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'default' | 'primary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconOnly?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ' +
  'disabled:cursor-not-allowed disabled:opacity-40';

const variants: Record<Variant, string> = {
  default:
    'bg-chrome text-text-primary border border-border hover:bg-border hover:border-border-strong',
  primary:
    'bg-accent text-white hover:bg-accent-hover active:bg-accent-active border border-transparent',
  ghost:
    'bg-transparent text-text-secondary hover:bg-chrome hover:text-text-primary border border-transparent',
  danger:
    'bg-transparent text-danger hover:bg-danger/10 border border-transparent',
};

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12px]',
  md: 'h-8 px-3 text-[13px]',
};

const iconOnlySizes: Record<Size, string> = {
  sm: 'h-7 w-7 p-0',
  md: 'h-8 w-8 p-0',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'default',
      size = 'md',
      icon,
      iconOnly,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={clsx(
          base,
          variants[variant],
          iconOnly ? iconOnlySizes[size] : sizes[size],
          className,
        )}
        {...rest}
      >
        {icon ? <span className="shrink-0 [&>svg]:size-4">{icon}</span> : null}
        {iconOnly ? null : children}
      </button>
    );
  },
);
