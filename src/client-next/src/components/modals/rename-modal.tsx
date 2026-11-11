'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface RenameModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  currentValue?: string;
  onSave?: (newValue: string) => void;
  placeholder?: string;
}

export function RenameModal(props: RenameModalProps) {
  const [value, setValue] = useState(props.currentValue || '');
  const [error, setError] = useState('');

  // Reset value when the modal opens
  useEffect(() => {
    if (props.open) {
      setValue(props.currentValue || '');
      setError('');
    }
  }, [props.open, props.currentValue]);

  const handleSave = () => {
    const trimmed = value.trim();
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{props.title || 'Rename'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5 py-2">
          <Input
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError('');
            }}
            onKeyDown={handleKeyDown}
            placeholder={props.placeholder || 'Enter new name...'}
            className={error ? 'border-destructive' : ''}
          />
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange?.(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!value.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
