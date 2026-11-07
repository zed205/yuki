import { type Component, type ComponentProps, splitProps } from 'solid-js';
import { cn } from '../../lib/utils';

// =============================================================================
// Switch (Toggle) — shadcn/ui style switch
// =============================================================================

export interface SwitchProps extends Omit<ComponentProps<'input'>, 'type'> {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}

const Switch: Component<SwitchProps> = (props) => {
  const [rest, others] = splitProps(
    props,
    ['class', 'checked', 'onChange', 'disabled', 'id'],
  );

  return (
    <button
      type="button"
      role="switch"
      aria-checked={rest.checked ?? false}
      disabled={rest.disabled}
      class={cn(
        'peer inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer items-center rounded-full border-2',
        'border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-50',
        rest.checked
          ? 'bg-primary'
          : 'bg-input',
        rest.class,
      )}
      onClick={() => rest.onChange?.(!rest.checked)}
      {...others}
    >
      <span
        class={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0',
          'transition-transform',
          rest.checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
};

export default Switch;
