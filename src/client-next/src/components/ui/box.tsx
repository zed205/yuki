import { type HTMLAttributes, type ElementType, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Box — polymorphic container (Solid <Box as=...> → React)
// ---------------------------------------------------------------------------

interface BoxProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
}

export function Box({ as: Tag = 'div', className, ...rest }: BoxProps) {
  const Component = Tag as ElementType;
  return <Component className={cn(className)} {...rest} />;
}

// ---------------------------------------------------------------------------
// Text — semantic text spans
// ---------------------------------------------------------------------------

interface TextProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'muted' | 'primary' | 'danger' | 'success';
  size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl';
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  truncate?: boolean;
  as?: ElementType;
  children?: ReactNode;
}

const VARIANT_CLASSES: Record<NonNullable<TextProps['variant']>, string> = {
  default: 'text-foreground',
  muted: 'text-muted-foreground',
  primary: 'text-primary',
  danger: 'text-destructive',
  success: 'text-green-500',
};

const SIZE_CLASSES: Record<NonNullable<TextProps['size']>, string> = {
  xs: 'text-[11px]',
  sm: 'text-xs',
  base: 'text-sm',
  lg: 'text-base',
  xl: 'text-lg',
};

const WEIGHT_CLASSES: Record<NonNullable<TextProps['weight']>, string> = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
};

export function Text({
  className,
  variant = 'default',
  size = 'base',
  weight = 'normal',
  truncate = false,
  as: Tag = 'span',
  ...rest
}: TextProps) {
  const Component = Tag as ElementType;
  return (
    <Component
      className={cn(
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        WEIGHT_CLASSES[weight],
        truncate && 'truncate',
        className,
      )}
      {...rest}
    />
  );
}
