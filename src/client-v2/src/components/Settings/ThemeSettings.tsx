import { createSignal, createEffect, For, Show } from 'solid-js';
import { Box, Text, Switch, Select } from '../ui';
import { cn } from '../../lib/utils';
import { useTheme } from '../../hooks/useTheme';

const THEMES = [
  { id: 'catppuccin-macchiato', name: 'Catppuccin Macchiato', preview: 'bg-[#24273a] text-[#c0caf5]' },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', preview: 'bg-[#eff1f5] text-[#4c4f69]' },
  { id: 'catppuccin-frappe', name: 'Catppuccin Frappe', preview: 'bg-[#303446] text-[#c6d0f5]' },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', preview: 'bg-[#1e1e2e] text-[#cdd6f4]' },
  { id: 'dracula', name: 'Dracula', preview: 'bg-[#282a36] text-[#f8f8f2]' },
  { id: 'github-dark', name: 'GitHub Dark', preview: 'bg-[#0d1117] text-[#c9d1d9]' },
  { id: 'github-light', name: 'GitHub Light', preview: 'bg-[#ffffff] text-[#1f2328]' },
  { id: 'one-dark-pro', name: 'One Dark Pro', preview: 'bg-[#282c34] text-[#abb2bf]' },
  { id: 'nord', name: 'Nord', preview: 'bg-[#2e3440] text-[#d8dee9]' },
  { id: 'monokai-pro', name: 'Monokai Pro', preview: 'bg-[#272822] text-[#f8f8f2]' },
  { id: 'solarized-dark', name: 'Solarized Dark', preview: 'bg-[#002b36] text-[#839496]' },
  { id: 'solarized-light', name: 'Solarized Light', preview: 'bg[#fdf6e3] text-[#657b83]' },
  { id: 'tokyo-night', name: 'Tokyo Night', preview: 'bg-[#1a1b26] text-[#c0caf5]' },
  { id: 'ayu-dark', name: 'Ayu Dark', preview: 'bg-[#0f0f14] text-[#bcbcbc]' },
  { id: 'ayu-light', name: 'Ayu Light', preview: 'bg-[#fafafa] text-[#5c6168]' },
  { id: 'ayu-mirage', name: 'Ayu Mirage', preview: 'bg-[#1f2430] text-[#bcbcbc]' },
  { id: 'rose-pine', name: 'Rosé Pine', preview: 'bg-[#191724] text-[#e0def4]' },
  { id: 'rose-pine-dawn', name: 'Rosé Pine Dawn', preview: 'bg-[#faf4ed] text-[#575279]' },
  { id: 'kanagawa', name: 'Kanagawa', preview: 'bg-[#1f1f28] text-[#dcd7ba]' },
  { id: 'gruvbox-dark', name: 'Gruvbox Dark', preview: 'bg-[#282828] text-[#ebdbb2]' },
  { id: 'gruvbox-light', name: 'Gruvbox Light', preview: 'bg-[#fbf1c7] text-[#7c6f64]' },
  { id: 'material-dark', name: 'Material Dark', preview: 'bg-[#263238] text-[#eeffff]' },
  { id: 'material-light', name: 'Material Light', preview: 'bg-[#ffffff] text-[#37474f]' },
  { id: 'coy', name: 'Coy', preview: 'bg-[#fff8f0] text-[#737373]' },
  { id: 'darkplus', name: 'Dark+ (Default)', preview: 'bg-[#1e1e1e] text-[#d4d4d4]' },
  { id: 'lightplus', name: 'Light+ (Default)', preview: 'bg[#ffffff] text-[#333333]' },
  { id: 'synthwave', name: 'Synthwave', preview: 'bg-[#282138] text-[#fede5d]' },
  { id: 'vitesse-dark', name: 'Vitesse Dark', preview: 'bg-[#131315] text-[#ececec]' },
  { id: 'vitesse-light', name: 'Vitesse Light', preview: 'bg-[#ffffff] text-[#1b1b1e]' },
  { id: 'atom-one-dark', name: 'Atom One Dark', preview: 'bg-[#282c34] text-[#abb2bf]' },
  { id: 'atom-one-light', name: 'Atom One Light', preview: 'bg-[#fafafa] text-[#383a42]' },
  { id: 'halcyon', name: 'Halcyon', preview: 'bg-[#070c10] text-[#c5cdd8]' },
  { id: 'palenight', name: 'Palenight', preview: 'bg-[#292d3e] text-[#c5cdd8]' },
  { id: 'whitespace', name: 'Whitespace', preview: 'bg-[#ffffff] text-[#9a9a9a]' },
  { id: 'chile-dark', name: 'Chile Dark', preview: 'bg-[#1e1e1e] text-[#d4d4d4]' },
  { id: 'everforest-dark', name: 'Everforest Dark', preview: 'bg-[#2d353b] text-[#d3c6aa]' },
  { id: 'everforest-light', name: 'Everforest Light', preview: 'bg-[#fdf6e3] text-[#5c6a72]' },
  { id: 'ocean-dark', name: 'Ocean Dark', preview: 'bg-[#0a1321] text-[#b8c5d6]' },
  { id: 'ocean-light', name: 'Ocean Light', preview: 'bg-[#f5f9fc] text-[#3d5a7a]' },
  { id: 'yuki-dark', name: 'Yuki Dark (Default)', preview: 'bg-[#0d1117] text-[#c9d1d9]' },
  { id: 'yuki-light', name: 'Yuki Light', preview: 'bg-[#ffffff] text-[#1f2328]' },
];

export function ThemeSettings() {
  const {
    themeId,
    setThemeId,
    colorScheme,
    setColorScheme,
    systemTheme,
    isSystemTheme,
  } = useTheme();

  const [selectedTheme, setSelectedTheme] = createSignal(THEMES.find(t => t.id === themeId()) || THEMES[0]);
  const [previewMode, setPreviewMode] = createSignal<'light' | 'dark'>('dark');

  createEffect(() => {
    setSelectedTheme(THEMES.find(t => t.id === themeId()) || THEMES[0]);
  });

  return (
    <Box class="space-y-6">
      {/* Theme selector */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Theme</Text>
        <Text size="xs" class="text-muted-foreground">
          Choose a visual theme. Changes apply immediately.
        </Text>
        <Select
          value={themeId()}
          onChange={(v) => {
            setThemeId(v);
            setSelectedTheme(THEMES.find(t => t.id === v) || THEMES[0]);
          }}
        >
          <For each={THEMES}>
            {(theme) => (
              <Select.Item value={theme.id} class="flex items-center gap-2">
                <Box class={cn('w-3 h-3 rounded-full', theme.preview)} />
                <span>{theme.name}</span>
              </Select.Item>
            )}
          </For>
        </Select>
      </div>

      {/* Color scheme toggle */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Color Scheme</Text>
        <Text size="xs" class="text-muted-foreground">
          Force light or dark mode, or follow your system preference.
        </Text>
        <div class="flex gap-2">
          <button
            class={cn(
              'flex-1 px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
              !isSystemTheme() && colorScheme() === 'light'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-foreground/50'
            )}
            onClick={() => {
              setColorScheme('light');
              setSystemTheme(false);
            }}
          >
            ☀️ Light
          </button>
          <button
            class={cn(
              'flex-1 px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
              !isSystemTheme() && colorScheme() === 'dark'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-foreground/50'
            )}
            onClick={() => {
              setColorScheme('dark');
              setSystemTheme(false);
            }}
          >
            🌙 Dark
          </button>
          <button
            class={cn(
              'flex-1 px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
              isSystemTheme()
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-foreground/50'
            )}
            onClick={() => setSystemTheme(true)}
          >
            💻 System
          </button>
        </div>
      </div>

      {/* Preview */}
      <div class="space-y-3">
        <Text weight="semibold" size="sm">Preview</Text>
        <div class="flex gap-2 mb-2">
          <button
            class={cn(
              'px-3 py-1 rounded text-xs font-medium transition-colors',
              previewMode() === 'dark'
                ? 'bg-primary/20 text-primary'
                : 'bg-surface2 text-muted-foreground'
            )}
            onClick={() => setPreviewMode('dark')}
          >
            Dark Preview
          </button>
          <button
            class={cn(
              'px-3 py-1 rounded text-xs font-medium transition-colors',
              previewMode() === 'light'
                ? 'bg-primary/20 text-primary'
                : 'bg-surface2 text-muted-foreground'
            )}
            onClick={() => setPreviewMode('light')}
          >
            Light Preview
          </button>
        </div>
        <div class={cn(
          'rounded-lg p-4 text-sm',
          previewMode() === 'dark'
            ? 'bg-[#0d1117] text-[#c9d1d9] border border-[#30363d]'
            : 'bg-[#ffffff] text-[#1f2328] border border-[#d0d7de]'
        )}>
          <div class="font-semibold mb-2">Preview Content</div>
          <p class="text-muted-foreground mb-3">
            This is a preview of how your messages will look in the selected theme.
          </p>
          <div class={cn(
            'rounded p-3 text-xs mb-2',
            previewMode() === 'dark'
              ? 'bg-[#1c3a5f] border border-[#2e5a8f] text-[#e6edf3]'
              : 'bg-[#ddf4ff] border border-[#54aeff66] text-[#0550ae]'
          )}>
            User message preview
          </div>
          <div class={cn(
            'rounded p-3 text-xs',
            previewMode() === 'dark'
              ? 'bg-[#161b22] border border-[#30363d] text-[#c9d1d9]'
              : 'bg-[#f6f8fa] border border-[#d0d7de] text-[#1f2328]'
          )}>
            Assistant message preview
          </div>
        </div>
      </div>
    </Box>
  );
}
