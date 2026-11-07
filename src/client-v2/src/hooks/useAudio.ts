import { createSignal, createEffect } from 'solid-js';
import { useAudio as useAudioContext } from '../context/AudioContext';
import type { VoiceStatusState } from './useVoiceStatus';

/**
 * useAudio — Audio context management hook for STT/TTS state.
 *
 * Wraps the AudioContext provider with convenient reactive signals
 * and helper methods for common audio operations (volume, speed, voice).
 */

export interface AudioState {
  voiceMode: boolean;
  mic: boolean;
  tts: boolean;
  volume: number;
  speed: number;
  selectedVoice: string;
  listening: boolean;
  speaking: boolean;
  error: string | null;
}

export interface UseAudioReturn {
  state: AudioState;
  toggleVoiceMode: () => void;
  toggleMic: () => void;
  toggleTts: () => void;
  setVolume: (v: number) => void;
  setSpeed: (v: number) => void;
  setSelectedVoice: (v: string) => void;
  setListening: (v: boolean) => void;
  setSpeaking: (v: boolean) => void;
  setError: (e: string | null) => void;
  isReady: boolean;
}

let audioCtxUnlocked = false;

export function useAudio(): UseAudioReturn {
  const ctx = useAudioContext();

  const [isReady, setIsReady] = createSignal(false);

  // Ensure audio context is unlocked on first user interaction
  createEffect(() => {
    if (!audioCtxUnlocked && typeof window !== 'undefined') {
      const unlockAudio = () => {
        try {
          const audioCtx = new AudioContext();
          audioCtx.close();
          audioCtxUnlocked = true;
        } catch {
          // Audio not supported
        }
        document.removeEventListener('click', unlockAudio);
        document.removeEventListener('keydown', unlockAudio);
      };
      document.addEventListener('click', unlockAudio);
      document.addEventListener('keydown', unlockAudio);
    }
  });

  // Mark ready once the context is available
  createEffect(() => {
    if (ctx) {
      setIsReady(true);
    }
  });

  return {
    state: {
      voiceMode: ctx.voiceMode(),
      mic: ctx.mic(),
      tts: ctx.tts(),
      volume: ctx.volume(),
      speed: ctx.speed(),
      selectedVoice: ctx.selectedVoice(),
      listening: ctx.listening(),
      speaking: ctx.speaking(),
      error: ctx.error(),
    },
    toggleVoiceMode: ctx.toggleVoiceMode,
    toggleMic: ctx.toggleMic,
    toggleTts: ctx.toggleTts,
    setVolume: ctx.setVolume,
    setSpeed: ctx.setSpeed,
    setSelectedVoice: ctx.setSelectedVoice,
    setListening: ctx.setListening,
    setSpeaking: ctx.setSpeaking,
    setError: ctx.setError,
    isReady,
  };
}
