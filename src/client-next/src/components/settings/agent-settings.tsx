'use client';

import { useState } from 'react';
import { useSession } from '@/context/session-context';
import { Text } from '@/components/ui/box';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 p-3">
      <div>
        <Text size="sm" weight="medium">
          {title}
        </Text>
        <Text size="xs" className="text-muted-foreground">
          {description}
        </Text>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/**
 * Agent settings: model choice (live from server), sampling sliders, and
 * behavior toggles.
 */
export function AgentSettings() {
  const { models, activeModel, switchModel, thinkingEnabled, setThinkingEnabled } =
    useSession();
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [streaming, setStreaming] = useState(true);
  const [enableToolUse, setEnableToolUse] = useState(true);
  const [contextWindow, setContextWindow] = useState(8192);

  return (
    <div className="space-y-6">
      {/* Model Selection */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Model
        </Text>
        {models.length > 0 ? (
          <Select value={activeModel || undefined} onValueChange={(v) => switchModel(v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((model) => (
                <SelectItem key={model.name} value={model.name}>
                  {model.displayName || model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Text size="xs" className="text-muted-foreground">
            No models reported by the server yet.
          </Text>
        )}
      </div>

      {/* Temperature */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Temperature
        </Text>
        <div className="space-y-3 rounded-lg border border-border bg-muted/50 p-3">
          <div className="flex items-center justify-between">
            <Text size="sm">Creativity (Temperature)</Text>
            <Text size="xs" className="text-muted-foreground">
              {temperature.toFixed(2)}
            </Text>
          </div>
          <Slider
            value={[temperature]}
            min={0}
            max={2}
            step={0.01}
            onValueChange={([v]) => setTemperature(v)}
          />
          <Text size="xs" className="text-muted-foreground">
            0 = deterministic, 1 = balanced, 2 = highly creative
          </Text>
        </div>
      </div>

      {/* Top P */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Top P
        </Text>
        <div className="space-y-3 rounded-lg border border-border bg-muted/50 p-3">
          <div className="flex items-center justify-between">
            <Text size="sm">Nucleus Sampling</Text>
            <Text size="xs" className="text-muted-foreground">
              {topP.toFixed(2)}
            </Text>
          </div>
          <Slider
            value={[topP]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={([v]) => setTopP(v)}
          />
        </div>
      </div>

      {/* Max Tokens */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Max Tokens
        </Text>
        <Select value={String(maxTokens)} onValueChange={(v) => setMaxTokens(parseInt(v, 10))}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1024">1,024 (short responses)</SelectItem>
            <SelectItem value="2048">2,048 (moderate)</SelectItem>
            <SelectItem value="4096">4,096 (default)</SelectItem>
            <SelectItem value="8192">8,192 (long)</SelectItem>
            <SelectItem value="16384">16,384 (very long)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Context Window */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Context Window
        </Text>
        <Select value={String(contextWindow)} onValueChange={(v) => setContextWindow(parseInt(v, 10))}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="4096">4,096 (limited)</SelectItem>
            <SelectItem value="8192">8,192 (balanced)</SelectItem>
            <SelectItem value="16384">16,384 (extended)</SelectItem>
            <SelectItem value="32768">32,768 (full)</SelectItem>
          </SelectContent>
        </Select>
        <Text size="xs" className="text-muted-foreground">
          Maximum tokens to use for conversation context
        </Text>
      </div>

      {/* Behavior */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Behavior
        </Text>
        <div className="space-y-2">
          <ToggleRow
            title="Streaming Responses"
            description="Show responses as they are generated"
            checked={streaming}
            onChange={setStreaming}
          />
          <ToggleRow
            title="Enable Reasoning"
            description="Allow the agent to use reasoning models"
            checked={thinkingEnabled}
            onChange={setThinkingEnabled}
          />
          <ToggleRow
            title="Tool Use"
            description="Allow the agent to use external tools"
            checked={enableToolUse}
            onChange={setEnableToolUse}
          />
        </div>
      </div>
    </div>
  );
}
