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

export interface AddProjectModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSave?: (name: string, path: string) => void;
}

/**
 * New Project modal (legacy parity): name + required directory with a
 * server-side folder browser.
 */
export function AddProjectModal({ open, onOpenChange, onSave }: AddProjectModalProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [browseOpen, setBrowseOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setPath('');
      setBrowseOpen(false);
    }
  }, [open]);

  const canSave = name.trim().length > 0 && path.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    onSave?.(name.trim(), path.trim());
    onOpenChange?.(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">New Project</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
            placeholder="Project name"
          />
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Directory (required)
            </label>
            <div className="flex gap-2">
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="e.g. D:\Projects\my-project"
                className="min-w-0 flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setBrowseOpen(true)}
              >
                Browse…
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange?.(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            onClick={save}
            className="bg-[#d4760a] text-white hover:bg-[#e08a2a] disabled:opacity-30"
          >
            Add
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
