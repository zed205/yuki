'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ScrollToBottomOptions {
  /** Whether to auto-scroll to bottom on new content (default: true) */
  enabled?: boolean;
  /** Minimum distance from bottom (px) to consider "at bottom" (default: 50) */
  threshold?: number;
}

export interface ScrollToBottom {
  /** Attach to the scroll container element. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** User is pinned to bottom (sticky follow mode). */
  isPinned: boolean;
  togglePin: () => void;
  scrollToBottom: () => void;
}

/**
 * Scroll-to-bottom behavior for chat containers.
 *
 * Auto-scrolls on new content when the user is at (or pinned to) the bottom;
 * never yanks the view while the user is scrolled up.
 * React port of the SolidJS useScrollToBottom hook.
 */
export function useScrollToBottom(
  options: ScrollToBottomOptions = {},
): ScrollToBottom {
  const threshold = options.threshold ?? 50;
  const enabled = options.enabled ?? true;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const atBottomRef = useRef(true);
  const pinnedRef = useRef(false);
  pinnedRef.current = isPinned;

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const togglePin = useCallback(() => {
    setIsPinned((prev) => {
      const next = !prev;
      if (next) scrollToBottom();
      return next;
    });
  }, [scrollToBottom]);

  // Track user scroll position
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleScroll = () => {
      atBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [threshold]);

  // Auto-scroll when content grows and user is near (or pinned to) bottom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current || atBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  return { containerRef, isPinned, togglePin, scrollToBottom };
}
