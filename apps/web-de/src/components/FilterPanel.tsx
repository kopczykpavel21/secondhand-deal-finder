'use client';

import { useState } from 'react';
import type { Condition, SearchFilters, Source, SortOption } from '@sdf/types';
import clsx from 'clsx';

interface FilterPanelProps {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
}

const SOURCES: { id: Source; label: string; badge: string }[] = [
  { id: 'vinted',    label: 'Vinted',     badge: 'full' },
  { id: 'willhaben', label: 'willhaben',  badge: 'full' },
  { id: 'kleinanzeigen', label: 'Kleinanzeigen', badge: 'full' },
];

const SORT_OPTIONS: { id: SortOption; label: string; hint?: string }[] = [
  { id: 'best_deal',     label: 'Bestes Angebot' },
  { id: 'most_relevant', label: 'Beste Übereinstimmung', hint: 'Preis wird nicht berücksichtigt' },
  { id: 'newest',        label: 'Neueste' },
  { id: 'cheapest',      label: 'Günstigste' },
  { id: 'safest',        label: 'Vertrauenswürdigste' },
];

const CONDITIONS: { id: Condition; label: string; emoji: string }[] = [
  { id: 'new',      label: 'Neu',          emoji: '✨' },
  { id: 'like_new', label: 'Wie neu',      emoji: '⭐' },
  { id: 'good',     label: 'Guter Zustand', emoji: '👍' },
  { id: 'fair',     label: 'Gebraucht',    emoji: '🔧' },
  { id: 'poor',     label: 'Beschädigt',   emoji: '⚠️' },
];

const BADGE_STYLE: Record<string, string> = {
  full:         'bg-emerald-100 text-emerald-700',
  partial:      'bg-yellow-100 text-yellow-700',
  experimental: 'bg-orange-100 text-orange-700',
};

export function FilterPanel({ filters, onChange }: FilterPanelProps) {
  const [open, setOpen] = useState(false);

  const activeSources    = filters.sources    ?? SOURCES.map((s) => s.id);
  const activeConditions = filters.conditions ?? [];

  function toggleSource(id: Source) {
    const next = new Set(activeSources);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange({ ...filters, sources: Array.from(next) });
  }

  function toggleCondition(id: Condition) {
    const next = new Set(activeConditions);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange({ ...filters, conditions: next.size > 0 ? Array.from(next) : undefined });
  }

  const hasActiveFilters =
    filters.priceMin != null ||
    filters.priceMax != null ||
    (filters.location ?? '').trim().length > 0 ||
    (filters.conditions ?? []).length > 0 ||
    (filters.sources != null && filters.sources.length < SOURCES.length);

  return (
    <div className="w-full max-w-2xl mx-auto">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
        </svg>
        Filter &amp; Sortierung
        {hasActiveFilters && (
          <span className="w-2 h-2 bg-brand-500 rounded-full" />
        )}
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
              Preis (EUR)
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                placeholder="Von"
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
                placeholder="Bis"
                min={0}
                value={filters.priceMax ?? ''}
                onChange={(e) =>
                  onChange({ ...filters, priceMax: e.target.value ? Number(e.target.value) : undefined })
                }
                className="w-28 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Ort
            </label>
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <input
                type="text"
                placeholder="Stadt oder Bundesland, z. B. Berlin"
                value={filters.location ?? ''}
                onChange={(e) =>
                  onChange({ ...filters, location: e.target.value || undefined })
                }
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <p className="text-xs text-slate-400 mt-1">Filtert Ergebnisse nach dem Ort des Inserats</p>
          </div>

          {/* Condition */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Zustand
            </label>
            <div className="flex flex-wrap gap-2">
              {CONDITIONS.map((c) => {
                const active = activeConditions.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleCondition(c.id)}
                    className={clsx(
                      'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border font-medium transition-colors',
                      active
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300',
                    )}
                  >
                    <span className="text-base leading-none">{c.emoji}</span>
                    {c.label}
                  </button>
                );
              })}
            </div>
            {activeConditions.length === 0 && (
              <p className="text-xs text-slate-400 mt-1">Keine Auswahl = alle anzeigen</p>
            )}
          </div>

          {/* Sort by */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Sortieren nach
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
              const active = SORT_OPTIONS.find((o) => o.id === (filters.sortBy ?? 'best_deal'));
              return active?.hint
                ? <p className="text-xs text-slate-400 mt-1">{active.hint}</p>
                : null;
            })()}
          </div>

          {/* Sources */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Quellen
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

          {/* Reset */}
          {hasActiveFilters && (
            <button
              onClick={() => onChange({ sortBy: filters.sortBy })}
              className="text-xs text-slate-400 hover:text-red-500 transition-colors flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Filter zurücksetzen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
