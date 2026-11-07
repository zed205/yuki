import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';

/**
 * Configuration options for the scroll-to-bottom hook.
 */
export interface ScrollToBottomOptions {
  /** Whether to auto-scroll to bottom on new content (default: true) */
  enabled?: boolean;
  /** Minimum distance from bottom (in pixels) to consider "at bottom" (default: 50) */
  threshold?: number;
}

/**
 * Custom hook for managing scroll-to-bottom behavior in chat/message containers.
 *
 * Auto-scrolls to the bottom when:
 * - New messages arrive (unless user has scrolled up)
 * - The user scrolls to the bottom (pinned mode)
 * - Content is appended and user is already near bottom
 *
 * Does NOT auto-scroll when:
 * - User has scrolled up (more than `threshold` pixels from bottom)
 * - `enabled` is explicitly false
 *
 * @returns A tuple of [scrollContainerRef, isPinned, togglePin, scrollToBottom]
 */
export function useScrollToBottom(
  options: ScrollToBottomOptions = {}
): [
  (el: HTMLDivElement | null) => void,
  () => boolean,
  () => void,
  () => void,
] {
  const threshold = options.threshold ?? 50;
  const enabled = options.enabled ?? true;

  const [containerRef, setContainerRef] = createSignal<HTMLDivElement | null>(
    null
  );
  const [isPinned, setIsPinned] = createSignal(false);

  // Track whether the user is currently near the bottom
  const [userAtBottom, setUserAtBottom] = createSignal(true);

  function isAtBottom(el: HTMLElement) {
    const { scrollTop, scrollHeight, clientHeight } = el;
    return scrollHeight - scrollTop - clientHeight < threshold;
  }

  // Listen for scroll events on the container
  createEffect(() => {
    const el = containerRef();
    if (!el) return;

    const handleScroll = () => {
      setUserAtBottom(isAtBottom(el));
    };

    el.addEventListener('scroll', handleScroll, { passive: true });

    onCleanup(() => {
      el.removeEventListener('scroll', handleScroll);
    });
  });

  // Auto-scroll when content changes and user is at bottom (or pinned)
  createEffect(
    on(
      () => {
        const el = containerRef();
        if (!el) return;
        // Return scrollHeight as a signal dependency
        return el.scrollHeight;
      },
      () => {
        const el = containerRef();
        if (!el) return;
        if (!enabled) return;

        if (isPinned() || userAtBottom()) {
          scrollToBottom(el);
        }
      }
    )
  );

  function scrollToBottom(el?: HTMLDivElement) {
    const target = el ?? containerRef();
    if (!target) return;
    target.scrollTop = target.scrollHeight;
  }

  function togglePin() {
    setIsPinned((prev) => {
      const next = !prev;
      if (next) {
        scrollToBottom();
      }
      return next;
    });
  }

  return [setContainerRef, isPinned, togglePin, scrollToBottom];
}
