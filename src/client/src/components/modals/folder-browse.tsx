'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface BrowseData {
  current: string;
  parent: string | null;
  entries: string[];
}

export interface FolderBrowseProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Directory to start browsing from (defaults to the user's home dir). */
  initialDir?: string;
  /** Called with the chosen absolute directory path. */
  onPick?: (dir: string) => void;
  title?: string;
}

/**
 * Server-side folder browser (legacy parity): navigates `/api/fs/browse` and
 * lets the user pick a directory via "Use this folder".
 */
export function FolderBrowse({
  open,
  onOpenChange,
  initialDir,
  onPick,
  title = 'Browse Folder',
}: FolderBrowseProps) {
  const [dir, setDir] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (d: string | null | undefined) => {
    setLoading(true);
    setError('');
    try {
      const url = '/api/fs/browse' + (d ? `?dir=${encodeURIComponent(d)}` : '');
      const res = await fetch(url);
      const data = (await res.json()) as BrowseData & { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDir(data.current);
      setCurrent(data.current);
      setParent(data.parent);
      setEntries(data.entries);
    } catch (e) {
      setError((e as Error).message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void load(initialDir);
    }
  }, [open, initialDir, load]);

  const join = (base: string, name: string) =>
    `${base}/${name}`.replace(/\\/g, '/');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <div className="truncate rounded-md bg-[#21262d] px-2 py-1.5 font-mono text-xs text-muted-foreground" title={current}>
            {current || '…'}
          </div>
          {error && <div className="text-xs text-[#f85149]">Error: {error}</div>}
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-[#21262d]/40">
            <div className="p-1">
              {parent && (
                <button
                  type="button"
                  className="w-full rounded px-2 py-1 text-left text-xs transition-colors hover:bg-[#21262d]"
                  onClick={() => void load(parent)}
                >
                  ↑ .. (up)
                </button>
              )}
              {entries.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="w-full truncate rounded px-2 py-1 text-left text-xs transition-colors hover:bg-[#21262d]"
                  title={join(dir || '', name)}
                  onClick={() => void load(join(dir || '', name))}
                >
                  ▸ {name}
                </button>
              ))}
              {!parent && entries.length === 0 && !loading && !error && (
                <div className="px-2 py-1 text-xs text-muted-foreground">(empty)</div>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange?.(false)}>
            Cancel
          </Button>
          <Button
            disabled={!dir}
            onClick={() => dir && onPick?.(dir)}
            className="bg-[#d4760a] text-white hover:bg-[#e08a2a]"
          >
            Use this folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
