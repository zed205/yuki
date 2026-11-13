'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme/theme-provider';
import { Text } from '@/components/ui/box';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Theme options actually shipped with the client. */
const THEME_OPTIONS: Array<{ id: string; name: string; preview: string }> = [
  { id: 'yuki-dark', name: 'Yuki Dark (Default)', preview: '#0d1117' },
  { id: 'yuki-light', name: 'Yuki Light', preview: '#ffffff' },
  { id: 'system', name: 'Follow System', preview: 'linear-gradient(90deg,#0d1117 50%,#ffffff 50%)' },
];

export function ThemeSettings() {
  const { state, setTheme, setSystemTheme, listThemes } = useTheme();
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>('dark');

  // Merge in any extra registered themes
  const options = THEME_OPTIONS.filter(
    (o) => o.id === 'system' || listThemes().includes(o.id),
  );

  const isActive = (id: string) =>
    id === 'system' ? state.activeThemeId === 'system' : state.activeThemeId === id;

  return (
    <div className="space-y-6">
      {/* Theme selector */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Theme
        </Text>
        <Text size="xs" className="text-muted-foreground">
          Choose a visual theme. Changes apply immediately.
        </Text>
        <Select value={state.activeThemeId || 'yuki-dark'} onValueChange={(v) => setTheme(v)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select theme" />
          </SelectTrigger>
          <SelectContent>
            {options.map((theme) => (
              <SelectItem key={theme.id} value={theme.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full border border-border"
                    style={{ background: theme.preview }}
                  />
                  {theme.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Color scheme toggle */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Color Scheme
        </Text>
        <Text size="xs" className="text-muted-foreground">
          Force light or dark mode, or follow your system preference.
        </Text>
        <div className="flex gap-2">
          <button
            className={cn(
              'flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
              state.isDark === false && state.activeThemeId !== 'system'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-foreground/50',
            )}
            onClick={() => setTheme('yuki-light')}
          >
            ☀️ Light
          </button>
          <button
            className={cn(
              'flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
              state.isDark && state.activeThemeId !== 'system'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-foreground/50',
            )}
            onClick={() => setTheme('yuki-dark')}
          >
            🌙 Dark
          </button>
          <button
            className={cn(
              'flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
              state.activeThemeId === 'system'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-foreground/50',
            )}
            onClick={() => setSystemTheme()}
          >
            💻 System
          </button>
        </div>
      </div>

      {/* Preview */}
      <div className="space-y-3">
        <Text weight="semibold" size="sm">
          Preview
        </Text>
        <div className="mb-2 flex gap-2">
          <button
            className={cn(
              'rounded px-3 py-1 text-xs font-medium transition-colors',
              previewMode === 'dark'
                ? 'bg-primary/20 text-primary'
                : 'bg-muted text-muted-foreground',
            )}
            onClick={() => setPreviewMode('dark')}
          >
            Dark Preview
          </button>
          <button
            className={cn(
              'rounded px-3 py-1 text-xs font-medium transition-colors',
              previewMode === 'light'
                ? 'bg-primary/20 text-primary'
                : 'bg-muted text-muted-foreground',
            )}
            onClick={() => setPreviewMode('light')}
          >
            Light Preview
          </button>
        </div>
        <div
          className={cn(
            'rounded-lg border p-4 text-sm',
            previewMode === 'dark'
              ? 'border-[#30363d] bg-[#0d1117] text-[#c9d1d9]'
              : 'border-[#d0d7de] bg-[#ffffff] text-[#1f2328]',
          )}
        >
          <div className="mb-2 font-semibold">Preview Content</div>
          <p className="mb-3 text-muted-foreground">
            This is a preview of how your messages will look in the selected theme.
          </p>
          <div
            className={cn(
              'mb-2 rounded border p-3 text-xs',
              previewMode === 'dark'
                ? 'border-[#2e5a8f] bg-[#1c3a5f] text-[#e6edf3]'
                : 'border-[#54aeff66] bg-[#ddf4ff] text-[#0550ae]',
            )}
          >
            User message preview
          </div>
          <div
            className={cn(
              'rounded border p-3 text-xs',
              previewMode === 'dark'
                ? 'border-[#30363d] bg-[#161b22] text-[#c9d1d9]'
                : 'border-[#d0d7de] bg-[#f6f8fa] text-[#1f2328]',
            )}
          >
            Assistant message preview
          </div>
        </div>
      </div>
    </div>
  );
}
