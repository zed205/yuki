'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * AudioContext — manages audio state for the voice pipeline.
 * The heavy mic/TTS pipeline is wired in a later phase; this provides the
 * full state surface used by the UI.
 */

export type VoiceStatus = 'idle' | 'listening' | 'speaking' | 'connecting' | 'error';

export interface AudioContextValue {
  // Core audio state
  voiceMode: boolean;
  micEnabled: boolean;
  ttsEnabled: boolean;
  volume: number;
  speed: number;
  selectedVoice: string;
  pushToTalk: boolean;

  // Runtime state
  listening: boolean;
  speaking: boolean;
  voiceListening: boolean;
  error: string | null;

  // Voice status
  voiceStatus: VoiceStatus;

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

const AudioContext = createContext<AudioContextValue | null>(null);

export function AudioProvider({ children }: { children: ReactNode }) {
  const [voiceMode, setVoiceMode] = useState(false);
  const [mic, setMic] = useState(false);
  const [tts, setTts] = useState(true);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [selectedVoice, setSelectedVoice] = useState('default');
  const [pushToTalk, setPushToTalk] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');

  // When voice mode is off, reset runtime state
  useEffect(() => {
    if (!voiceMode) {
      setVoiceStatus('idle');
      setListening(false);
      setSpeaking(false);
    }
  }, [voiceMode]);

  const toggleVoiceMode = useCallback(async () => {
    const next = !voiceMode;
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
        const data = (await res.json().catch(() => ({}))) as { error?: string };
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
  }, [voiceMode]);

  const toggleMic = useCallback(() => {
    const next = !mic;
    setMic(next);
    setVoiceStatus(next ? 'listening' : 'idle');
  }, [mic]);

  const toggleTts = useCallback(() => {
    const next = !tts;
    setTts(next);
    setSpeaking(next);
  }, [tts]);

  const value = useMemo<AudioContextValue>(
    () => ({
      voiceMode,
      micEnabled: mic,
      ttsEnabled: tts,
      volume,
      speed,
      selectedVoice,
      pushToTalk,
      listening,
      speaking,
      voiceListening: voiceStatus === 'listening' || listening,
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
    }),
    [
      voiceMode, mic, tts, volume, speed, selectedVoice, pushToTalk,
      listening, speaking, error, voiceStatus, toggleVoiceMode, toggleMic,
      toggleTts,
    ],
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}

export function useAudio() {
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error('useAudio must be used within an AudioProvider');
  return ctx;
}
