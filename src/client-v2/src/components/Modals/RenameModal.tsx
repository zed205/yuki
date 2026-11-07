import { createSignal, createEffect, Show } from 'solid-js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Text } from '../ui/Box';

export interface RenameModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  currentValue?: string;
  onSave?: (newValue: string) => void;
  placeholder?: string;
}

export function RenameModal(props: RenameModalProps) {
  const [value, setValue] = createSignal(props.currentValue || '');
  const [error, setError] = createSignal('');

  // Reset value when modal opens
  createEffect(() => {
    if (props.open) {
      setValue(props.currentValue || '');
      setError('');
    }
  });

  const handleSave = () => {
    const trimmed = value().trim();
    if (!trimmed) {
      setError('Name cannot be empty');
      return;
    }
    if (trimmed.length > 100) {
      setError('Name must be less than 100 characters');
      return;
    }
    props.onSave?.(trimmed);
    props.onOpenChange?.(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      props.onOpenChange?.(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>{props.title || 'Rename'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Input
            value={value()}
            onChange={(e) => {
              setValue(e.currentTarget.value);
              setError('');
            }}
            onKeyDown={handleKeyDown}
            placeholder={props.placeholder || 'Enter new name...'}
            autofocus
            class={error() ? 'border-destructive' : ''}
          />
          <Show when={error()}>
            <Text size="xs" class="text-destructive mt-1">{error()}</Text>
          </Show>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => props.onOpenChange?.(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!value().trim()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
