'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useBrowser } from '@/context/browser-context';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/**
 * Browser navigation toolbar: URL input, go, screenshot, view mode, close.
 * React port of the SolidJS BrowserToolbar.
 */
export function BrowserToolbar() {
  const browser = useBrowser();
  const [inputValue, setInputValue] = useState(browser.url || '');

  // Sync input when URL changes externally
  useEffect(() => {
    setInputValue(browser.url || '');
  }, [browser.url]);

  const handleNavigate = () => {
    const url = inputValue.trim();
    if (url) {
      browser.navigate(url);
      browser.setVisible(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleNavigate();
    }
  };

  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2">
      {/* Navigation buttons */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => browser.setViewMode('iframe')}
          disabled={browser.isLoading}
          title="Switch to iframe mode"
        >
          <Icon name="globe" size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => void browser.takeScreenshot().catch(() => {})}
          title="Take screenshot"
        >
          <Icon name="camera" size={16} />
        </Button>
      </div>

      {/* URL input */}
      <div className="flex flex-1 items-center gap-2">
        <div className="flex flex-1 items-center overflow-hidden rounded-md border border-border bg-background">
          <div className="pl-2 text-muted-foreground">
            <Icon name="globe" size={14} />
          </div>
          <Input
            type="url"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter URL..."
            className="h-8 border-0 bg-transparent px-2 focus-visible:ring-0"
          />
        </div>
        <Button
          size="sm"
          onClick={handleNavigate}
          disabled={browser.isLoading || !inputValue.trim()}
          className="h-8 gap-1 px-3 text-xs"
        >
          <Icon name="arrow-right" size={14} />
          Go
        </Button>
      </div>

      {/* Close */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-red-500"
        onClick={browser.closeBrowser}
        title="Close browser"
      >
        <Icon name="x" size={16} />
      </Button>
    </div>
  );
}
