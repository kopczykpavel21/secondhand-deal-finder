'use client';

import { useState } from 'react';
import type { SearchFilters, Source, SortOption } from '@sdf/types';
import clsx from 'clsx';

interface FilterPanelProps {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
}

const SOURCES: { id: Source; label: string; badge: string }[] = [
  { id: 'bazos', label: 'Bazoš', badge: 'full' },
  { id: 'sbazar', label: 'Sbazar', badge: 'partial' },
  { id: 'vinted', label: 'Vinted', badge: 'experimental' },
  { id: 'aukro', label: 'Aukro', badge: 'partial' },
];

const SORT_OPTIONS: { id: SortOption; label: string; hint?: string }[] = [
  { id: 'best_deal', label: 'Nejlepší nabídka' },
  { id: 'most_relevant', label: 'Nejlepší shoda', hint: 'Cena se nebere v úvahu' },
  { id: 'newest', label: 'Nejnovější' },
  { id: 'cheapest', label: 'Nejlevnější' },
  { id: 'safest', label: 'Nejdůvěryhodnější' },
];

const BADGE_STYLE: Record<string, string> = {
  full: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-yellow-100 text-yellow-700',
  experimental: 'bg-orange-100 text-orange-700',
};

export function FilterPanel({ filters, onChange }: FilterPanelProps) {
  const [open, setOpen] = useState(false);

  const activeSources = filters.sources ?? SOURCES.map((s) => s.id);

  function toggleSource(id: Source) {
    const current = new Set(activeSources);
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    onChange({ ...filters, sources: Array.from(current) });
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
        </svg>
        Filtry a řazení
        <svg
          className={clsx('w-3 h-3 transition-transform', open && 'rotate-180')}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="mt-3 p-4 bg-white rounded-xl border border-slate-200 shadow-sm space-y-5">
          {/* Price range */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Cena (CZK)
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                placeholder="Od"
                min={0}
                value={filters.priceMin ?? ''}
                onChange={(e) =>
                  onChange({ ...filters, priceMin: e.target.value ? Number(e.target.value) : undefined })
                }
                className="w-28 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <span className="text-slate-400">–</span>
              <input
                type="number"
                placeholder="Do"
                min={0}
                value={filters.priceMax ?? ''}
                onChange={(e) =>
                  onChange({ ...filters, priceMax: e.target.value ? Number(e.target.value) : undefined })
                }
                className="w-28 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* Sort by */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Řadit podle
            </label>
            <div className="flex flex-wrap gap-2">
              {SORT_OPTIONS.map((opt) => {
                const active = filters.sortBy === opt.id || (!filters.sortBy && opt.id === 'best_deal');
                return (
                  <button
                    key={opt.id}
                    onClick={() => onChange({ ...filters, sortBy: opt.id })}
                    className={clsx(
                      'px-3 py-1.5 text-sm rounded-lg border font-medium transition-colors',
                      active
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300',
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {(() => {
              const active = SORT_OPTIONS.find(
                (o) => o.id === (filters.sortBy ?? 'best_deal'),
              );
              return active?.hint ? (
                <p className="text-xs text-slate-400 mt-1">{active.hint}</p>
              ) : null;
            })()}
          </div>

          {/* Sources */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Zdroje
            </label>
            <div className="flex flex-wrap gap-2">
              {SOURCES.map((src) => {
                const active = activeSources.includes(src.id);
                return (
                  <button
                    key={src.id}
                    onClick={() => toggleSource(src.id)}
                    className={clsx(
                      'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border font-medium transition-colors',
                      active
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'bg-white text-slate-400 border-slate-200',
                    )}
                  >
                    {src.label}
                    <span className={clsx('text-xs px-1.5 py-0.5 rounded-full', BADGE_STYLE[src.badge])}>
                      {src.badge}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
