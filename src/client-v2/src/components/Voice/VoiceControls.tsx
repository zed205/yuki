import { splitProps, Show, For } from 'solid-js';
import { useAudio } from '../../hooks/useAudio';
import { Slider } from '../ui/Slider';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';

/**
 * VoiceControls — Voice control sliders and buttons.
 *
 * Provides volume, speed, and voice selection controls.
 * Maps to the original voice settings pattern from app.js:
 * - Volume control → `AudioPlayer` volume
 * - Speed control → TTS playback speed
 * - Voice selection → TTS voice model selection
 */

interface VoiceControlsProps {
  class?: string;
}

export function VoiceControls(props: VoiceControlsProps) {
  const audio = useAudio();

  // Voice options for TTS voice selection
  const voiceOptions = [
    { value: 'default', label: 'Default' },
    { value: 'female-1', label: 'Female 1' },
    { value: 'male-1', label: 'Male 1' },
    { value: 'neural', label: 'Neural (Recommended)' },
  ];

  return (
    <div
      class={`
        flex flex-col gap-4 p-4
        border-t border-border bg-[var(--surface2)]
        ${props.class ?? ''}
      `}
    >
      {/* Section header */}
      <div class="flex items-center gap-2">
        <Icon icon="settings" class="text-muted-foreground" size={14} />
        <span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Voice Settings
        </span>
      </div>

      {/* Volume control */}
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Icon icon="volume" class="text-muted-foreground" size={14} />
            <span class="text-xs text-text">Volume</span>
          </div>
          <span class="text-xs text-muted-foreground font-mono">
            {Math.round(audio.state.volume * 100)}%
          </span>
        </div>
        <Slider
          value={Math.round(audio.state.volume * 100)}
          min={0}
          max={100}
          step={1}
          onChange={(v) => audio.setVolume(v / 100)}
          label=""
        />
      </div>

      {/* Speed control */}
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Icon icon="activity" class="text-muted-foreground" size={14} />
            <span class="text-xs text-text">Speed</span>
          </div>
          <span class="text-xs text-muted-foreground font-mono">
            {audio.state.speed.toFixed(1)}x
          </span>
        </div>
        <Slider
          value={Math.round(audio.state.speed * 100)}
          min={50}
          max={200}
          step={10}
          onChange={(v) => audio.setSpeed(v / 100)}
          label=""
        />
      </div>

      {/* Voice selection */}
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Icon icon="mic" class="text-muted-foreground" size={14} />
            <span class="text-xs text-text">Voice</span>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <For each={voiceOptions}>
            {(option) => (
              <Button
                variant={
                  audio.state.selectedVoice === option.value
                    ? 'primary'
                    : 'ghost'
                }
                size="sm"
                class="text-xs h-7"
                onClick={() => audio.setSelectedVoice(option.value)}
              >
                {option.label}
              </Button>
            )}
          </For>
        </div>
      </div>

      {/* Error display */}
      <Show when={audio.state.error}>
        <div class="flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--destructive)]/10 border border-[var(--destructive)]/20">
          <Icon icon="x" class="text-[var(--destructive)]" size={14} />
          <span class="text-xs text-[var(--destructive)]">
            {audio.state.error}
          </span>
        </div>
      </Show>
    </div>
  );
}
