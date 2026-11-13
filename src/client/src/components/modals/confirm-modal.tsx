'use client';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface ConfirmModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger';
  onConfirm?: () => void;
}

export function ConfirmModal(props: ConfirmModalProps) {
  const variant = props.variant || 'default';

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{props.title || 'Confirm'}</DialogTitle>
        </DialogHeader>
        <div className="text-sm leading-relaxed text-muted-foreground">
          {props.message}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => props.onOpenChange?.(false)}
          >
            {props.cancelText || 'Cancel'}
          </Button>
          <Button
            variant={variant === 'danger' ? 'destructive' : 'default'}
            onClick={() => {
              props.onConfirm?.();
              props.onOpenChange?.(false);
            }}
          >
            {props.confirmText || 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
