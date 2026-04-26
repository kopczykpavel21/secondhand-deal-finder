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
      { label: 'Dopasowanie do zapytania', pct: 70 },
      { label: 'Stan produktu', pct: 9 },
      { label: 'Świeżość ogłoszenia', pct: 7 },
      { label: 'Wiarygodność sprzedającego', pct: 5 },
      { label: 'Kompletność ogłoszenia', pct: 5 },
      { label: 'Zainteresowanie kupujących', pct: 4 },
      { label: 'Relacja ceny do podobnych ofert', pct: 0, ignored: true },
    ];
  }
  return [
    { label: 'Dopasowanie do zapytania', pct: 37 },
    { label: 'Relacja ceny do podobnych ofert', pct: 19 },
    { label: 'Stan produktu', pct: 11 },
    { label: 'Zainteresowanie kupujących', pct: 11 },
    { label: 'Świeżość ogłoszenia', pct: 7 },
    { label: 'Wiarygodność sprzedającego', pct: 7 },
    { label: 'Kompletność ogłoszenia', pct: 7 },
  ];
}

interface SortMeta {
  headline: string;
  note: string;
  orderByLabel: string | null;
}

const SORT_META: Record<SortOption, SortMeta> = {
  best_deal: {
    headline: 'Najlepsza okazja',
    note: 'Oferty są sortowane według najwyższego wyniku. Wynik 0–100 łączy trafność, cenę, stan i wiarygodność sprzedającego.',
    orderByLabel: null,
  },
  most_relevant: {
    headline: 'Najlepsze dopasowanie',
    note: 'Cena nie jest brana pod uwagę. Wyniki są sortowane wyłącznie według dopasowania do zapytania.',
    orderByLabel: null,
  },
  newest: {
    headline: 'Najnowsze',
    note: 'Kolejność zależy od daty dodania ogłoszenia, nie od wyniku. Wynik nadal jest liczony i pokazywany na każdej karcie.',
    orderByLabel: 'Data dodania (najnowsze u góry)',
  },
  cheapest: {
    headline: 'Najtańsze',
    note: 'Kolejność zależy od ceny rosnąco. Oferty bez podanej ceny trafiają na koniec. Wynik nadal jest liczony.',
    orderByLabel: 'Cena (najniższa u góry)',
  },
  safest: {
    headline: 'Najbardziej wiarygodne',
    note: 'Kolejność zależy od oceny sprzedającego. Źródła bez danych o sprzedającym są wyświetlane niżej.',
    orderByLabel: 'Ocena sprzedającego (najwyższa u góry)',
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
          <span className="text-slate-400 text-xs">Jak działa sortowanie:</span>
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
          {scoreDrivesOrder ? 'Wagi wyniku' : 'Wagi wyniku (widoczne na karcie, ale nie decydują o kolejności)'}
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
          Kara: spam lub podejrzanie niska cena −40% · promowane ogłoszenie jest oceniane na podstawie treści, bez dodatkowej kary za promowanie.
        </p>
      </div>
    </div>
  );
}
