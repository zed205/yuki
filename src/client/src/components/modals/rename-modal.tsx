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
import { FolderBrowse } from '@/components/modals/folder-browse';

export interface RenameModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  currentValue?: string;
  /** Optional directory (projects only) — shown when `allowPath` is set. */
  currentPath?: string;
  allowPath?: boolean;
  pathPlaceholder?: string;
  onSave?: (newValue: string, path?: string) => void;
  placeholder?: string;
}

export function RenameModal(props: RenameModalProps) {
  const [value, setValue] = useState(props.currentValue || '');
  const [path, setPath] = useState(props.currentPath || '');
  const [error, setError] = useState('');
  const [browseOpen, setBrowseOpen] = useState(false);

  // Reset value when the modal opens
  useEffect(() => {
    if (props.open) {
      setValue(props.currentValue || '');
      setPath(props.currentPath || '');
      setError('');
      setBrowseOpen(false);
    }
  }, [props.open, props.currentValue, props.currentPath]);

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
    const trimmedPath = props.allowPath ? path.trim() : undefined;
    props.onSave?.(trimmed, trimmedPath);
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

  // Legacy parity: prefer the native directory picker (showDirectoryPicker),
  // falling back to the server-side folder browser when it's unavailable.
  const handleBrowse = async () => {
    const picker = (window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: string }) => Promise<{ path?: string; name: string }>;
    }).showDirectoryPicker;
    if (typeof picker === 'function') {
      try {
        const handle = await picker.call(window, { mode: 'readonly' });
        const dir = handle?.path || handle?.name || '';
        if (dir) {
          setPath(dir);
          return;
        }
      } catch {
        // Cancelled or unsupported → fall through to the folder browser.
      }
    }
    setBrowseOpen(true);
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
          {error && <p className="text-xs text-destructive">{error}</p>}
          {props.allowPath && (
            <div className="mt-2">
              <label className="mb-1 block text-xs text-muted-foreground">
                Directory (optional)
              </label>
              <div className="flex gap-2">
                <Input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder={props.pathPlaceholder || 'Directory (leave empty to keep current)'}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleBrowse()}
                >
                  Browse…
                </Button>
              </div>
            </div>
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

      <FolderBrowse
        open={browseOpen}
        initialDir={path || undefined}
        onOpenChange={setBrowseOpen}
        onPick={(dir) => {
          setPath(dir);
          setBrowseOpen(false);
        }}
      />
    </Dialog>
  );
}
