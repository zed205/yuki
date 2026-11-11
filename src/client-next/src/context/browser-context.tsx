'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type BrowserViewMode = 'iframe' | 'screenshot';

export interface ScreenshotResult {
  dataUrl: string;
  url: string;
  timestamp: string;
}

export interface BrowserContextValue {
  visible: boolean;
  connected: boolean;
  url: string;
  currentUrl: string;
  viewMode: BrowserViewMode;
  screenshot: ScreenshotResult | null;
  isLoading: boolean;
  error: string | null;

  setVisible: (v: boolean) => void;
  setConnected: (v: boolean) => void;
  setUrl: (url: string) => void;
  setViewMode: (mode: BrowserViewMode) => void;
  setScreenshot: (s: ScreenshotResult | null) => void;
  setLoading: (l: boolean) => void;
  setError: (e: string | null) => void;
  navigate: (url: string) => void;
  takeScreenshot: () => Promise<void>;
  clearScreenshot: () => void;
  closeBrowser: () => void;
}

const BrowserContext = createContext<BrowserContextValue | null>(null);

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Browser view state. React port of the SolidJS BrowserContext.
 * Navigation updates the iframe URL directly; the server-side browser
 * (Playwright) is driven by the agent's browser tools, and screenshots
 * are fetched from GET /api/browser/screenshot.
 */
export function BrowserProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [connected, setConnected] = useState(false);
  const [url, setUrl] = useState('');
  const [currentUrl, setCurrentUrl] = useState('');
  const [viewMode, setViewMode] = useState<BrowserViewMode>('iframe');
  const [screenshot, setScreenshot] = useState<ScreenshotResult | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigate = useCallback((targetUrl: string) => {
    let normalized = targetUrl.trim();
    if (normalized && !normalized.match(/^https?:\/\//i)) {
      normalized = `https://${normalized}`;
    }
    setCurrentUrl(normalized);
    setUrl(normalized);
    setViewMode('iframe');
    setLoading(true);
    setError(null);
    setConnected(true);
  }, []);

  const takeScreenshot = useCallback(async () => {
    setViewMode('screenshot');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/browser/screenshot');
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Screenshot failed: ${res.status}`);
      }
      const blob = await res.blob();
      const dataUrl = await blobToDataUrl(blob);
      setScreenshot({
        dataUrl,
        url: currentUrl,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Screenshot failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentUrl]);

  const clearScreenshot = useCallback(() => setScreenshot(null), []);

  const closeBrowser = useCallback(() => {
    setVisible(false);
    setConnected(false);
    setScreenshot(null);
    setLoading(false);
    setUrl('');
    setCurrentUrl('');
  }, []);

  const value = useMemo<BrowserContextValue>(
    () => ({
      visible,
      connected,
      url,
      currentUrl,
      viewMode,
      screenshot,
      isLoading,
      error,
      setVisible,
      setConnected,
      setUrl,
      setViewMode,
      setScreenshot,
      setLoading,
      setError,
      navigate,
      takeScreenshot,
      clearScreenshot,
      closeBrowser,
    }),
    [
      visible, connected, url, currentUrl, viewMode, screenshot, isLoading,
      error, navigate, takeScreenshot, clearScreenshot, closeBrowser,
    ],
  );

  return <BrowserContext.Provider value={value}>{children}</BrowserContext.Provider>;
}

export function useBrowser() {
  const ctx = useContext(BrowserContext);
  if (!ctx) throw new Error('useBrowser must be used within a BrowserProvider');
  return ctx;
}
