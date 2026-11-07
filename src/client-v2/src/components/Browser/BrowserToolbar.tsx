import { splitProps, Show, createSignal, onMount } from 'solid-js';
import { useBrowser } from '../../context/BrowserContext';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Icon } from '../ui/Icon';

/**
 * BrowserToolbar — Browser navigation toolbar.
 *
 * Provides URL input, navigation controls, view mode toggles,
 * and close button. Maps to the original toolbar elements:
 * - `#browser-url` → URL input
 * - `#browser-go-btn` → Go button
 * - `#browser-screenshot-btn` → Screenshot button
 * - `#close-browser-btn` → Close button
 */

export function BrowserToolbar() {
  const browser = useBrowser();
  const [inputValue, setInputValue] = createSignal(browser.url() || '');

  // Sync input when URL changes externally
  onMount(() => {
    setInputValue(browser.url() || '');
  });

  function handleNavigate() {
    const url = inputValue().trim();
    if (url) {
      browser.navigateTo(url);
      browser.setVisible(true);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleNavigate();
    }
  }

  function handleScreenshot() {
    browser.takeScreenshot();
  }

  function handleClose() {
    browser.closeBrowser();
  }

  return (
    <div class="flex items-center gap-2 px-3 py-2 border-b border-border bg-[var(--surface2)]">
      {/* Navigation buttons */}
      <div class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          class="h-8 w-8 p-0"
          onClick={() => browser.setViewMode('iframe')}
          disabled={browser.isLoading()}
          title="Switch to iframe mode"
        >
          <Icon icon="globe" size={16} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-8 w-8 p-0"
          onClick={handleScreenshot}
          title="Take screenshot"
        >
          <Icon icon="camera" size={16} />
        </Button>
      </div>

      {/* URL input */}
      <div class="flex-1 flex items-center gap-2">
        <div class="flex-1 flex items-center rounded-md border border-border bg-[var(--background)] overflow-hidden">
          <div class="pl-2 text-muted-foreground">
            <Icon icon="globe" size={14} />
          </div>
          <Input
            type="url"
            value={inputValue()}
            onInput={(e) => setInputValue(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter URL..."
            class="border-0 bg-transparent focus-visible:ring-0 px-2 h-8"
          />
        </div>

        {/* Go button */}
        <Button
          variant="primary"
          size="sm"
          onClick={handleNavigate}
          disabled={browser.isLoading() || !inputValue().trim()}
          class="h-8 px-3 text-xs gap-1"
        >
          <Icon icon="arrow-right" size={14} />
          Go
        </Button>
      </div>

      {/* Close button */}
      <Button
        variant="ghost"
        size="sm"
        class="h-8 w-8 p-0 text-muted-foreground hover:text-[var(--destructive)]"
        onClick={handleClose}
        title="Close browser"
      >
        <Icon icon="x" size={16} />
      </Button>
    </div>
  );
}
