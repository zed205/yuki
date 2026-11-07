import { type Component, type ComponentProps, splitProps } from 'solid-js';
import { cn } from '../../lib/utils';

// =============================================================================
// Badge — shadcn/ui style badge
// =============================================================================

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

export interface BadgeProps extends ComponentProps<'div'> {
  variant?: BadgeVariant;
}

const badgeVariants: Record<BadgeVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/80',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/80',
  outline: 'text-foreground border border-input',
};

const Badge: Component<BadgeProps> = (props) => {
  const [rest, others] = splitProps(
    props,
    ['class', 'variant', 'children'],
  );

  const variantClass = badgeVariants[rest.variant || 'default'];

  return (
    <div
      class={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        'transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        variantClass,
        rest.class,
      )}
      {...others}
    >
      {rest.children}
    </div>
  );
};

export default Badge;
