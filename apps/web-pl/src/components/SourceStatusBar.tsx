import { getMarketConfig, getSourceLabel } from '@sdf/types';
import type { SourceStatus } from '@sdf/types';
import clsx from 'clsx';

const market = getMarketConfig('pl');

export function SourceStatusBar({ sources }: { sources: SourceStatus[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {sources.filter((s) => !s.success || s.listingsFound > 0).map((s) => (
        <div
          key={s.source}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border',
            !s.success
              ? 'bg-red-50 text-red-600 border-red-200'
              : s.listingsFound === 0
                ? 'bg-slate-50 text-slate-400 border-slate-200'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200',
          )}
          title={s.error ?? `${s.listingsFound} wyników w ${s.executionMs}ms`}
        >
          <span
            className={clsx(
              'w-1.5 h-1.5 rounded-full',
              !s.success
                ? 'bg-red-400'
                : s.listingsFound === 0
                  ? 'bg-slate-300'
                  : 'bg-emerald-500',
            )}
          />
          {getSourceLabel(s.source, market)}
          {s.success && (
            <span className={s.listingsFound === 0 ? 'text-slate-300' : 'text-emerald-600/70'}>
              {s.listingsFound}
            </span>
          )}
          {!s.success && <span className="text-red-400">błąd</span>}
        </div>
      ))}
    </div>
  );
}
