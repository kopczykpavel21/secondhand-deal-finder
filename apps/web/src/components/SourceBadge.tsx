import type { Source } from '@sdf/types';
import clsx from 'clsx';

const SOURCE_META: Record<
  Source,
  { label: string; color: string; dot: string }
> = {
  bazos: {
    label: 'Bazoš',
    color: 'bg-blue-50 text-blue-700 border-blue-200',
    dot: 'bg-blue-500',
  },
  sbazar: {
    label: 'Sbazar',
    color: 'bg-orange-50 text-orange-700 border-orange-200',
    dot: 'bg-orange-500',
  },
  vinted: {
    label: 'Vinted',
    color: 'bg-teal-50 text-teal-700 border-teal-200',
    dot: 'bg-teal-500',
  },
  facebook: {
    label: 'Facebook',
    color: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    dot: 'bg-indigo-500',
  },
  aukro: {
    label: 'Aukro',
    color: 'bg-rose-50 text-rose-700 border-rose-200',
    dot: 'bg-rose-500',
  },
  fler: {
    label: 'Fler',
    color: 'bg-pink-50 text-pink-700 border-pink-200',
    dot: 'bg-pink-500',
  },
  mock: {
    label: 'Demo',
    color: 'bg-slate-100 text-slate-600 border-slate-200',
    dot: 'bg-slate-400',
  },
  willhaben: {
    label: 'willhaben',
    color: 'bg-green-50 text-green-700 border-green-200',
    dot: 'bg-green-500',
  },
  kleinanzeigen: {
    label: 'Kleinanzeigen',
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
  },
  shpock: {
    label: 'Shpock',
    color: 'bg-red-50 text-red-700 border-red-200',
    dot: 'bg-red-500',
  },
  olx: {
    label: 'OLX',
    color: 'bg-violet-50 text-violet-700 border-violet-200',
    dot: 'bg-violet-500',
  },
  allegro_lokalnie: {
    label: 'Allegro',
    color: 'bg-orange-50 text-orange-700 border-orange-200',
    dot: 'bg-orange-500',
  },
  sprzedajemy: {
    label: 'Sprzedajemy',
    color: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    dot: 'bg-cyan-500',
  },
};

export function SourceBadge({ source }: { source: Source }) {
  const meta = SOURCE_META[source] ?? SOURCE_META.mock;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border',
        meta.color,
      )}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}
