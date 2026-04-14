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
  mock: {
    label: 'Demo',
    color: 'bg-slate-100 text-slate-600 border-slate-200',
    dot: 'bg-slate-400',
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
