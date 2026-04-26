'use client';

import { useEffect, useState } from 'react';
import { getMarketConfig, getSourceLabel } from '@sdf/types';
import type { Source, SourceStatus } from '@sdf/types';

interface LoadingAnimationProps {
  completedSources: number;
  totalSources: number;
  activeSource: Source | null;
  completedStatuses: SourceStatus[];
}

const market = getMarketConfig('pl');
const SCORING_STEPS = ['Porównuję ceny…', 'Obliczam ocenę…', 'Sortuję oferty…'];

export function LoadingAnimation({
  completedSources,
  totalSources,
  activeSource,
  completedStatuses,
}: LoadingAnimationProps) {
  const [scoringStep, setScoringStep] = useState(0);

  const allDone = totalSources > 0 && completedSources >= totalSources;

  // Once all sources are done, cycle through scoring messages
  useEffect(() => {
    if (!allDone) return;
    const t = setInterval(() => setScoringStep((s) => (s + 1) % SCORING_STEPS.length), 700);
    return () => clearInterval(t);
  }, [allDone]);
  const hasPartialResults = completedSources > 0;

  const statusText = allDone
    ? SCORING_STEPS[scoringStep]
    : activeSource
    ? `Przeszukuję ${getSourceLabel(activeSource, market)}…`
    : 'Przygotowuję wyszukiwanie…';

  return (
    <div className="flex flex-col items-center gap-5 py-10">
      {/* Spinner */}
      <div className="relative w-14 h-14">
        <div className="absolute inset-0 rounded-full border-4 border-slate-100" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-brand-500 animate-spin" />
      </div>

      {/* Current action */}
      <p className="text-slate-600 font-medium text-sm">{statusText}</p>

      {/* Per-source progress pills */}
      {totalSources > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {completedStatuses.map((s) => (
            <span
              key={s.source}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                s.success
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-red-50 text-red-600 border-red-200'
              }`}
            >
              {s.success ? '✓' : '✗'} {getSourceLabel(s.source, market)}
              <span className="text-slate-400">{s.listingsFound}</span>
            </span>
          ))}
          {/* Pending sources — show as grey spinners */}
          {Array.from({ length: totalSources - completedSources }).map((_, i) => (
            <span
              key={`pending-${i}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-slate-50 text-slate-400 border-slate-200"
            >
              <span className="w-3 h-3 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin inline-block" />
              szukam…
            </span>
          ))}
        </div>
      )}

      {/* Skeleton cards — fewer once partial results exist */}
      {!hasPartialResults && (
        <div className="w-full space-y-3 mt-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-slate-200 h-28 animate-pulse"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
