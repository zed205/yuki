'use client';

import { type ComponentType, type SVGProps } from 'react';
import {
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronUp,
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Volume1,
  Settings,
  Play,
  Square,
  RotateCcw,
  RefreshCw,
  MessageSquare,
  MessageCircle,
  Folder,
  FolderOpen,
  FileText,
  Check,
  CheckCircle2,
  Loader,
  AlertCircle,
  Info,
  Maximize,
  Minimize,
  Plus,
  Trash2,
  Search,
  Copy,
  ExternalLink,
  Globe,
  Sun,
  Moon,
  Eye,
  EyeOff,
  MoreHorizontal,
  MoreVertical,
  Ellipsis,
  Terminal,
  Code,
  Bot,
  Zap,
  Monitor,
  PanelRight,
  Link,
  Sparkles,
  Waves,
  Pause,
  Pencil,
  type LucideProps,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Kebab-case icon name → lucide component
const ICON_MAP: Record<string, ComponentType<LucideProps>> = {
  menu: Menu,
  x: X,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevron-left': ChevronLeft,
  'chevron-up': ChevronUp,
  send: Send,
  mic: Mic,
  'mic-off': MicOff,
  'volume-2': Volume2,
  'volume-x': VolumeX,
  'volume-1': Volume1,
  settings: Settings,
  play: Play,
  square: Square,
  stop: Square,
  'rotate-ccw': RotateCcw,
  'refresh-cw': RefreshCw,
  'message-square': MessageSquare,
  'message-circle': MessageCircle,
  folder: Folder,
  'folder-open': FolderOpen,
  'file-text': FileText,
  check: Check,
  'check-circle-2': CheckCircle2,
  loader: Loader,
  'alert-circle': AlertCircle,
  info: Info,
  maximize: Maximize,
  minimize: Minimize,
  plus: Plus,
  'trash-2': Trash2,
  trash: Trash2,
  search: Search,
  copy: Copy,
  'external-link': ExternalLink,
  globe: Globe,
  sun: Sun,
  moon: Moon,
  eye: Eye,
  'eye-off': EyeOff,
  'more-horizontal': MoreHorizontal,
  'more-vertical': MoreVertical,
  ellipsis: Ellipsis,
  terminal: Terminal,
  code: Code,
  bot: Bot,
  zap: Zap,
  monitor: Monitor,
  'panel-right': PanelRight,
  link: Link,
  sparkles: Sparkles,
  waves: Waves,
  pause: Pause,
  edit: Pencil,
};

export interface IconProps
  extends Omit<SVGProps<SVGSVGElement>, 'name' | 'color'> {
  name: string;
  size?: number | string;
  color?: string;
  strokeWidth?: number;
}

/**
 * Icon — name-based lucide icon (ported from client-v2 ui/Icon.tsx,
 * which used hand-rolled SVG paths).
 */
export function Icon({
  name,
  size = 24,
  color = 'currentColor',
  strokeWidth = 2,
  className,
  ...rest
}: IconProps) {
  const LucideIcon = ICON_MAP[name];
  if (!LucideIcon) {
    // Fallback: unknown icon renders a small circle
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        className={cn('inline-block', className)}
        {...rest}
      >
        <circle cx="12" cy="12" r="10" />
      </svg>
    );
  }
  return (
    <LucideIcon
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      className={cn('inline-block', className)}
      {...rest}
    />
  );
}
