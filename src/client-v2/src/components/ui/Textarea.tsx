import { type Component, type ComponentProps, splitProps } from 'solid-js';
import { cn } from '../../lib/utils';

// =============================================================================
// Textarea — shadcn/ui style textarea
// =============================================================================

export interface TextareaProps extends ComponentProps<'textarea'> {}

const Textarea: Component<TextareaProps> = (props) => {
  const [rest, others] = splitProps(
    props,
    ['class', 'placeholder', 'disabled', 'rows'],
  );

  return (
    <textarea
      placeholder={rest.placeholder}
      disabled={rest.disabled}
      rows={rest.rows || 3}
      class={cn(
        'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
        'ring-offset-background placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        rest.class,
      )}
      {...others}
    />
  );
};

export default Textarea;
