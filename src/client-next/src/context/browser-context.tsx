'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface BrowserContextValue {
  visible: boolean;
  url: string;
  /** dataUrl of the latest server-side screenshot, or null. */
  screenshot: string | null;
  isLoading: boolean;
  error: string | null;

  setVisible: (v: boolean) => void;
  setUrl: (url: string) => void;
  takeScreenshot: () => Promise<void>;
  closeBrowser: () => void;
}

const BrowserContext = createContext<BrowserContextValue | null>(null);

/**
 * Browser panel state. The server runs a real browser (Playwright) that is
 * driven by the agent's browser tools; this panel only surfaces a screenshot
 * of it and lets the user issue navigation instructions as chat messages
 * (legacy `#browser-panel` parity).
 */
export function BrowserProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState('');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const takeScreenshot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/browser/screenshot');
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Screenshot failed: ${res.status}`);
      }
      const data = (await res.json()) as { screenshot?: string };
      if (data.screenshot) {
        setScreenshot(`data:image/png;base64,${data.screenshot}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Screenshot failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const closeBrowser = useCallback(() => {
    setVisible(false);
    setError(null);
  }, []);

  const value = useMemo<BrowserContextValue>(
    () => ({
      visible,
      url,
      screenshot,
      isLoading,
      error,
      setVisible,
      setUrl,
      takeScreenshot,
      closeBrowser,
    }),
    [visible, url, screenshot, isLoading, error, takeScreenshot, closeBrowser],
  );

  return <BrowserContext.Provider value={value}>{children}</BrowserContext.Provider>;
}

export function useBrowser() {
  const ctx = useContext(BrowserContext);
  if (!ctx) throw new Error('useBrowser must be used within a BrowserProvider');
  return ctx;
}
