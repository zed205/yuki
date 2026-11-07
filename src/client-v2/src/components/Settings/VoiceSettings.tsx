import { createSignal, For, Show } from 'solid-js';
import { Box, Text, Switch, Slider, Select } from '../ui';
import { cn } from '../../lib/utils';
import { useAudio } from '../../context/AudioContext';
import { useSession } from '../../context/SessionContext';
import { useToaster } from '../Toast/ToasterProvider';

export function VoiceSettings() {
  const {
    voiceMode,
    setVoiceMode,
    micEnabled,
    setMicEnabled,
    ttsEnabled,
    setTtsEnabled,
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

  const { success, error } = useToaster();

  const voices = [
    { value: 'default', label: 'Default' },
    { value: 'female-1', label: 'Female (Standard)' },
    { value: 'male-1', label: 'Male (Standard)' },
    { value: 'female-2', label: 'Female (Warm)' },
    { value: 'male-2', label: 'Male (Deep)' },
  ];

  return (
    <Box class="space-y-6">
      {/* Voice Mode */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Voice Mode</Text>
        <Box class="flex items-center justify-between p-3 rounded-lg bg-surface2/50 border border-border">
          <Box>
            <Text size="sm" weight="medium">Enable Voice Mode</Text>
            <Text size="xs" class="text-muted-foreground">
              Allow hands-free conversation with the AI agent
            </Text>
          </Box>
          <Switch
            checked={voiceMode()}
            onChange={setVoiceMode}
          />
        </Box>
        <Show when={voiceListening()}>
          <div class="flex items-center gap-2 p-2 rounded-lg bg-primary/10 border border-primary/20">
            <div class="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <Text size="xs" class="text-primary">Listening...</Text>
          </div>
        </Show>
      </div>

      {/* Microphone */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Microphone</Text>
        <Box class="flex items-center justify-between p-3 rounded-lg bg-surface2/50 border border-border">
          <Box>
            <Text size="sm" weight="medium">Always-On Microphone</Text>
            <Text size="xs" class="text-muted-foreground">
              Keep the microphone active for voice commands
            </Text>
          </Box>
          <Switch
            checked={micEnabled()}
            onChange={setMicEnabled}
          />
        </Box>
      </div>

      {/* Push-to-Talk */}
      <div class="space-y-3">
        <Box class="flex items-center justify-between p-3 rounded-lg bg-surface2/50 border border-border">
          <Box>
            <Text size="sm" weight="medium">Push-to-Talk</Text>
            <Text size="xs" class="text-muted-foreground">
              Hold a key to activate the microphone
            </Text>
          </Box>
          <Switch
            checked={pushToTalk()}
            onChange={setPushToTalk}
          />
        </Box>
      </div>

      {/* Text-to-Speech */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Text-to-Speech</Text>
        <Box class="flex items-center justify-between p-3 rounded-lg bg-surface2/50 border border-border">
          <Box>
            <Text size="sm" weight="medium">Enable TTS</Text>
            <Text size="xs" class="text-muted-foreground">
              Hear the AI's responses aloud
            </Text>
          </Box>
          <Switch
            checked={ttsEnabled()}
            onChange={setTtsEnabled}
          />
        </Box>
      </div>

      {/* Volume */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Volume</Text>
        <div class="p-3 rounded-lg bg-surface2/50 border border-border space-y-3">
          <div class="flex items-center justify-between">
            <Text size="sm">Output Volume</Text>
            <Text size="xs" class="text-muted-foreground">{Math.round(volume() * 100)}%</Text>
          </div>
          <Slider
            value={[volume()]}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => setVolume(v[0])}
          />
        </div>
      </div>

      {/* Speech Speed */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Speech Speed</Text>
        <div class="p-3 rounded-lg bg-surface2/50 border border-border space-y-3">
          <div class="flex items-center justify-between">
            <Text size="sm">Speed</Text>
            <Text size="xs" class="text-muted-foreground">{speed().toFixed(1)}x</Text>
          </div>
          <Slider
            value={[speed()]}
            min={0.5}
            max={2}
            step={0.1}
            onChange={(v) => setSpeed(v[0])}
          />
        </div>
      </div>

      {/* Voice Selection */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Voice</Text>
        <Select
          value={selectedVoice()}
          onChange={setSelectedVoice}
        >
          <For each={voices}>
            {(voice) => (
              <Select.Item value={voice.value}>
                {voice.label}
              </Select.Item>
            )}
          </For>
        </Select>
      </div>

      {/* Additional toggles */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Additional</Text>
        <Box class="space-y-2">
          <Box class="flex items-center justify-between p-3 rounded-lg bg-surface2/50 border border-border">
            <Box>
              <Text size="sm" weight="medium">Show Thinking</Text>
              <Text size="xs" class="text-muted-foreground">
                Display the AI's reasoning process
              </Text>
            </Box>
            <Switch
              checked={thinkingEnabled()}
              onChange={setThinkingEnabled}
            />
          </Box>
          <Box class="flex items-center justify-between p-3 rounded-lg bg-surface2/50 border border-border">
            <Box>
              <Text size="sm" weight="medium">Compact Mode</Text>
              <Text size="xs" class="text-muted-foreground">
                Show condensed message format
              </Text>
            </Box>
            <Switch
              checked={compactMode()}
              onChange={setCompactMode}
            />
          </Box>
          <Box class="flex items-center justify-between p-3 rounded-lg bg-surface2/50 border border-border">
            <Box>
              <Text size="sm" weight="medium">Desktop Notifications</Text>
              <Text size="xs" class="text-muted-foreground">
                Show notifications for completed tasks
              </Text>
            </Box>
            <Switch
              checked={notificationsEnabled()}
              onChange={setNotificationsEnabled}
            />
          </Box>
        </Box>
      </div>
    </Box>
  );
}
