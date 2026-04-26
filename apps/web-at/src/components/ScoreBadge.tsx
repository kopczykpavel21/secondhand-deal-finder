import clsx from 'clsx';

interface ScoreBadgeProps {
  score: number;
  size?: 'sm' | 'md';
}

function scoreColor(score: number): string {
  if (score >= 75) return '#10b981'; // emerald-500
  if (score >= 55) return '#f59e0b'; // amber-500
  return '#ef4444';                   // red-500
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Ausgezeichnet';
  if (score >= 65) return 'Gut';
  if (score >= 50) return 'Durchschnitt';
  return 'Schwach';
}

export function ScoreBadge({ score, size = 'md' }: ScoreBadgeProps) {
  const color = scoreColor(score);
  const dim = size === 'sm' ? 36 : 48;
  const stroke = size === 'sm' ? 3 : 4;
  const r = (dim / 2) - stroke;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - score / 100);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative" style={{ width: dim, height: dim }}>
        <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} className="-rotate-90">
          {/* Background track */}
          <circle
            cx={dim / 2}
            cy={dim / 2}
            r={r}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={stroke}
          />
          {/* Score arc */}
          <circle
            cx={dim / 2}
            cy={dim / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>
        <span
          className={clsx(
            'absolute inset-0 flex items-center justify-center font-bold',
            size === 'sm' ? 'text-xs' : 'text-sm',
          )}
          style={{ color }}
        >
          {score}
        </span>
      </div>
      {size === 'md' && (
        <span className="text-xs text-slate-400 font-medium">{scoreLabel(score)}</span>
      )}
    </div>
  );
}
