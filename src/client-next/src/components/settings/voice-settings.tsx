'use client';

import { cn } from '@/lib/utils';
import { useAudio } from '@/context/audio-context';
import { useSession } from '@/context/session-context';
import { useWebSocket } from '@/context/websocket-context';
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

const VOICES = [
  { value: 'default', label: 'Default' },
  { value: 'female-1', label: 'Female (Standard)' },
  { value: 'male-1', label: 'Male (Standard)' },
  { value: 'female-2', label: 'Female (Warm)' },
  { value: 'male-2', label: 'Male (Deep)' },
];

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

export function VoiceSettings() {
  const {
    voiceMode,
    setVoiceMode,
    micEnabled,
    setMic,
    ttsEnabled,
    setTts,
    pushToTalk,
    setPushToTalk,
    volume,
    setVolume,
    speed,
    setSpeed,
    selectedVoice,
    setSelectedVoice,
    voiceListening,
  } = useAudio();

  const {
    thinkingEnabled,
    setThinkingEnabled,
    compactMode,
    setCompactMode,
    notificationsEnabled,
    setNotificationsEnabled,
  } = useSession();
  const { send } = useWebSocket();

  const toggleAndSend = (
    wsType: string,
    getter: () => boolean,
    setter: (v: boolean) => void,
  ) => {
    const next = !getter();
    setter(next);
    send(wsType, { enabled: next });
  };

  return (
    <div className="space-y-6">
      {/* Voice Mode */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Voice Mode
        </Text>
        <ToggleRow
          title="Enable Voice Mode"
          description="Allow hands-free conversation with the AI agent"
          checked={voiceMode}
          onChange={(v) => toggleAndSend('voice:toggle', () => voiceMode, setVoiceMode)}
        />
        {voiceListening && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 p-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            <Text size="xs" variant="primary">
              Listening...
            </Text>
          </div>
        )}
      </div>

      {/* Microphone */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Microphone
        </Text>
        <ToggleRow
          title="Always-On Microphone"
          description="Keep the microphone active for voice commands"
          checked={micEnabled}
          onChange={(v) => toggleAndSend('mic:toggle', () => micEnabled, setMic)}
        />
      </div>

      {/* Push-to-Talk */}
      <div className="space-y-3">
        <ToggleRow
          title="Push-to-Talk"
          description="Hold a key to activate the microphone"
          checked={pushToTalk}
          onChange={(v) => toggleAndSend('pushToTalk:toggle', () => pushToTalk, setPushToTalk)}
        />
      </div>

      {/* Text-to-Speech */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Text-to-Speech
        </Text>
        <ToggleRow
          title="Enable TTS"
          description="Hear the AI's responses aloud"
          checked={ttsEnabled}
          onChange={(v) => toggleAndSend('tts:toggle', () => ttsEnabled, setTts)}
        />
      </div>

      {/* Volume */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Volume
        </Text>
        <div className="space-y-3 rounded-lg border border-border bg-muted/50 p-3">
          <div className="flex items-center justify-between">
            <Text size="sm">Output Volume</Text>
            <Text size="xs" className="text-muted-foreground">
              {Math.round(volume * 100)}%
            </Text>
          </div>
          <Slider value={[volume]} min={0} max={1} step={0.01} onValueChange={([v]) => setVolume(v)} />
        </div>
      </div>

      {/* Speech Speed */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Speech Speed
        </Text>
        <div className="space-y-3 rounded-lg border border-border bg-muted/50 p-3">
          <div className="flex items-center justify-between">
            <Text size="sm">Speed</Text>
            <Text size="xs" className="text-muted-foreground">
              {speed.toFixed(1)}x
            </Text>
          </div>
          <Slider value={[speed]} min={0.5} max={2} step={0.1} onValueChange={([v]) => setSpeed(v)} />
        </div>
      </div>

      {/* Voice Selection */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Voice
        </Text>
        <Select value={selectedVoice} onValueChange={setSelectedVoice}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VOICES.map((voice) => (
              <SelectItem key={voice.value} value={voice.value}>
                {voice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Additional toggles */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Additional
        </Text>
        <div className="space-y-2">
          <ToggleRow
            title="Show Thinking"
            description="Display the AI's reasoning process"
            checked={thinkingEnabled}
            onChange={(v) => {
              setThinkingEnabled(v);
              send('thinking:toggle', { enabled: v });
            }}
          />
          <ToggleRow
            title="Compact Mode"
            description="Show condensed message format"
            checked={compactMode}
            onChange={(v) => {
              setCompactMode(v);
              send('compact:toggle', { enabled: v });
            }}
          />
          <ToggleRow
            title="Desktop Notifications"
            description="Show notifications for completed tasks"
            checked={notificationsEnabled}
            onChange={(v) => {
              setNotificationsEnabled(v);
              send('notifications:toggle', { enabled: v });
            }}
          />
        </div>
      </div>
    </div>
  );
}
