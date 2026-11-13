'use client';

import { cn } from '@/lib/utils';
import { useAudio } from '@/context/audio-context';
import { Icon } from '@/components/ui/icon';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';

const VOICE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'female-1', label: 'Female 1' },
  { value: 'male-1', label: 'Male 1' },
  { value: 'neural', label: 'Neural (Recommended)' },
];

/**
 * Voice control sliders and buttons (volume, speed, voice selection).
 * React port of the SolidJS VoiceControls.
 */
export function VoiceControls({ className }: { className?: string }) {
  const audio = useAudio();

  return (
    <div
      className={cn(
        'flex flex-col gap-4 border-t border-border bg-muted p-4',
        className,
      )}
    >
      {/* Section header */}
      <div className="flex items-center gap-2">
        <Icon name="settings" size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Voice Settings
        </span>
      </div>

      {/* Volume */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="volume" size={14} className="text-muted-foreground" />
            <span className="text-xs">Volume</span>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {Math.round(audio.volume * 100)}%
          </span>
        </div>
        <Slider
          value={[Math.round(audio.volume * 100)]}
          min={0}
          max={100}
          step={1}
          onValueChange={([v]) => audio.setVolume(v / 100)}
        />
      </div>

      {/* Speed */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="activity" size={14} className="text-muted-foreground" />
            <span className="text-xs">Speed</span>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {audio.speed.toFixed(1)}x
          </span>
        </div>
        <Slider
          value={[Math.round(audio.speed * 100)]}
          min={50}
          max={200}
          step={10}
          onValueChange={([v]) => audio.setSpeed(v / 100)}
        />
      </div>

      {/* Voice selection */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Icon name="mic" size={14} className="text-muted-foreground" />
          <span className="text-xs">Voice</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {VOICE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              variant={audio.selectedVoice === option.value ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => audio.setSelectedVoice(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Error display */}
      {audio.error && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2">
          <Icon name="x" size={14} className="text-red-500" />
          <span className="text-xs text-red-500">{audio.error}</span>
        </div>
      )}
    </div>
  );
}
