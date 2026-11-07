import { createContext, useContext, JSX } from 'solid-js';
import { createSignal, createEffect } from 'solid-js';

/**
 * AudioContext — Manages audio state for the voice pipeline.
 */

export type VoiceStatus = 'idle' | 'listening' | 'speaking' | 'connecting' | 'error';

export interface AudioContextValue {
  // Core audio state (accessors)
  voiceMode: () => boolean;
  micEnabled: () => boolean;
  ttsEnabled: () => boolean;
  volume: () => number;
  speed: () => number;
  selectedVoice: () => string;
  pushToTalk: () => boolean;

  // Runtime state
  listening: () => boolean;
  speaking: () => boolean;
  voiceListening: () => boolean;
  error: () => string | null;

  // Voice status
  voiceStatus: () => VoiceStatus;

  // Actions
  setVoiceMode: (v: boolean) => void;
  toggleVoiceMode: () => Promise<void>;
  setMic: (v: boolean) => void;
  toggleMic: () => void;
  setTts: (v: boolean) => void;
  toggleTts: () => void;
  setVolume: (v: number) => void;
  setSpeed: (v: number) => void;
  setSelectedVoice: (v: string) => void;
  setPushToTalk: (v: boolean) => void;
  setListening: (v: boolean) => void;
  setSpeaking: (v: boolean) => void;
  setError: (e: string | null) => void;
  setVoiceStatus: (status: VoiceStatus) => void;
}

const AudioContext = createContext<AudioContextValue>();

export function AudioProvider(props: { children: JSX.Element }) {
  const [voiceMode, setVoiceMode] = createSignal(false);
  const [mic, setMic] = createSignal(false);
  const [tts, setTts] = createSignal(true);
  const [volume, setVolume] = createSignal(1);
  const [speed, setSpeed] = createSignal(1);
  const [selectedVoice, setSelectedVoice] = createSignal('default');
  const [pushToTalk, setPushToTalk] = createSignal(false);
  const [listening, setListening] = createSignal(false);
  const [speaking, setSpeaking] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [voiceStatus, setVoiceStatus] = createSignal<VoiceStatus>('idle');

  // Initialize Web Audio context on first user gesture
  let ctx: AudioContext | null = null;

  function getAudioContext(): AudioContext {
    if (!ctx) {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
    }
    return ctx;
  }

  async function toggleVoiceMode() {
    const next = !voiceMode();
    setVoiceMode(next);
    setVoiceStatus('connecting');
    setListening(false);
    setSpeaking(false);

    try {
      const res = await fetch('/api/voice/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setVoiceMode(!next);
        setVoiceStatus('error');
        setError(data.error || 'Failed to toggle voice mode');
      } else if (next) {
        setVoiceStatus('connecting');
      } else {
        setVoiceStatus('idle');
      }
    } catch (err) {
      setVoiceMode(!next);
      setVoiceStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to toggle voice mode');
    }
  }

  function toggleMic() {
    const next = !mic();
    setMic(next);
    if (next) {
      setVoiceStatus('listening');
    } else {
      setVoiceStatus('idle');
    }
  }

  function toggleTts() {
    const next = !tts();
    setTts(next);
    if (next) {
      setSpeaking(true);
    } else {
      setSpeaking(false);
    }
  }

  // Sync voiceMode with status
  createEffect(() => {
    const mode = voiceMode();
    if (!mode) {
      setVoiceStatus('idle');
      setListening(false);
      setSpeaking(false);
    }
  });

  const value: AudioContextValue = {
    voiceMode,
    micEnabled: mic,
    ttsEnabled: tts,
    volume,
    speed,
    selectedVoice,
    pushToTalk,
    listening,
    speaking,
    voiceListening: () => voiceStatus() === 'listening' || listening(),
    error,
    voiceStatus,
    setVoiceMode,
    toggleVoiceMode,
    setMic,
    toggleMic,
    setTts,
    toggleTts,
    setVolume,
    setSpeed,
    setSelectedVoice,
    setPushToTalk,
    setListening,
    setSpeaking,
    setError,
    setVoiceStatus,
  };

  return (
    <AudioContext.Provider value={value}>
      {props.children}
    </AudioContext.Provider>
  );
}

export function useAudio() {
  const ctx = useContext(AudioContext);
  if (!ctx) {
    throw new Error('useAudio must be used within an AudioProvider');
  }
  return ctx;
}
