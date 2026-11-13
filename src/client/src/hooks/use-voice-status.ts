'use client';

import { useMemo } from 'react';
import { useAudio } from '@/context/audio-context';

/**
 * Voice pipeline states (mirrors the server-side voice states):
 *   listening | transcribing | thinking | speaking | error | off
 */
export type VoiceStatusState =
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error'
  | 'off';

export interface VoiceStatusInfo {
  state: VoiceStatusState;
  detail: string;
}

const DEFAULT_DETAIL: Record<VoiceStatusState, string> = {
  listening: 'Listening...',
  transcribing: 'Transcribing...',
  thinking: 'Waiting for Yuki...',
  speaking: 'Speaking...',
  error: 'Voice error',
  off: '',
};

const DOT_COLOR: Record<VoiceStatusState, string> = {
  listening: 'bg-green-500',
  transcribing: 'bg-yellow-400',
  thinking: 'bg-yellow-400',
  speaking: 'bg-primary',
  error: 'bg-red-500',
  off: '',
};

/**
 * Derives the current voice pipeline status from the audio context.
 * React port of the SolidJS useVoiceStatus hook.
 */
export function useVoiceStatus() {
  const audio = useAudio();

  const status = useMemo<VoiceStatusInfo>(() => {
    if (audio.error) return { state: 'error', detail: audio.error };
    if (audio.listening || audio.voiceStatus === 'listening')
      return { state: 'listening', detail: DEFAULT_DETAIL.listening };
    if (audio.speaking) return { state: 'speaking', detail: DEFAULT_DETAIL.speaking };
    if (audio.voiceMode)
      return { state: 'thinking', detail: DEFAULT_DETAIL.thinking };
    return { state: 'off', detail: '' };
  }, [
    audio.error,
    audio.listening,
    audio.speaking,
    audio.voiceStatus,
    audio.voiceMode,
  ]);

  const getLabel = () => status.detail;
  const getDotColorClass = () => DOT_COLOR[status.state];
  const isVisible = () => audio.voiceMode && status.state !== 'off';

  return { status, getLabel, getDotColorClass, isVisible };
}
