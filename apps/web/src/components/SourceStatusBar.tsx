import type { SourceStatus } from '@sdf/types';
import clsx from 'clsx';

export function SourceStatusBar({ sources }: { sources: SourceStatus[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((s) => (
        <div
          key={s.source}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border',
            s.success
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-red-50 text-red-600 border-red-200',
          )}
          title={s.error ?? `${s.listingsFound} results in ${s.executionMs}ms`}
        >
          <span
            className={clsx(
              'w-1.5 h-1.5 rounded-full',
              s.success ? 'bg-emerald-500' : 'bg-red-400',
            )}
          />
          {capitalize(s.source)}
          {s.success && (
            <span className="text-emerald-600/70">{s.listingsFound}</span>
          )}
          {!s.success && <span className="text-red-400">chyba</span>}
        </div>
      ))}
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
