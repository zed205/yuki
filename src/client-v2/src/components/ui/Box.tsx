import { type JSX, splitProps } from 'solid-js';
import { cn } from '../../lib/utils';

interface BoxProps extends JSX.HTMLAttributes<HTMLDivElement> {
  as?: keyof JSX.IntrinsicElements;
}

export function Box(props: BoxProps) {
  const { as: Tag = 'div', class: className, ...rest } = props;
  const [local, others] = splitProps(rest, ['class']);

  return (
    <Tag class={cn(local.class, className)} {...others} />
  );
}

interface TextProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'muted' | 'primary' | 'danger' | 'success';
  size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl';
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  truncate?: boolean;
}

export function Text(props: TextProps) {
  const {
    class: className,
    variant = 'default',
    size = 'base',
    weight = 'normal',
    truncate = false,
    ...rest
  } = props;
  const [local, others] = splitProps(rest, ['class']);

  const variantClasses = {
    default: 'text-foreground',
    muted: 'text-muted-foreground',
    primary: 'text-[hsl(var(--primary))]',
    danger: 'text-[hsl(var(--destructive))]',
    success: 'text-[hsl(var(--success))]',
  };

  const sizeClasses = {
    xs: 'text-[11px]',
    sm: 'text-xs',
    base: 'text-sm',
    lg: 'text-base',
    xl: 'text-lg',
  };

  const weightClasses = {
    normal: 'font-normal',
    medium: 'font-medium',
    semibold: 'font-semibold',
    bold: 'font-bold',
  };

  const truncateClass = truncate ? 'truncate' : '';

  return (
    <span
      class={cn(
        variantClasses[variant],
        sizeClasses[size],
        weightClasses[weight],
        truncateClass,
        local.class,
        className
      )}
      {...others}
    />
  );
}
