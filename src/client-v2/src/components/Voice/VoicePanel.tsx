import { splitProps, Show, For } from 'solid-js';
import { useAudio } from '../../hooks/useAudio';
import { useVoiceStatus } from '../../hooks/useVoiceStatus';
import { Switch } from '../ui/Switch';
import { ActivityRing } from '../ui/ActivityRing';
import { Icon } from '../ui/Icon';
import type { VoiceStatusState } from '../../hooks/useVoiceStatus';

/**
 * VoicePanel — Voice controls panel.
 *
 * Displays the voice status indicator, status text, and toggle switches
 * for voice mode, microphone, and TTS. Maps to the original elements:
 * - `#voice-status` → Voice status container
 * - `#voice-status-dot` → ActivityRing status indicator
 * - `#voice-status-label` → Status text display
 * - `#options-voice-mode-btn` → Voice mode toggle
 * - `#options-mic-btn` → Microphone toggle
 * - `#options-tts-btn` → TTS toggle
 */

interface VoicePanelProps {
  compact?: boolean;
}

export function VoicePanel(props: VoicePanelProps) {
  const audio = useAudio();
  const voiceStatus = useVoiceStatus();
  const [local] = splitProps(props, ['compact']);

  // Voice status indicators with server-synced state
  const statusMessages: Record<VoiceStatusState, string> = {
    listening: 'Listening...',
    transcribing: 'Transcribing...',
    thinking: 'Waiting for Yuki...',
    speaking: 'Speaking...',
    error: 'Voice error',
    off: '',
  };

  // Color mapping for status dot
  function getStatusColorClass(state: VoiceStatusState): string {
    const colors: Record<VoiceStatusState, string> = {
      listening: 'bg-[var(--success)]',
      transcribing: 'bg-yellow-400',
      thinking: 'bg-yellow-400',
      speaking: 'bg-[var(--primary)]',
      error: 'bg-[var(--destructive)]',
      off: '',
    };
    return colors[state] || colors.off;
  }

  if (local.compact) {
    return (
      <div
        class="flex items-center gap-2 px-3 py-1.5 text-xs border-t border-border bg-[var(--surface2)]"
      >
        {/* Status dot */}
        <Show when={voiceStatus.isVisible()}>
          <div
            class={`w-2 h-2 rounded-full animate-pulse ${voiceStatus.getDotColorClass()}`}
          />
        </Show>

        {/* Status text */}
        <Show
          when={audio.state.voiceMode}
          fallback={
            <span class="text-muted-foreground">Voice off</span>
          }
        >
          <span class="text-muted-foreground">{voiceStatus.getLabel()}</span>
        </Show>
      </div>
    );
  }

  // Full panel view
  return (
    <div class="border-t border-border bg-[var(--surface2)]">
      {/* Voice status bar */}
      <div
        class={`
          flex items-center gap-2 px-4 py-2 text-xs
          transition-colors duration-150
        `}
        classList={{
          'bg-[var(--surface2)]': !voiceStatus.isVisible(),
          'bg-[var(--surface2)]/80': voiceStatus.isVisible(),
        }}
      >
        {/* Activity ring or dot */}
        <Show
          when={voiceStatus.isVisible()}
          fallback={
            <div
              class={`w-2 h-2 rounded-full ${
                audio.state.voiceMode
                  ? 'bg-[var(--primary)]'
                  : 'bg-muted'
              }`}
            />
          }
        >
          {() => {
            const state = voiceStatus.status().state;
            if (state === 'listening' || state === 'transcribing') {
              return (
                <ActivityRing
                  size={16}
                  strokeWidth={2}
                  class="text-[var(--primary)]"
                />
              );
            }
            return (
              <div
                class={`w-2 h-2 rounded-full animate-pulse ${getStatusColorClass(state)}`}
              />
            );
          }}
        </Show>

        {/* Status label */}
        <span
          class="text-muted-foreground"
          title={voiceStatus.isVisible() ? voiceStatus.getLabel() : undefined}
        >
          {voiceStatus.isVisible()
            ? voiceStatus.getLabel()
            : audio.state.voiceMode
              ? 'Voice mode active'
              : 'Voice mode off'}
        </span>

        {/* Spacer */}
        <div class="flex-1" />

        {/* Toggle switches */}
        <div class="flex items-center gap-3">
          {/* Voice mode toggle */}
          <label class="flex items-center gap-2 cursor-pointer group">
            <span class="text-xs text-muted-foreground group-hover:text-text transition-colors whitespace-nowrap">
              Voice
            </span>
            <Switch
              checked={audio.state.voiceMode}
              onChange={audio.toggleVoiceMode}
            />
          </label>

          {/* Microphone toggle */}
          <label class="flex items-center gap-2 cursor-pointer group">
            <span class="text-xs text-muted-foreground group-hover:text-text transition-colors whitespace-nowrap">
              Mic
            </span>
            <Switch
              checked={audio.state.mic}
              onChange={audio.toggleMic}
              disabled={!audio.state.voiceMode}
            />
          </label>

          {/* TTS toggle */}
          <label class="flex items-center gap-2 cursor-pointer group">
            <span class="text-xs text-muted-foreground group-hover:text-text transition-colors whitespace-nowrap">
              TTS
            </span>
            <Switch
              checked={audio.state.tts}
              onChange={audio.toggleTts}
              disabled={!audio.state.voiceMode}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
