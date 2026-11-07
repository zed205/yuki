import { splitProps, Show, createSignal } from 'solid-js';
import { useBrowser } from '../context/BrowserContext';
import { BrowserToolbar } from './BrowserToolbar';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

/**
 * BrowserView — Browser view container with iframe or screenshot display.
 *
 * Renders a full browser view panel showing either an interactive iframe
 * or a static screenshot. Uses BrowserContext for state management.
 *
 * Pattern: Maps to `#browser-view` from the original client.
 * - `#browser-image` → screenshot display
 * - iframe → interactive browser
 * - Toggle between view modes
 */

export function BrowserView() {
  const browser = useBrowser();
  const [isMounted, setIsMounted] = createSignal(false);

  // Animate mount to avoid flash
  setTimeout(() => setIsMounted(true), 10);

  if (!browser.visible()) return null;

  return (
    <div
      class={`
        fixed bottom-0 right-0 z-40 flex flex-col
        w-[800px] h-[500px] max-w-[90vw] max-h-[70vh]
        border-t border-r border-border bg-[var(--background)]
        shadow-2xl rounded-tl-lg
        transition-all duration-200 ease-out
        ${isMounted() ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}
      `}
    >
      {/* Toolbar */}
      <BrowserToolbar />

      {/* View content */}
      <div class="flex-1 relative overflow-hidden">
        {/* Iframe mode */}
        <Show when={browser.viewMode() === 'iframe'}>
          <iframe
            src={browser.url() || 'about:blank'}
            title="Browser View"
            class="w-full h-full bg-[var(--background)]"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            onLoad={() => browser.setLoading(false)}
            onError={() => {
              browser.setError('Failed to load page');
              browser.setLoading(false);
            }}
          />
          {/* Loading overlay */}
          <Show when={browser.isLoading()}>
            <div class="absolute inset-0 flex items-center justify-center bg-[var(--background)]/80 backdrop-blur-sm">
              <div class="flex flex-col items-center gap-3">
                <div class="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
                <span class="text-xs text-muted-foreground">Loading page...</span>
              </div>
            </div>
          </Show>
        </Show>

        {/* Screenshot mode */}
        <Show when={browser.viewMode() === 'screenshot'}>
          <div class="w-full h-full flex flex-col items-center justify-center bg-[var(--surface2)]">
            <Show when={browser.screenshot()} fallback={
              <div class="flex flex-col items-center gap-3">
                <div class="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
                <span class="text-xs text-muted-foreground">Taking screenshot...</span>
              </div>
            }>
              <img
                src={browser.screenshot() ?? ''}
                alt="Browser screenshot"
                class="max-w-full max-h-full object-contain"
                onLoad={() => browser.setLoading(false)}
              />
            </Show>
          </div>
        </Show>

        {/* Error state */}
        <Show when={browser.error()}>
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--background)]">
            <Icon icon="x" class="text-[var(--destructive)]" size={24} />
            <span class="text-sm text-[var(--destructive)]">{browser.error()}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => browser.navigateTo(browser.url())}
            >
              <Icon icon="refresh" class="mr-1" size={14} />
              Retry
            </Button>
          </div>
        </Show>
      </div>
    </div>
  );
}
