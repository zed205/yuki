import { type Component, type ComponentProps, splitProps } from 'solid-js';
import { cn } from '../../lib/utils';

// =============================================================================
// Input — shadcn/ui style text input
// =============================================================================

export interface InputProps extends ComponentProps<'input'> {
  error?: boolean;
}

const Input: Component<InputProps> = (props) => {
  const [rest, others] = splitProps(
    props,
    ['class', 'error', 'type', 'placeholder', 'value', 'onInput', 'disabled'],
  );

  return (
    <input
      type={rest.type}
      placeholder={rest.placeholder}
      disabled={rest.disabled}
      class={cn(
        'flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm',
        'ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        rest.error
          ? 'border-destructive focus-visible:ring-destructive'
          : 'border-input',
        rest.class,
      )}
      onInput={rest.onInput}
      {...others}
    />
  );
};

export default Input;
