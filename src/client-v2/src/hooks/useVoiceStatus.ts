import { createSignal, createEffect } from 'solid-js';
import { useAudio } from './useAudio';

/**
 * VoiceStatus — Represents a discrete voice pipeline state.
 *
 * Mirrors the server-side voice states used in the original client:
 *   listening | transcribing | thinking | speaking | error | off
 */
export type VoiceStatusState = 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error' | 'off';

export interface VoiceStatusInfo {
  state: VoiceStatusState;
  detail: string;
}

/**
 * useVoiceStatus — Manages voice status state with reactive indicators.
 *
 * Provides status labels, dot colors, and visibility based on the
 * current voice pipeline phase. Integrates with the AudioContext for
 * live updates from the WebSocket server.
 */

interface VoiceStatusConfig {
  onStateChange?: (state: VoiceStatusState, detail: string) => void;
}

export function useVoiceStatus(config?: VoiceStatusConfig) {
  const audio = useAudio();

  const [status, setStatus] = createSignal<VoiceStatusInfo>({
    state: 'off',
    detail: '',
  });

  // Update status when audio listening/speaking changes
  createEffect(() => {
    if (audio.state.listening) {
      const newStatus: VoiceStatusInfo = { state: 'listening', detail: 'Listening...' };
      setStatus(newStatus);
      config?.onStateChange?.('listening', newStatus.detail);
    }
  });

  createEffect(() => {
    if (audio.state.speaking) {
      const newStatus: VoiceStatusInfo = { state: 'speaking', detail: 'Speaking...' };
      setStatus(newStatus);
      config?.onStateChange?.('speaking', newStatus.detail);
    }
  });

  createEffect(() => {
    if (audio.state.error) {
      const newStatus: VoiceStatusInfo = { state: 'error', detail: audio.state.error };
      setStatus(newStatus);
      config?.onStateChange?.('error', newStatus.detail);
    }
  });

  createEffect(() => {
    if (audio.state.voiceMode && !audio.state.listening && !audio.state.speaking && !audio.state.error) {
      const newStatus: VoiceStatusInfo = { state: 'thinking', detail: 'Waiting for Yuki...' };
      setStatus(newStatus);
      config?.onStateChange?.('thinking', newStatus.detail);
    }
  });

  /**
   * Set voice status directly (useful for server-initiated updates)
   */
  function setVoiceStatus(state: VoiceStatusState, detail?: string) {
    const info: VoiceStatusInfo = {
      state,
      detail: detail ?? getDefaultDetail(state),
    };
    setStatus(info);
    config?.onStateChange?.(state, info.detail);
  }

  /**
   * Check if the voice status bar should be visible
   */
  function isVisible() {
    return status().state !== 'off';
  }

  /**
   * Get the Tailwind color class for the status indicator dot
   */
  function getDotColorClass(): string {
    const colors: Record<VoiceStatusState, string> = {
      listening: 'bg-[var(--success)]',
      transcribing: 'bg-yellow-400',
      thinking: 'bg-yellow-400',
      speaking: 'bg-[var(--primary)]',
      error: 'bg-[var(--destructive)]',
      off: '',
    };
    return colors[status().state] || colors.off;
  }

  /**
   * Get the status label text
   */
  function getLabel(): string {
    return status().detail || getDefaultDetail(status().state);
  }

  /**
   * Get the CSS class for the status container (hidden when off)
   */
  function getContainerClass(): string {
    return status().state === 'off'
      ? 'hidden'
      : 'flex items-center gap-2 text-xs';
  }

  return {
    status,
    setVoiceStatus,
    isVisible,
    getDotColorClass,
    getLabel,
    getContainerClass,
  };
}

function getDefaultDetail(state: VoiceStatusState): string {
  const defaults: Record<VoiceStatusState, string> = {
    listening: 'Listening...',
    transcribing: 'Transcribing...',
    thinking: 'Waiting for Yuki...',
    speaking: 'Speaking...',
    error: 'Voice error',
    off: '',
  };
  return defaults[state] || '';
}
