'use client';

import { cn } from '@/lib/utils';
import { useAudio } from '@/context/audio-context';
import { useVoiceStatus } from '@/hooks/use-voice-status';
import { Switch } from '@/components/ui/switch';
import { ActivityRing } from '@/components/ui/activity-ring';

interface VoicePanelProps {
  compact?: boolean;
}

/**
 * Voice status bar with mode/mic/TTS toggles.
 * React port of the SolidJS VoicePanel.
 */
export function VoicePanel(props: VoicePanelProps) {
  const audio = useAudio();
  const voiceStatus = useVoiceStatus();

  if (props.compact) {
    return (
      <div className="flex items-center gap-2 border-t border-border bg-muted px-3 py-1.5 text-xs">
        {voiceStatus.isVisible() && (
          <div
            className={cn(
              'h-2 w-2 animate-pulse rounded-full',
              voiceStatus.getDotColorClass(),
            )}
          />
        )}
        <span className="text-muted-foreground">
          {audio.voiceMode
            ? voiceStatus.getLabel()
            : 'Voice off'}
        </span>
      </div>
    );
  }

  const state = voiceStatus.status.state;
  const showRing = state === 'listening' || state === 'transcribing';

  return (
    <div className="border-t border-border bg-muted">
      <div
        className={cn(
          'flex items-center gap-2 px-4 py-2 text-xs transition-colors duration-150',
          voiceStatus.isVisible() && 'opacity-90',
        )}
      >
        {/* Activity indicator */}
        {voiceStatus.isVisible() ? (
          showRing ? (
            <ActivityRing size={16} strokeWidth={2} className="text-primary" />
          ) : (
            <div
              className={cn(
                'h-2 w-2 animate-pulse rounded-full',
                voiceStatus.getDotColorClass(),
              )}
            />
          )
        ) : (
          <div
            className={cn(
              'h-2 w-2 rounded-full',
              audio.voiceMode ? 'bg-primary' : 'bg-muted-foreground',
            )}
          />
        )}

        {/* Status label */}
        <span
          className="text-muted-foreground"
          title={voiceStatus.isVisible() ? voiceStatus.getLabel() : undefined}
        >
          {voiceStatus.isVisible()
            ? voiceStatus.getLabel()
            : audio.voiceMode
              ? 'Voice mode active'
              : 'Voice mode off'}
        </span>

        <div className="flex-1" />

        {/* Toggles */}
        <div className="flex items-center gap-3">
          <label className="group flex cursor-pointer items-center gap-2">
            <span className="whitespace-nowrap text-xs text-muted-foreground transition-colors group-hover:text-foreground">
              Voice
            </span>
            <Switch
              checked={audio.voiceMode}
              onCheckedChange={() => void audio.toggleVoiceMode()}
            />
          </label>
          <label className="group flex cursor-pointer items-center gap-2">
            <span className="whitespace-nowrap text-xs text-muted-foreground transition-colors group-hover:text-foreground">
              Mic
            </span>
            <Switch
              checked={audio.micEnabled}
              onCheckedChange={audio.toggleMic}
              disabled={!audio.voiceMode}
            />
          </label>
          <label className="group flex cursor-pointer items-center gap-2">
            <span className="whitespace-nowrap text-xs text-muted-foreground transition-colors group-hover:text-foreground">
              TTS
            </span>
            <Switch
              checked={audio.ttsEnabled}
              onCheckedChange={audio.toggleTts}
              disabled={!audio.voiceMode}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
