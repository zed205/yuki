interface ActivityRingProps {
  className?: string;
  size?: number;
  strokeWidth?: number;
  animated?: boolean;
}

/**
 * ActivityRing — spinning ring indicator for loading/active states
 * (voice listening, TTS playback, agent working).
 */
export function ActivityRing({
  className,
  size = 20,
  strokeWidth = 2.5,
  animated = true,
}: ActivityRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeOpacity={0.2}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * 0.75}
        style={
          animated
            ? { transformOrigin: 'center', animation: 'spin 1.5s linear infinite' }
            : undefined
        }
      />
    </svg>
  );
}
