'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useWebSocket } from './websocket-context';

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

  // On-demand text-to-speech (legacy "Read" / playSynthesized).
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;

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
  const { send } = useWebSocket();
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

  // Sequence guard so a stale utterance can't clear the speaking flag after a
  // newer one has started. On-demand TTS (legacy "Read") uses the browser's
  // speechSynthesis API so it works with zero backend dependency and emits no
  // network errors.
  const speakSeq = useRef(0);

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
    // Optimistic update; the server echoes the authoritative state back over
    // `voice:status`. Voice mode is toggled via WS (legacy parity) — the REST
    // endpoint does not exist on the backend.
    setVoiceMode(next);
    setListening(false);
    setSpeaking(false);
    setVoiceStatus(next ? 'connecting' : 'idle');
    setError(null);
    send('voice:toggle', { enabled: next });
  }, [voiceMode, send]);

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

  // Strip markdown so the synthesized speech is natural prose (mirrors legacy
  // AudioPlayer.stripMarkdown before /api/audio/synthesize).
  const stripMarkdown = (text: string): string =>
    text
      .replace(/```[\s\S]*?```/g, ' Code block. ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/[*_~>#|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    speakSeq.current += 1;
    setSpeaking(false);
  }, []);

  const speak = useCallback(async (text: string) => {
    const clean = stripMarkdown(text);
    if (!clean) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    // Stop any in-flight speech before starting a new one.
    window.speechSynthesis.cancel();
    const seq = ++speakSeq.current;
    setSpeaking(true);
    try {
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = speed;
      utterance.pitch = 1;
      utterance.onend = () => {
        if (speakSeq.current === seq) setSpeaking(false);
      };
      utterance.onerror = () => {
        if (speakSeq.current === seq) setSpeaking(false);
      };
      window.speechSynthesis.speak(utterance);
    } catch {
      if (speakSeq.current === seq) setSpeaking(false);
    }
  }, [speed]);

  // Stop TTS playback if the component unmounts.
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

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
      speak,
      stopSpeaking,
    }),
    [
      voiceMode, mic, tts, volume, speed, selectedVoice, pushToTalk,
      listening, speaking, error, voiceStatus, toggleVoiceMode, toggleMic,
      toggleTts, speak, stopSpeaking,
    ],
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}

export function useAudio() {
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error('useAudio must be used within an AudioProvider');
  return ctx;
}
