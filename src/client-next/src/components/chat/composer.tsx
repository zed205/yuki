'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { MoreVertical, Square, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/context/session-context';
import { useWebSocket } from '@/context/websocket-context';
import { useAudio } from '@/context/audio-context';
import { useTheme } from '@/components/theme/theme-provider';
import { ToolsModal } from '@/components/modals/tools-modal';
import { ModelsModal } from '@/components/modals/models-modal';

export interface ComposerProps {
  onSubmit: (content: string) => void;
  onStop?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Message input composer with textarea, an options (⋮) menu on the left
 * (theme, thinking, tools, models, voice, TTS, notifications, compaction)
 * and a Stop button on the right. Legacy parity: no Send button, no
 * attach-file (paperclip), Enter to send / Shift+Enter for a newline.
 */
export function Composer(props: ComposerProps) {
  const {
    isStreaming,
    isWaiting,
    thinkingEnabled,
    compactContext,
    compactState,
    notificationsEnabled,
    setNotificationsEnabled,
    tools,
  } = useSession();
  const toolsOn = tools.some((t) => t.enabled);
  const { send } = useWebSocket();
  const audio = useAudio();
  const { state: themeState, toggleTheme } = useTheme();
  const isDark = themeState.isDark;

  const [showTools, setShowTools] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const optionsMenuRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize the textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [value]);

