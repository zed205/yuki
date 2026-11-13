'use client';

import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './icon';

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon name (see ui/icon.tsx) or a ReactNode. */
  icon?: string | ReactNode;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'sm' | 'md';
  tooltip?: string;
}

const VARIANT_CLASSES: Record<NonNullable<IconButtonProps['variant']>, string> = {
  default: 'bg-secondary text-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-secondary text-muted-foreground hover:text-foreground',
  outline:
    'border border-border bg-transparent hover:bg-secondary text-muted-foreground hover:text-foreground',
};

const SIZE_CLASSES: Record<NonNullable<IconButtonProps['size']>, string> = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
};

export function IconButton({
  className,
  icon,
  variant = 'ghost',
  size = 'md',
  tooltip,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={tooltip}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-colors',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...rest}
    >
      {typeof icon === 'string' ? <Icon name={icon} size={16} /> : icon}
    </button>
  );
}
