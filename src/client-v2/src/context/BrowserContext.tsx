import { createContext, useContext, JSX } from 'solid-js';
import { createSignal } from 'solid-js';

/**
 * BrowserContext — Manages browser view state.
 *
 * Provides signals for browser visibility, connection state, current URL,
 * view mode (iframe vs screenshot), and screenshot data.
 */

export type BrowserViewMode = 'iframe' | 'screenshot';

export interface ScreenshotResult {
  dataUrl: string;
  url: string;
  timestamp: string;
}

export interface BrowserContextValue {
  // Core state
  visible: boolean;
  connected: boolean;
  url: string;
  currentUrl: string;
  viewMode: BrowserViewMode;
  screenshot: ScreenshotResult | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setVisible: (v: boolean) => void;
  setConnected: (v: boolean) => void;
  setUrl: (url: string) => void;
  setViewMode: (mode: BrowserViewMode) => void;
  setScreenshot: (s: ScreenshotResult | null) => void;
  setLoading: (l: boolean) => void;
  setError: (e: string | null) => void;
  navigate: (url: string) => Promise<void>;
  takeScreenshot: () => Promise<void>;
  clearScreenshot: () => void;
  closeBrowser: () => void;
}

export type BrowserContextType = BrowserContextValue;

const BrowserContext = createContext<BrowserContextValue>();

export function BrowserProvider(props: { children: JSX.Element }) {
  const [visible, setVisible] = createSignal(false);
  const [connected, setConnected] = createSignal(false);
  const [url, setUrl] = createSignal('');
  const [currentUrl, setCurrentUrl] = createSignal('');
  const [viewMode, setViewMode] = createSignal<BrowserViewMode>('iframe');
  const [screenshot, setScreenshot] = createSignal<ScreenshotResult | null>(null);
  const [isLoading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function navigate(targetUrl: string) {
    let normalized = targetUrl;
    if (normalized && !normalized.match(/^https?:\/\//i)) {
      normalized = 'https://' + normalized;
    }
    setCurrentUrl(normalized);
    setUrl(normalized);
    setViewMode('iframe');
    setLoading(true);
    setError(null);
    setConnected(true);

    try {
      const res = await fetch('/api/browser/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Navigation failed: ${res.status}`);
      }
    } catch (err) {
      setConnected(false);
      setError(err instanceof Error ? err.message : 'Navigation failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function takeScreenshot() {
    setViewMode('screenshot');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/browser/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Screenshot failed: ${res.status}`);
      }
      const blob = await res.blob();
      const dataUrl = await blobToDataUrl(blob);
      setScreenshot({
        dataUrl,
        url: currentUrl(),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Screenshot failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  function clearScreenshot() {
    setScreenshot(null);
  }

  function closeBrowser() {
    setVisible(false);
    setConnected(false);
    setScreenshot(null);
    setLoading(false);
    setUrl('');
    setCurrentUrl('');
  }

  const value: BrowserContextValue = {
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
  };

  return (
    <BrowserContext.Provider value={value}>
      {props.children}
    </BrowserContext.Provider>
  );
}

export function useBrowser() {
  const ctx = useContext(BrowserContext);
  if (!ctx) {
    throw new Error('useBrowser must be used within a BrowserProvider');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
