import { splitProps, type JSX } from 'solid-js';

interface ActivityRingProps {
  class?: string;
  size?: number;
  strokeWidth?: number;
  animated?: boolean;
}

/**
 * ActivityRing — A spinning ring indicator (shadcn/ui ActivityRing port).
 *
 * Used for loading/active states such as voice listening, TTS playback, etc.
 */
export function ActivityRing(props: ActivityRingProps) {
  const [local, rest] = splitProps(props, ['class', 'size', 'strokeWidth', 'animated']);

  const size = local.size ?? 20;
  const strokeWidth = local.strokeWidth ?? 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      class={local.class}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      {...rest}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        stroke-width={strokeWidth}
        stroke-opacity="0.2"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        stroke-width={strokeWidth}
        stroke-linecap="round"
        stroke-dasharray={circumference}
        stroke-dashoffset={circumference * 0.75}
        style={{
          ...(local.animated ?? true
            ? {
                animation: 'spin 1.5s linear infinite',
              }
            : {}),
        }}
      />
    </svg>
  );
}