  const handleSubmit = useCallback(() => {
    const content = value.trim();
    if (!content) return;
    if (isStreaming) return;
    props.onSubmit(content);
    setValue('');
  }, [value, isStreaming, props]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      if (showOptions) {
        setShowOptions(false);
        return;
      }
      if (isStreaming) {
        e.preventDefault();
        props.onStop?.();
      }
    }
  };

  // Close options menu when clicking outside.
  useEffect(() => {
    if (!showOptions) return;
    const handler = (e: MouseEvent) => {
      if (
        optionsMenuRef.current &&
        !optionsMenuRef.current.contains(e.target as Node)
      ) {
        setShowOptions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showOptions]);

  const isBusy = isWaiting || isStreaming;

  // Voice status pill (legacy parity — shown above the input only while voice is active).
  const voicePill = (() => {
    if (!audio.voiceMode || audio.voiceStatus === 'idle') return null;
    const map: Record<string, { dot: string; label: string }> = {
      listening: { dot: 'bg-[#3fb950]', label: 'Listening…' },
      connecting: { dot: 'bg-yellow-400', label: 'Connecting…' },
      speaking: { dot: 'bg-[#58a6ff]', label: 'Speaking…' },
      error: { dot: 'bg-[#f85149]', label: 'Voice error' },
    };
    return map[audio.voiceStatus] ?? { dot: 'bg-[#3fb950]', label: 'Listening…' };
  })();

  const placeholder = props.placeholder || 'Type a message...';

  return (
    <div className="border-t border-[#30363d] bg-[#0d1117] px-3 py-3">
      <div className="relative mx-auto max-w-5xl">
        {/* Voice status pill (legacy parity — above the input, hidden when voice is off) */}
        {voicePill && (
          <div className="mb-2 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-full border border-[#30363d] bg-[#161b22] px-4 py-1.5 text-xs text-[#8b949e]">
              <span className={cn('h-2 w-2 animate-pulse rounded-full', voicePill.dot)} />
              <span>{voicePill.label}</span>
            </div>
          </div>
        )}

        {/* Composer container */}
        <div
          className={cn(
            'flex items-end gap-2 rounded-xl border transition-colors',
            'border-[#30363d] bg-[#161b22]',
            isFocused && 'border-[#58a6ff]/50',
          )}
        >
          <div className="order-2 flex flex-1 flex-col">
            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              disabled={props.disabled}
              placeholder={isBusy ? 'Steer the running task… (Enter to send)' : placeholder}
              className="composer-textarea w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed text-[#c9d1d9] outline-none placeholder:text-[#8b949e]"
            />
          </div>

          {/* ⋮ Options menu (legacy parity — options live on the left of the input) */}
          <div className="order-1 flex items-center gap-0.5 pl-1 pb-1">
            <div ref={optionsMenuRef} className="relative">
              <button
                type="button"
                className={cn(
                  'rounded-md p-1.5 transition-colors',
                  showOptions
                    ? 'bg-[#21262d] text-[#c9d1d9]'
                    : 'text-[#8b949e] hover:bg-[#21262d] hover:text-[#c9d1d9]',
                )}
                title="Options"
                onClick={() => setShowOptions((v) => !v)}
              >
                <MoreVertical size={16} />
              </button>

              {/* Dropdown menu (opens upward, left-aligned) */}
              {showOptions && (
                <div className="absolute bottom-full left-0 mb-2 w-[260px] rounded-xl border border-[#30363d] bg-[#161b22] p-1.5 shadow-2xl z-50">
                  <div className="space-y-0.5">
                    {/* Theme toggle (light / dark) */}
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm text-[#c9d1d9] hover:bg-[#21262d] rounded-lg transition-colors text-left"
                      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                      onClick={() => toggleTheme()}
                    >
                      {isDark ? (
                        <Sun size={16} className="shrink-0" />
                      ) : (
                        <Moon size={16} className="shrink-0" />
                      )}
                      <span className="flex-1">Theme</span>
                      <span className="text-xs text-[#8b949e]">
                        {isDark ? 'Dark' : 'Light'}
                      </span>
                    </button>

                    <div className="border-t border-[#30363d] my-1" />

                    {/* Thinking toggle */}
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm text-[#c9d1d9] hover:bg-[#21262d] rounded-lg transition-colors text-left"
                      onClick={() => {
                        send('thinking:toggle', { enabled: !thinkingEnabled });
                        setShowOptions(false);
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0"
                      >
                        <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.04-2.04 2.5 2.5 0 0 1-.44-4.96A2.5 2.5 0 0 1 7 9.5 2.5 2.5 0 0 1 9.5 2Z" />
                        <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.04-2.04 2.5 2.5 0 0 0 .44-4.96A2.5 2.5 0 0 0 17 9.5 2.5 2.5 0 0 0 14.5 2Z" />
                      </svg>
                      <span className="flex-1">Thinking</span>
                      <span className="text-xs text-[#8b949e]">
                        {thinkingEnabled ? 'On' : 'Off'}
                      </span>
                    </button>

                    {/* Tools toggle */}
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm text-[#c9d1d9] hover:bg-[#21262d] rounded-lg transition-colors text-left"
                      onClick={() => {
                        setShowTools(true);
                        setShowOptions(false);
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="shrink-0"
                      >
                        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                      </svg>
                      <span className="flex-1">Tools</span>
                      <span className="text-xs text-[#8b949e]">
                        {toolsOn ? 'On' : 'Off'}
                      </span>
                    </button>

                    <div className="border-t border-[#30363d] my-1" />

                    {/* Models */}
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm text-[#c9d1d9] hover:bg-[#21262d] rounded-lg transition-colors text-left"
                      onClick={() => {
                        setShowModels(true);
                        setShowOptions(false);
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0"
                      >
                        <rect x="5" y="5" width="14" height="14" rx="2" />
                        <rect x="9.5" y="9.5" width="5" height="5" />
                        <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
                      </svg>
                      <span className="flex-1">Models</span>
                    </button>

                    <div className="border-t border-[#30363d] my-1" />

                    {/* Voice Mode */}
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm text-[#c9d1d9] hover:bg-[#21262d] rounded-lg transition-colors text-left"
                      onClick={() => void audio.toggleVoiceMode()}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0"
                      >
                        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                      </svg>
                      <span className="flex-1">Voice Mode</span>
                      <span className="text-xs text-[#8b949e]">
                        {audio.voiceMode ? 'On' : 'Off'}
                      </span>
                    </button>

                    {/* Speak */}
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm text-[#c9d1d9] hover:bg-[#21262d] rounded-lg transition-colors text-left"
                      onClick={() => audio.toggleMic()}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="shrink-0"
                      >
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                      <span className="flex-1">Speak</span>
                      <span className="text-xs text-[#8b949e]">
                        {audio.voiceListening ? 'Listening…' : 'Idle'}
                      </span>
                    </button>

                    {/* Auto TTS */}
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm text-[#c9d1d9] hover:bg-[#21262d] rounded-lg transition-colors text-left"
                      onClick={() => audio.toggleTts()}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="shrink-0"
                      >
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                      <span className="flex-1">Auto TTS</span>
                      <span className="text-xs text-[#8b949e]">
                        {audio.ttsEnabled ? 'On' : 'Off'}
                      </span>
                    </button>

                    {/* Notifications */}
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm text-[#c9d1d9] hover:bg-[#21262d] rounded-lg transition-colors text-left"
                      onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0"
                      >
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                      <span className="flex-1">Notifications</span>
                      <span className="text-xs text-[#8b949e]">
                        {notificationsEnabled ? 'On' : 'Off'}
                      </span>
                    </button>

                    <div className="border-t border-[#30363d] my-1" />

                    {/* Compaction */}
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm text-[#c9d1d9] hover:bg-[#21262d] rounded-lg transition-colors text-left"
                      disabled={isBusy}
                      onClick={() => {
                        compactContext();
                        setShowOptions(false);
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0"
                      >
                        <path d="M21 12V7H7a5 5 0 0 1 0-10h1" />
                        <path d="M3 12a9 9 0 0 0 15 6.7L22 16" />
                        <path d="M21 17v4h-4" />
                      </svg>
                      <span className="flex-1">Compaction</span>
                      <span className="text-xs text-[#8b949e]">
                        {compactState === 'busy'
                          ? 'Busy'
                          : compactState === 'done'
                            ? 'Done'
                            : compactState === 'failed'
                              ? 'Failed'
                              : 'Ready'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* Right actions: Stop (legacy parity — always visible, disabled when idle) */}
          <div className="order-3 flex items-center gap-0.5 pr-1 pb-1">
            <button
              type="button"
              className={cn(
                'flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                isBusy
                  ? 'bg-[#da3633]/90 text-white hover:bg-[#da3633]'
                  : 'cursor-not-allowed bg-[#30363d] text-[#8b949e] opacity-60',
              )}
              disabled={!isBusy}
              onClick={() => props.onStop?.()}
            >
              <Square size={10} /> Stop
            </button>
          </div>
        </div>
      </div>

      {/* Tools & Models modals (portaled) */}
      <ToolsModal open={showTools} onOpenChange={setShowTools} />
      <ModelsModal open={showModels} onOpenChange={setShowModels} />
    </div>
  );
}
