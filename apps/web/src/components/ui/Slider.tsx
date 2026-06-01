import * as SliderPrimitive from '@radix-ui/react-slider';
import clsx from 'clsx';

export interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 1,
  step = 0.01,
  disabled = false,
  className,
  ...rest
}: SliderProps) {
  return (
    <SliderPrimitive.Root
      value={[value]}
      onValueChange={(v) => v[0] !== undefined && onValueChange(v[0])}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={clsx(
        'relative flex h-5 w-full touch-none select-none items-center',
        disabled && 'opacity-40',
        className,
      )}
      aria-label={rest['aria-label']}
    >
      <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-chrome">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-accent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block size-3.5 rounded-full bg-text-primary shadow ring-2 ring-canvas transition focus-visible:outline-none focus-visible:ring-accent" />
    </SliderPrimitive.Root>
  );
}
