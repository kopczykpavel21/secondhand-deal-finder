/**
 * Simple admin view — /admin/feedback
 * No auth: the URL is the secret. Don't share it publicly.
 */
'use client';

import { useState, useEffect } from 'react';
import type { FeedbackEntry } from '@/app/api/feedback/route';

interface Summary {
  total: number;
  averageRating: string | null;
  responses: FeedbackEntry[];
}

const IMPROVEMENT_LABEL: Record<string, string> = {
  more_sources:   'Více zdrojů',
  price_alerts:   'Cenová upozornění',
  better_filters: 'Lepší filtry',
  mobile_app:     'Mobilní aplikace',
  faster:         'Rychlejší načítání',
  saved_searches: 'Uložená hledání',
  other:          'Jiné',
};

function Stars({ rating }: { rating: number }) {
  return (
    <span>
      {[1,2,3,4,5].map((s) => (
        <span key={s} className={s <= rating ? 'text-yellow-400' : 'text-slate-200'}>★</span>
      ))}
    </span>
  );
}

export default function FeedbackAdminPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/feedback');
      if (!res.ok) throw new Error('failed');
      setData(await res.json() as Summary);
    } catch {
      setError(true);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Zpětná vazba</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              Odpovědi jsou uloženy v paměti — při restartu aplikace se vymažou, ale zůstávají v Railway logách.
            </p>
          </div>
          <button
            onClick={load}
            className="px-4 py-2 text-sm bg-white border border-slate-200 rounded-xl hover:border-slate-300 transition-colors shadow-sm"
          >
            Obnovit
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm mb-6">
            Načtení selhalo.
          </div>
        )}

        {data && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                <p className="text-sm text-slate-500 mb-1">Celkem odpovědí</p>
                <p className="text-3xl font-bold text-slate-900">{data.total}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                <p className="text-sm text-slate-500 mb-1">Průměrné hodnocení</p>
                <p className="text-3xl font-bold text-slate-900">
                  {data.averageRating ?? '—'}
                  {data.averageRating && <span className="text-xl text-yellow-400 ml-1">★</span>}
                </p>
              </div>
            </div>

            {/* Improvement frequency */}
            {data.total > 0 && (() => {
              const counts: Record<string, number> = {};
              for (const r of data.responses) {
                for (const imp of r.improvements) {
                  counts[imp] = (counts[imp] ?? 0) + 1;
                }
              }
              const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
              if (sorted.length === 0) return null;
              return (
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm mb-6">
                  <h2 className="text-sm font-semibold text-slate-700 mb-3">Nejžádanější vylepšení</h2>
                  <div className="space-y-2">
                    {sorted.map(([id, count]) => (
                      <div key={id} className="flex items-center gap-3">
                        <div
                          className="h-2 rounded-full bg-brand-400"
                          style={{ width: `${Math.round((count / data.total) * 100)}%`, minWidth: 8 }}
                        />
                        <span className="text-sm text-slate-700 whitespace-nowrap">
                          {IMPROVEMENT_LABEL[id] ?? id}
                        </span>
                        <span className="text-xs text-slate-400 ml-auto">{count}×</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Individual responses */}
            {data.total === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-400">
                Zatím žádné odpovědi.
              </div>
            ) : (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-700">Všechny odpovědi</h2>
                {data.responses.map((r) => (
                  <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <Stars rating={r.rating} />
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        {new Date(r.submittedAt).toLocaleString('cs-CZ')}
                      </span>
                    </div>

                    {r.improvements.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {r.improvements.map((imp) => (
                          <span
                            key={imp}
                            className="text-xs bg-brand-50 text-brand-700 border border-brand-100 px-2 py-0.5 rounded-full"
                          >
                            {IMPROVEMENT_LABEL[imp] ?? imp}
                          </span>
                        ))}
                      </div>
                    )}

                    {r.comment && (
                      <p className="text-sm text-slate-700 leading-relaxed">{r.comment}</p>
                    )}

                    {r.email && (
                      <p className="text-xs text-slate-400 mt-2">
                        📧 <a href={`mailto:${r.email}`} className="hover:underline">{r.email}</a>
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
