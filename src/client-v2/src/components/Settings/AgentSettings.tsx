import { createSignal } from 'solid-js';
import { Box, Text, Switch, Slider, Select } from '../ui';

interface ModelOption {
  name: string;
  displayName: string;
  contextWindow: number;
}

const MODELS: ModelOption[] = [
  { name: 'gpt-4o', displayName: 'GPT-4o', contextWindow: 128000 },
  { name: 'gpt-4o-mini', displayName: 'GPT-4o Mini', contextWindow: 128000 },
  { name: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', contextWindow: 200000 },
  { name: 'claude-opus-4-20250514', displayName: 'Claude Opus 4', contextWindow: 200000 },
  { name: 'claude-haiku-4-20250514', displayName: 'Claude Haiku 3.5', contextWindow: 200000 },
  { name: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', contextWindow: 1000000 },
  { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', contextWindow: 1000000 },
  { name: 'qwen-plus', displayName: 'Qwen Plus', contextWindow: 131072 },
  { name: 'qwen-max', displayName: 'Qwen Max', contextWindow: 131072 },
  { name: 'qwen-turbo', displayName: 'Qwen Turbo', contextWindow: 131072 },
  { name: 'deepseek-v3', displayName: 'DeepSeek V3', contextWindow: 64000 },
  { name: 'deepseek-r1', displayName: 'DeepSeek R1', contextWindow: 64000 },
];

export function AgentSettings() {
  const [temperature, setTemperature] = createSignal(0.7);
  const [topP, setTopP] = createSignal(0.9);
  const [maxTokens, setMaxTokens] = createSignal(4096);
  const [streaming, setStreaming] = createSignal(true);
  const [enableReasoning, setEnableReasoning] = createSignal(false);
  const [enableToolUse, setEnableToolUse] = createSignal(true);
  const [contextWindow, setContextWindow] = createSignal(8192);

  return (
    <Box class="space-y-6">
      {/* Model Selection */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Model</Text>
        <Select
          value="gpt-4o"
          onChange={() => {}}
        >
          {MODELS.map((model) => (
            <Select.Item value={model.name}>
              <Box class="flex items-center justify-between w-full">
                <span>{model.displayName}</span>
                <span class="text-xs text-muted-foreground">
                  {model.contextWindow.toLocaleString()} tokens
                </span>
              </Box>
            </Select.Item>
          ))}
        </Select>
      </div>

      {/* Temperature */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Temperature</Text>
        <div class="p-3 rounded-lg bg-surface2/50 border border-border space-y-3">
          <div class="flex items-center justify-between">
            <Text size="sm">Creativity (Temperature)</Text>
            <Text size="xs" class="text-muted-foreground">{temperature().toFixed(2)}</Text>
          </div>
          <Slider
            value={[temperature()]}
            min={0}
            max={2}
            step={0.01}
            onChange={(v) => setTemperature(v[0])}
          />
          <Text size="xs" class="text-muted-foreground">
            0 = deterministic, 1 = balanced, 2 = highly creative
          </Text>
        </div>
      </div>

      {/* Top P */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Top P</Text>
        <div class="p-3 rounded-lg bg-surface2/50 border border-border space-y-3">
          <div class="flex items-center justify-between">
            <Text size="sm">Nucleus Sampling</Text>
            <Text size="xs" class="text-muted-foreground">{topP().toFixed(2)}</Text>
          </div>
          <Slider
            value={[topP()]}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => setTopP(v[0])}
          />
        </div>
      </div>

      {/* Max Tokens */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Max Tokens</Text>
        <Select
          value={maxTokens().toString()}
          onChange={(v) => setMaxTokens(parseInt(v))}
        >
          <Select.Item value="1024">1,024 (short responses)</Select.Item>
          <Select.Item value="2048">2,048 (moderate)</Select.Item>
          <Select.Item value="4096">4,096 (default)</Select.Item>
          <Select.Item value="8192">8,192 (long)</Select.Item>
          <Select.Item value="16384">16,384 (very long)</Select.Item>
        </Select>
      </div>

      {/* Context Window */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Context Window</Text>
        <Select
          value={contextWindow().toString()}
          onChange={(v) => setContextWindow(parseInt(v))}
        >
          <Select.Item value="4096">4,096 (limited)</Select.Item>
          <Select.Item value="8192">8,192 (balanced)</Select.Item>
          <Select.Item value="16384">16,384 (extended)</Select.Item>
          <Select.Item value="32768">32,768 (full)</Select.Item>
        </Select>
        <Text size="xs" class="text-muted-foreground">
          Maximum tokens to use for conversation context
        </Text>
      </div>

      {/* Switches */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Behavior</Text>
        <Box class="space-y-2">
          <Box class="flex items-center justify-between p-3 rounded-lg bg-surface2/50 border border-border">
            <Box>
              <Text size="sm" weight="medium">Streaming Responses</Text>
              <Text size="xs" class="text-muted-foreground">
                Show responses as they are generated
              </Text>
            </Box>
            <Switch
              checked={streaming}
              onChange={setStreaming}
            />
          </Box>
          <Box class="flex items-center justify-between p-3 rounded-lg bg-surface2/50 border border-border">
            <Box>
              <Text size="sm" weight="medium">Enable Reasoning</Text>
              <Text size="xs" class="text-muted-foreground">
                Allow the agent to use reasoning models
              </Text>
            </Box>
            <Switch
              checked={enableReasoning}
              onChange={setEnableReasoning}
            />
          </Box>
          <Box class="flex items-center justify-between p-3 rounded-lg bg-surface2/50 border border-border">
            <Box>
              <Text size="sm" weight="medium">Tool Use</Text>
              <Text size="xs" class="text-muted-foreground">
                Allow the agent to use external tools
              </Text>
            </Box>
            <Switch
              checked={enableToolUse}
              onChange={setEnableToolUse}
            />
          </Box>
        </Box>
      </div>
    </Box>
  );
}
