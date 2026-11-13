'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/box';
import { useSession } from '@/context/session-context';

interface SearchResult {
  id: string;
  title?: string;
  snippet?: string;
  matchCount?: number;
  updatedAt?: string;
}

/**
 * Session search modal (legacy Ctrl+K / Search button): debounced
 * /api/sessions/search; rows with initial avatar, title, date + N hits,
 * snippet. Enter opens the first result, Esc closes, click switches.
 */
export function SearchModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { switchSession } = useSession();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      // Focus once the dialog is mounted.
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++seqRef.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/sessions/search?q=${encodeURIComponent(q)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as SearchResult[];
        if (seq === seqRef.current) setResults(data);
      } catch {
        /* ignore */
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const openSession = (id: string) => {
    onOpenChange(false);
    switchSession(id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="border-b border-border/50 px-4 py-3">
          <DialogTitle className="text-sm font-medium">
            Search sessions
          </DialogTitle>
        </DialogHeader>
        <div className="px-4 pt-3">
          <Input
            ref={inputRef}
            value={query}
            placeholder="Search sessions…"
            className="h-9"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results.length > 0) {
                openSession(results[0].id);
              }
            }}
          />
        </div>
        <div className="max-h-80 overflow-y-auto px-2 py-2">
          {searching && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              Searching…
            </div>
          )}
          {!searching && query.trim() && results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No sessions found
            </div>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              className="flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/60"
              onClick={() => openSession(r.id)}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-xs font-bold text-muted-foreground">
                {(r.title || '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <Text size="xs" weight="medium" className="truncate">
                    {r.title}
                  </Text>
                  <Text
                    size="xs"
                    className="shrink-0 text-muted-foreground"
                  >
                    {r.updatedAt
                      ? new Date(r.updatedAt).toLocaleDateString() + ' · '
                      : ''}
                    {r.matchCount ?? 0} hit{(r.matchCount ?? 0) === 1 ? '' : 's'}
                  </Text>
                </div>
                <Text
                  size="xs"
                  className="mt-0.5 truncate text-muted-foreground"
                >
                  {r.snippet || r.title}
                </Text>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
