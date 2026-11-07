import type { JSX } from 'solid-js';
import { Show, splitProps } from 'solid-js';

export interface AvatarProps {
  name: string;
  src?: string;
  class?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Avatar(props: AvatarProps) {
  const [local, rest] = splitProps(props, ['name', 'src', 'class', 'size']);

  const sizes: Record<string, string> = {
    sm: 'w-7 h-7 text-xs',
    md: 'w-9 h-9 text-sm',
    lg: 'w-12 h-12 text-base',
  };

  // Generate consistent color from name
  const colorIndex = (props.name.charCodeAt(0) || 0) % 4;
  const bgColors = [
    'bg-[#1f6feb]',
    'bg-[#a371f7]',
    'bg-[#f778ba]',
    'bg-[#d29922]',
  ];

  const sizeClass = sizes[local.size || 'md'];
  const bgColor = props.name
    ? bgColors[props.name.charCodeAt(0) % bgColors.length]
    : 'bg-[#30363d]';

  const initials = props.name
    ?.slice(0, 2)
    .toUpperCase()
    .replace(/\s/g, '') || '?';

  return (
    <div
      class={`rounded-md flex items-center justify-center text-white font-medium ${bgColor} ${sizeClass} ${local.class || ''}`}
      {...rest}
      aria-label={props.name}
    >
      <Show when={props.src} fallback={initials}>
        <img
          src={props.src}
          alt={props.name}
          class="w-full h-full rounded-md object-cover"
        />
      </Show>
    </div>
  );
}
