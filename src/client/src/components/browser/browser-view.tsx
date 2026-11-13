'use client';

import { useEffect, useState } from 'react';
import { useBrowser } from '@/context/browser-context';
import { useWebSocket } from '@/context/websocket-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Browser panel (legacy `#browser-panel` parity): a floating 700x500 window,
 * bottom-right. The server runs a real Playwright browser driven by the
 * agent; this panel shows a screenshot of it. "Go" issues the navigation as a
 * chat instruction (`Navigate to {url}`); the camera button fetches the latest
 * server screenshot.
 */
export function BrowserView() {
  const browser = useBrowser();
  const { send } = useWebSocket();
  const [inputValue, setInputValue] = useState(browser.url || '');

  // Refresh the screenshot whenever the panel is opened.
  useEffect(() => {
    if (browser.visible) void browser.takeScreenshot();
  }, [browser.visible, browser.takeScreenshot]);

  // Auto-open when the agent uses a browser tool (dispatched by session context).
  useEffect(() => {
    const onBrowserTool = () => browser.setVisible(true);
    window.addEventListener('yukiweb:browser-tool', onBrowserTool);
    return () => window.removeEventListener('yukiweb:browser-tool', onBrowserTool);
  }, [browser.setVisible]);

  if (!browser.visible) return null;

  const handleGo = () => {
    const url = inputValue.trim();
    if (!url) return;
    browser.setUrl(url);
    send('chat:message', { message: `Navigate to ${url}` });
  };

  return (
    <div className="fixed bottom-24 right-4 z-50 flex h-[500px] max-h-[80vh] w-[700px] max-w-[95vw] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-3 py-2">
        <h2 className="text-sm font-semibold">Browser</h2>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleGo();
            }}
            placeholder="Enter URL"
            className="h-7 w-40 text-xs"
          />
          <Button size="sm" className="h-7 px-3 text-xs" onClick={handleGo}>
            Go
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            title="Take screenshot"
            disabled={browser.isLoading}
            onClick={() => void browser.takeScreenshot()}
          >
            📷
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-3 text-xs hover:border-red-500 hover:text-red-500"
            onClick={browser.closeBrowser}
          >
            Close
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="relative flex-1 overflow-hidden bg-background">
        {browser.error ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-red-500">
            {browser.error}
          </div>
        ) : browser.screenshot ? (
          <img
            src={browser.screenshot}
            alt="Browser screenshot"
            className="h-full w-full object-contain"
          />
        ) : browser.isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Taking screenshot…
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
            No screenshot yet — press 📷 or ask Yuki to browse a page.
          </div>
        )}
      </div>
    </div>
  );
}
