'use client';

import { useEffect, useState } from 'react';
import { useToaster } from '@/components/toast/toaster-provider';
import { Text } from '@/components/ui/box';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';

const STORAGE_KEYS = {
  apiKey: 'yuki_api_key',
  apiUrl: 'yuki_api_url',
  proxyUrl: 'yuki_proxy_url',
  timeout: 'yuki_timeout',
  retry: 'yuki_retry',
} as const;

/**
 * API connection settings (persisted to localStorage, as in the legacy client).
 */
export function ModelSettings() {
  const { showSuccess } = useToaster();
  const [apiKey, setApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [useProxy, setUseProxy] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');
  const [timeout, setTimeout_] = useState(30);
  const [retryAttempts, setRetryAttempts] = useState(3);
  const [saved, setSaved] = useState(false);

  // Load saved config
  useEffect(() => {
    try {
      setApiKey(localStorage.getItem(STORAGE_KEYS.apiKey) || '');
      setApiUrl(localStorage.getItem(STORAGE_KEYS.apiUrl) || '');
      setProxyUrl(localStorage.getItem(STORAGE_KEYS.proxyUrl) || '');
      const t = localStorage.getItem(STORAGE_KEYS.timeout);
      if (t) setTimeout_(parseInt(t, 10) || 30);
      const r = localStorage.getItem(STORAGE_KEYS.retry);
      if (r) setRetryAttempts(parseInt(r, 10) || 3);
    } catch {
      /* ignore */
    }
  }, []);

  const handleSave = () => {
    try {
      localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
      localStorage.setItem(STORAGE_KEYS.apiUrl, apiUrl);
      localStorage.setItem(STORAGE_KEYS.proxyUrl, proxyUrl);
      localStorage.setItem(STORAGE_KEYS.timeout, String(timeout));
      localStorage.setItem(STORAGE_KEYS.retry, String(retryAttempts));
      setSaved(true);
      showSuccess('Configuration saved');
      setTimeout(() => setSaved(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const handleReset = () => {
    setApiKey('');
    setApiUrl('');
    setUseProxy(false);
    setProxyUrl('');
    setTimeout_(30);
    setRetryAttempts(3);
    try {
      Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-6">
      {/* API Configuration */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          API Configuration
        </Text>
        <div className="space-y-3">
          <div>
            <Text size="sm" weight="medium">
              API Key
            </Text>
            <Text size="xs" className="mb-1 text-muted-foreground">
              Your OpenAI-compatible API key
            </Text>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="font-mono text-xs"
            />
          </div>
          <div>
            <Text size="sm" weight="medium">
              API Base URL
            </Text>
            <Text size="xs" className="mb-1 text-muted-foreground">
              Custom API endpoint (optional)
            </Text>
            <Input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="text-xs"
            />
          </div>
        </div>
      </div>

      {/* Proxy */}
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 p-3">
          <div>
            <Text size="sm" weight="medium">
              Use Proxy
            </Text>
            <Text size="xs" className="text-muted-foreground">
              Route API requests through a proxy server
            </Text>
          </div>
          <Switch checked={useProxy} onCheckedChange={setUseProxy} />
        </div>
        {useProxy && (
          <Input
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder="http://proxy.example.com:8080"
            className="text-xs"
          />
        )}
      </div>

      {/* Timeout & Retry */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Network
        </Text>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Text size="sm" weight="medium">
              Request Timeout (s)
            </Text>
            <Input
              type="number"
              value={String(timeout)}
              onChange={(e) => setTimeout_(parseInt(e.target.value, 10) || 30)}
              min={5}
              max={300}
              className="mt-1 text-xs"
            />
          </div>
          <div>
            <Text size="sm" weight="medium">
              Retry Attempts
            </Text>
            <Input
              type="number"
              value={String(retryAttempts)}
              onChange={(e) => setRetryAttempts(parseInt(e.target.value, 10) || 3)}
              min={0}
              max={10}
              className="mt-1 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button onClick={handleSave}>{saved ? '✓ Saved' : 'Save Configuration'}</Button>
        <Button variant="outline" onClick={handleReset}>
          Reset to Defaults
        </Button>
      </div>
    </div>
  );
}
