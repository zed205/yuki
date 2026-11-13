'use client';

import { useEffect, useRef } from 'react';
import { useSession } from '@/context/session-context';
import { useAudio } from '@/context/audio-context';
import { useWebSocket } from '@/context/websocket-context';

/**
 * Global keyboard shortcuts + ambient behaviors (legacy `app.js` parity):
 *
 *  - Ctrl/Cmd+K       → open the search modal
 *  - Ctrl+M           → toggle the mic (speak to Yuki); exits voice mode if active
 *  - Ctrl+Alt+V       → global voice toggle (finds/creates the "Voice" project,
 *                       opens a fresh session, then enters voice mode)
 *  - Ctrl+Space       → push-to-talk (keydown starts, keyup stops)
 *  - Esc              → stop the running turn (when busy)
 *  - document.title   → "🎤 Yuki — Voice mode" while voice mode is active
 *  - Voice-active desktop notification when the window loses focus in voice mode
 *
 * All actions are read through refs so the keydown listener is registered once
 * and never sees stale closures.
 */
export function useGlobalShortcuts(onOpenSearch: () => void) {
  const { isWaiting, stopResponse } = useSession();
  const audio = useAudio();
  const { send } = useWebSocket();

  const onOpenSearchRef = useRef(onOpenSearch);
  onOpenSearchRef.current = onOpenSearch;

  // Latest values for the once-registered listener.
  const stateRef = useRef({
    isWaiting,
    stopResponse,
    voiceMode: audio.voiceMode,
    toggleVoiceMode: audio.toggleVoiceMode,
    toggleMic: audio.toggleMic,
    setListening: audio.setListening,
    setVoiceStatus: audio.setVoiceStatus,
    send,
  });
  stateRef.current = {
    isWaiting,
    stopResponse,
    voiceMode: audio.voiceMode,
    toggleVoiceMode: audio.toggleVoiceMode,
    toggleMic: audio.toggleMic,
    setListening: audio.setListening,
    setVoiceStatus: audio.setVoiceStatus,
    send,
  };

  const voiceModeRef = useRef(audio.voiceMode);
  voiceModeRef.current = audio.voiceMode;

  const pttActive = useRef(false);
  const lastGlobalVoice = useRef(0);

  // Voice-mode document title (legacy: document.title = '🎤 Yuki — Voice mode').
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = audio.voiceMode ? '🎤 Yuki — Voice mode' : 'Yuki';
  }, [audio.voiceMode]);

  // Global voice toggle: ensure a "Voice" project + fresh session, then enter.
  const globalVoiceToggle = async () => {
    const now = Date.now();
    if (now - lastGlobalVoice.current < 400) return;
    lastGlobalVoice.current = now;
    const s = stateRef.current;
    if (s.voiceMode) {
      await s.toggleVoiceMode();
      return;
    }
    try {
      const res = await fetch('/api/projects');
      const data = (await res.json()) as
        | Array<{ id: string; name?: string }>
        | { projects?: Array<{ id: string; name?: string }> };
      const list = Array.isArray(data) ? data : data.projects || [];
      let voiceProject = list.find(
        (p) => String(p.name || '').toLowerCase() === 'voice',
      );
      if (!voiceProject) {
        const cRes = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Voice' }),
        });
        const created = (await cRes.json()) as { id?: string; name?: string };
        voiceProject = { id: created.id as string, name: created.name };
      }
      if (voiceProject?.id) s.send('session:create', { projectId: voiceProject.id });
    } catch (err) {
      console.error('Failed to start voice session:', err);
    }
    await s.toggleVoiceMode();
  };
  const globalVoiceToggleRef = useRef(globalVoiceToggle);
  globalVoiceToggleRef.current = globalVoiceToggle;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = stateRef.current;
      // Ctrl/Cmd+K → search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenSearchRef.current();
        return;
      }
      // Ctrl+M → speak / exit voice
      if (e.ctrlKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        if (s.voiceMode) void s.toggleVoiceMode();
        else s.toggleMic();
        return;
      }
      // Ctrl+Alt+V → global voice toggle
      if (e.ctrlKey && e.altKey && e.code === 'KeyV') {
        e.preventDefault();
        void globalVoiceToggleRef.current();
        return;
      }
      // Ctrl+Space → push-to-talk start
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault();
        pttActive.current = true;
        s.setListening(true);
        s.setVoiceStatus('listening');
        return;
      }
      // Esc → stop when busy
      if (e.key === 'Escape' && s.isWaiting) {
        e.preventDefault();
        s.stopResponse();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && pttActive.current) {
        e.preventDefault();
        pttActive.current = false;
        const s = stateRef.current;
        s.setListening(false);
        if (!s.voiceMode) s.setVoiceStatus('idle');
      }
    };

    const onWindowBlur = () => {
      if (pttActive.current) {
        pttActive.current = false;
        stateRef.current.setListening(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, []);

  // Voice-active desktop notification when the window is not focused.
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const notify = () => {
      if (!voiceModeRef.current) return;
      if (Notification.permission !== 'granted') return;
      try {
        new Notification('Yuki — Voice mode', {
          body: 'Voice mode is active. Press Ctrl+Alt+V to stop.',
          tag: 'yuki-voice',
        });
      } catch {
        /* ignore */
      }
    };
    const onVisibility = () => {
      if (document.hidden) notify();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', notify);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', notify);
    };
  }, [audio.voiceMode]);
}
