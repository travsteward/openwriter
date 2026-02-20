/**
 * Twitter-style circular character counter.
 * Uses X design tokens: blue → yellow (260+) → red (280+).
 * Informational — does not block posting.
 */

interface CharacterCounterProps {
  count: number;
  softLimit?: number;
}

export default function CharacterCounter({ count, softLimit = 280 }: CharacterCounterProps) {
  const remaining = softLimit - count;
  const progress = Math.min(count / softLimit, 1);

  // Circle geometry — matches X's ~26px counter
  const size = 26;
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  // X color thresholds
  let color = 'var(--x-blue, #1d9bf0)';
  if (remaining <= 0) {
    color = 'var(--x-red, #f4212e)';
  } else if (remaining <= 20) {
    color = 'var(--x-yellow, #ffd400)';
  }

  const showNumber = remaining <= 20;

  // Don't show counter when empty
  if (count === 0) return null;

  return (
    <div className="tweet-char-counter" title={`${count} / ${softLimit}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--x-border, #eff3f4)"
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.15s ease, stroke 0.15s ease' }}
        />
      </svg>
      {showNumber && (
        <span className="tweet-char-number" style={{ color }}>
          {remaining}
        </span>
      )}
    </div>
  );
}
