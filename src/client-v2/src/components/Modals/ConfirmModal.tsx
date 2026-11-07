import { Show } from 'solid-js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';

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
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>{props.title || 'Confirm'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Text size="sm" class="text-muted-foreground leading-relaxed">
            {props.message}
          </Text>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => props.onOpenChange?.(false)}
          >
            {props.cancelText || 'Cancel'}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'default'}
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
