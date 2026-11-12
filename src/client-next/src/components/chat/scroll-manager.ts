'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Legacy parity: only follow (pin the view to the bottom) while the user is
// within this many pixels of the bottom edge.
const FOLLOW_THRESHOLD_PX = 80;

export interface UseScrollToBottomOptions {
  /**
   * A value that changes whenever the transcript grows (e.g. the messages
   * array). When it changes we re-check whether to follow the new content —
   * mirrors the legacy `scrollToBottom()` calls made on every new chunk/message.
   */
  content?: unknown;
  /** Session id — when it changes we start pinned to the bottom of the new view. */
  resetKey?: string | null;
}

export interface ScrollToBottom {
  /** Attach to the scroll container element. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Whether the view is currently following (pinned to) the bottom. */
  isFollowing: boolean;
  /**
   * Scroll to the bottom. Pass force=true to jump unconditionally (e.g. the
   * user just sent a message) — mirrors the legacy `scrollToBottom(true)`.
   */
  scrollToBottom: (force?: boolean) => void;
}

/**
 * Smart-sticky scroll for the chat transcript (legacy parity):
 * - stays pinned to the bottom while the user is near it (<= threshold) and
 *   new content streams in;
 * - never yanks the view while the user has scrolled up;
 * - force-scrolls when the user sends a message or switches sessions.
 *
 * React port of the legacy `followScroll` / `scrollToBottom(force)` behavior
 * from src/client/app.js (no jump-to-bottom button, as in the legacy).
 */
export function useScrollToBottom(options?: UseScrollToBottomOptions): ScrollToBottom {
  const content = options?.content;
  const resetKey = options?.resetKey;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);
  const [isFollowing, setIsFollowing] = useState(true);

  const scrollToBottom = useCallback((force = false) => {
    const el = containerRef.current;
    if (!el) return;
    if (force || followRef.current) {
      el.scrollTop = el.scrollHeight;
      followRef.current = true;
      setIsFollowing(true);
    }
  }, []);

  // Track the user's scroll position: we only follow while near the bottom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const gap = el.scrollHeight - (el.scrollTop + el.clientHeight);
      const following = gap <= FOLLOW_THRESHOLD_PX;
      followRef.current = following;
      setIsFollowing(following);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [resetKey]);

  // Follow the stream: when the transcript grows, keep the view pinned if we
  // are following (legacy calls scrollToBottom() on each new chunk/message).
  useEffect(() => {
    if (followRef.current) scrollToBottom();
  }, [content, scrollToBottom]);

  // On session switch (resetKey change), start pinned to the bottom.
  useEffect(() => {
    followRef.current = true;
    setIsFollowing(true);
    // Defer until the new messages have rendered, then jump to the bottom.
    const raf = requestAnimationFrame(() => scrollToBottom(true));
    return () => cancelAnimationFrame(raf);
  }, [resetKey, scrollToBottom]);

  return { containerRef, isFollowing, scrollToBottom };
}
