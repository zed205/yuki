'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useBrowser } from '@/context/browser-context';
import { BrowserToolbar } from './browser-toolbar';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';

/**
 * Browser view container: floating panel with toolbar + iframe/screenshot.
 * React port of the SolidJS BrowserView.
 */
export function BrowserView() {
  const browser = useBrowser();
  const [isMounted, setIsMounted] = useState(false);

  // Animate mount to avoid flash
  useEffect(() => {
    const t = setTimeout(() => setIsMounted(true), 10);
    return () => clearTimeout(t);
  }, []);

  if (!browser.visible) return null;

  return (
    <div
      className={cn(
        'fixed bottom-0 right-0 z-40 flex h-[500px] max-h-[70vh] w-[800px] max-w-[90vw] flex-col',
        'rounded-tl-lg border-t border-r border-border bg-background shadow-2xl',
        'transition-all duration-200 ease-out',
        isMounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
      )}
    >
      <BrowserToolbar />

      <div className="relative flex-1 overflow-hidden">
        {/* Iframe mode */}
        {browser.viewMode === 'iframe' && (
          <>
            <iframe
              src={browser.url || 'about:blank'}
              title="Browser View"
              className="h-full w-full bg-background"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
              onLoad={() => browser.setLoading(false)}
              onError={() => {
                browser.setError('Failed to load page');
                browser.setLoading(false);
              }}
            />
            {browser.isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <span className="text-xs text-muted-foreground">Loading page...</span>
                </div>
              </div>
            )}
          </>
        )}

        {/* Screenshot mode */}
        {browser.viewMode === 'screenshot' && (
          <div className="flex h-full w-full flex-col items-center justify-center bg-muted">
            {browser.screenshot ? (
              <img
                src={browser.screenshot.dataUrl}
                alt="Browser screenshot"
                className="max-h-full max-w-full object-contain"
                onLoad={() => browser.setLoading(false)}
              />
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-xs text-muted-foreground">Taking screenshot...</span>
              </div>
            )}
          </div>
        )}

        {/* Error state */}
        {browser.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background">
            <Icon name="x" size={24} className="text-red-500" />
            <span className="text-sm text-red-500">{browser.error}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => browser.navigate(browser.url)}
            >
              <Icon name="refresh" size={14} className="mr-1" />
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
