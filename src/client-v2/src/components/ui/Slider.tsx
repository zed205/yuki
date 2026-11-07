import { JSX } from 'solid-js';

interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: number) => void;
  class?: string;
  disabled?: boolean;
  label?: string;
}

export function Slider(props: SliderProps) {
  const [local, rest] = splitProps(props, ['value', 'min', 'max', 'step', 'onChange', 'class', 'disabled', 'label']);

  return (
    <div class={`flex items-center gap-3 ${local.class ?? ''}`}>
      {local.label && (
        <span class="text-xs text-muted-foreground whitespace-nowrap">
          {local.label}
        </span>
      )}
      <input
        type="range"
        min={local.min ?? 0}
        max={local.max ?? 100}
        step={local.step ?? 1}
        value={local.value}
        disabled={local.disabled}
        class={`
          h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--secondary)]
          disabled:pointer-events-none disabled:opacity-50
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--primary)]
          [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow
          [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-[var(--primary)] [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer
        `}
        onInput={(e) => local.onChange?.(Number(e.currentTarget.value))}
        {...rest}
      />
    </div>
  );
}
