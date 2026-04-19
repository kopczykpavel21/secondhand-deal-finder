'use client';

import type { SortOption } from '@sdf/types';

interface MethodologyPanelProps {
  sortBy: SortOption;
}

interface Factor {
  label: string;
  pct: number;
  ignored?: boolean;
}

// Percentages normalised from raw weights (sum of positive components = denominator)
// DEFAULT: sum=1.35 → best_deal / newest / cheapest / safest
// MOST_RELEVANT: sum=1.14 → relevance dominates, price excluded
function getFactors(sortBy: SortOption): Factor[] {
  if (sortBy === 'most_relevant') {
    return [
      { label: 'Shoda s hledaným výrazem', pct: 70 },
      { label: 'Stav zboží', pct: 9 },
      { label: 'Čerstvost inzerátu', pct: 7 },
      { label: 'Důvěryhodnost prodávajícího', pct: 5 },
      { label: 'Kompletnost inzerátu', pct: 5 },
      { label: 'Zájem kupujících', pct: 4 },
      { label: 'Poměr ceny k ostatním', pct: 0, ignored: true },
    ];
  }
  return [
    { label: 'Shoda s hledaným výrazem', pct: 37 },
    { label: 'Poměr ceny k ostatním', pct: 19 },
    { label: 'Stav zboží', pct: 11 },
    { label: 'Zájem kupujících', pct: 11 },
    { label: 'Čerstvost inzerátu', pct: 7 },
    { label: 'Důvěryhodnost prodávajícího', pct: 7 },
    { label: 'Kompletnost inzerátu', pct: 7 },
  ];
}

interface SortMeta {
  headline: string;
  note: string;
  orderByLabel: string | null;
}

const SORT_META: Record<SortOption, SortMeta> = {
  best_deal: {
    headline: 'Nejlepší nabídka',
    note: 'Inzeráty jsou seřazeny od nejvyššího skóre. Skóre 0–100 kombinuje relevanci, cenu, stav a důvěryhodnost prodávajícího.',
    orderByLabel: null,
  },
  most_relevant: {
    headline: 'Nejlepší shoda',
    note: 'Cena se nebere v úvahu. Výsledky jsou seřazeny čistě podle shody s hledaným výrazem — bez ohledu na cenu.',
    orderByLabel: null,
  },
  newest: {
    headline: 'Nejnovější',
    note: 'Pořadí určuje datum přidání inzerátu, ne skóre. Skóre se stále počítá a zobrazuje na každé kartičce.',
    orderByLabel: 'Datum přidání (nejnovější nahoře)',
  },
  cheapest: {
    headline: 'Nejlevnější',
    note: 'Pořadí určuje cena od nejnižší. Inzeráty bez uvedené ceny jsou na konci. Skóre se stále počítá.',
    orderByLabel: 'Cena (nejnižší nahoře)',
  },
  safest: {
    headline: 'Nejdůvěryhodnější',
    note: 'Pořadí určuje hodnocení prodávajícího. Bazoš a Fler tato data neposkytují — jejich inzeráty se zobrazí na konci.',
    orderByLabel: 'Hodnocení prodávajícího (nejvyšší nahoře)',
  },
};

export function MethodologyPanel({ sortBy }: MethodologyPanelProps) {
  const factors = getFactors(sortBy);
  const meta = SORT_META[sortBy];
  const scoreDrivesOrder = meta.orderByLabel === null;

  return (
    <div className="mt-6 bg-white border border-slate-200 rounded-2xl overflow-hidden text-sm">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-slate-400 text-xs">Jak funguje řazení:</span>
          <span className="font-semibold text-slate-800">{meta.headline}</span>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">{meta.note}</p>
        {meta.orderByLabel && (
          <div className="mt-2.5 inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1 text-xs text-slate-600">
            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
            </svg>
            {meta.orderByLabel}
          </div>
        )}
      </div>

      {/* Weight bars */}
      <div className="px-5 py-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          {scoreDrivesOrder ? 'Váhy skóre' : 'Váhy skóre (zobrazeno na kartičce, neurčuje pořadí)'}
        </p>
        <div className="space-y-2">
          {factors.map((f) => (
            <div key={f.label} className="flex items-center gap-3">
              <span className={`w-44 shrink-0 text-xs text-right ${f.ignored ? 'text-slate-300' : 'text-slate-600'}`}>
                {f.label}
              </span>
              <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-400 transition-all duration-500"
                  style={{ width: `${f.pct}%` }}
                />
              </div>
              <span className={`w-8 text-xs text-right tabular-nums ${f.ignored ? 'text-slate-300' : 'font-medium text-slate-600'}`}>
                {f.ignored ? '—' : `${f.pct}%`}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-400 leading-relaxed">
          Penalizace: spam nebo podezřele nízká cena −40 % · topovaný inzerát se hodnotí na základě obsahu (bez penalizace za topování).
        </p>
      </div>
    </div>
  );
}
