import { createSignal, createEffect } from 'solid-js';
import { Box, Text, Input, Switch, Select } from '../ui';
import { cn } from '../../lib/utils';

export function ModelSettings() {
  const [apiKey, setApiKey] = createSignal('');
  const [apiUrl, setApiUrl] = createSignal('');
  const [useProxy, setUseProxy] = createSignal(false);
  const [proxyUrl, setProxyUrl] = createSignal('');
  const [timeout, setTimeout] = createSignal(30);
  const [retryAttempts, setRetryAttempts] = createSignal(3);

  const [saved, setSaved] = createSignal(false);

  createEffect(() => {
    // Load saved config
    const savedApiKey = localStorage.getItem('yuki_api_key');
    if (savedApiKey) setApiKey(savedApiKey);
    const savedApiUrl = localStorage.getItem('yuki_api_url');
    if (savedApiUrl) setApiUrl(savedApiUrl);
  });

  const handleSave = () => {
    localStorage.setItem('yuki_api_key', apiKey());
    localStorage.setItem('yuki_api_url', apiUrl());
    localStorage.setItem('yuki_proxy_url', proxyUrl());
    localStorage.setItem('yuki_timeout', timeout().toString());
    localStorage.setItem('yuki_retry', retryAttempts().toString());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setApiKey('');
    setApiUrl('');
    setUseProxy(false);
    setProxyUrl('');
    setTimeout(30);
    setRetryAttempts(3);
    localStorage.removeItem('yuki_api_key');
    localStorage.removeItem('yuki_api_url');
    localStorage.removeItem('yuki_proxy_url');
    localStorage.removeItem('yuki_timeout');
    localStorage.removeItem('yuki_retry');
  };

  return (
    <Box class="space-y-6">
      {/* API Configuration */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">API Configuration</Text>
        <div class="space-y-3">
          <div>
            <Text size="sm" weight="medium">API Key</Text>
            <Text size="xs" class="text-muted-foreground mb-1">
              Your OpenAI-compatible API key
            </Text>
            <Input
              type="password"
              value={apiKey()}
              onChange={(e) => setApiKey(e.currentTarget.value)}
              placeholder="sk-..."
              class="font-mono text-xs"
            />
          </div>
          <div>
            <Text size="sm" weight="medium">API Base URL</Text>
            <Text size="xs" class="text-muted-foreground mb-1">
              Custom API endpoint (optional)
            </Text>
            <Input
              value={apiUrl()}
              onChange={(e) => setApiUrl(e.currentTarget.value)}
              placeholder="https://api.openai.com/v1"
              class="text-xs"
            />
          </div>
        </div>
      </div>

      {/* Proxy */}
      <div class="space-y-3">
        <Box class="flex items-center justify-between p-3 rounded-lg bg-surface2/50 border border-border">
          <Box>
            <Text size="sm" weight="medium">Use Proxy</Text>
            <Text size="xs" class="text-muted-foreground">
              Route API requests through a proxy server
            </Text>
          </Box>
          <Switch
            checked={useProxy()}
            onChange={setUseProxy}
          />
        </Box>
        <Show when={useProxy()}>
          <div>
            <Input
              value={proxyUrl()}
              onChange={(e) => setProxyUrl(e.currentTarget.value)}
              placeholder="http://proxy.example.com:8080"
              class="text-xs"
            />
          </div>
        </Show>
      </div>

      {/* Timeout & Retry */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Network</Text>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <Text size="sm" weight="medium">Request Timeout (s)</Text>
            <Input
              type="number"
              value={timeout().toString()}
              onChange={(e) => setTimeout(parseInt(e.currentTarget.value) || 30)}
              min={5}
              max={300}
              class="text-xs mt-1"
            />
          </div>
          <div>
            <Text size="sm" weight="medium">Retry Attempts</Text>
            <Input
              type="number"
              value={retryAttempts().toString()}
              onChange={(e) => setRetryAttempts(parseInt(e.currentTarget.value) || 3)}
              min={0}
              max={10}
              class="text-xs mt-1"
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div class="flex gap-2 pt-2">
        <button
          class={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            'bg-primary text-primary-foreground hover:bg-primary/90'
          )}
          onClick={handleSave}
        >
          {saved() ? '✓ Saved' : 'Save Configuration'}
        </button>
        <button
          class="px-4 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:border-foreground/50 transition-colors"
          onClick={handleReset}
        >
          Reset to Defaults
        </button>
      </div>
    </Box>
  );
}
