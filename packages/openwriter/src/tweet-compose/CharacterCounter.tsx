/**
 * Twitter-style circular character counter.
 * Blue → yellow (260+) → red (280+). Informational, not blocking.
 */

interface CharacterCounterProps {
  count: number;
  softLimit?: number;
}

export default function CharacterCounter({ count, softLimit = 280 }: CharacterCounterProps) {
  const remaining = softLimit - count;
  const progress = Math.min(count / softLimit, 1);

  // Circle geometry
  const size = 30;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  // Color thresholds
  let color = 'var(--tweet-counter-blue, #1d9bf0)';
  if (remaining <= 0) {
    color = 'var(--tweet-counter-red, #f4212e)';
  } else if (remaining <= 20) {
    color = 'var(--tweet-counter-yellow, #ffd400)';
  }

  const showNumber = remaining <= 20;

  return (
    <div className="tweet-char-counter" title={`${count} / ${softLimit}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--tweet-counter-track, rgba(128,128,128,0.2))"
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
