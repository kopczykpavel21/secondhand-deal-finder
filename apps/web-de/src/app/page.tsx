'use client';

import { useState, useEffect } from 'react';
import type { SearchFilters } from '@sdf/types';
import { useSearch } from '@/hooks/useSearch';
import { SearchBar } from '@/components/SearchBar';
import { FilterPanel } from '@/components/FilterPanel';
import { ResultCard } from '@/components/ResultCard';
import { SourceStatusBar } from '@/components/SourceStatusBar';
import { LoadingAnimation } from '@/components/LoadingAnimation';

const PAGE_SIZE = 25;
const FETCH_LIMIT = 50;
const DISMISSED_KEY = 'sdf-de-dismissed';
const MAX_DISMISSED = 500;

function loadDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

function saveDismissed(ids: Set<string>) {
  try {
    const arr = [...ids].slice(-MAX_DISMISSED);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(arr));
  } catch { /* storage full */ }
}

export default function HomePage() {
  const { state, search } = useSearch();
  const [filters, setFilters] = useState<SearchFilters>({ sortBy: 'best_deal' });
  const [currentQuery, setCurrentQuery] = useState('');
  const [debugMode, setDebugMode] = useState(false);
  const [page, setPage] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => { setDismissed(loadDismissed()); }, []);

  function dismissListing(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      saveDismissed(next);
      return next;
    });
  }

  function handleSearch(query: string) {
    setCurrentQuery(query);
    setPage(0);
    search(query, { ...filters, limit: FETCH_LIMIT });
  }

  const isLoading  = state.status === 'loading';
  const isSuccess  = state.status === 'success';
  const activeConditions = filters.conditions ?? [];
  const locationQuery    = (filters.location ?? '').trim().toLowerCase();

  const allResults = (isLoading || isSuccess ? state.results : [])
    .filter((r) => !dismissed.has(r.id))
    .filter((r) => activeConditions.length === 0 || activeConditions.includes(r.condition))
    .filter((r) => !locationQuery || (r.location ?? '').toLowerCase().includes(locationQuery));
  const sources    = isLoading || isSuccess ? state.sources : [];
  const total      = isLoading || isSuccess ? state.total   : 0;

  // Market price median
  const marketPrices = allResults
    .filter((r) => r.scoreComponents.relevance > 0.5 && r.price != null)
    .map((r) => r.price as number)
    .sort((a, b) => a - b);
  const marketMedian =
    marketPrices.length >= 3
      ? marketPrices[Math.floor(marketPrices.length / 2)]
      : null;

  const pageStart   = page * PAGE_SIZE;
  const results     = allResults.slice(pageStart, pageStart + PAGE_SIZE);
  const hasResults  = allResults.length > 0;
  const hasNextPage = allResults.length > pageStart + PAGE_SIZE;
  const hasPrevPage = page > 0;
  const noResults   = isSuccess && allResults.length === 0;
  const showAnimation = isLoading && !hasResults;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50">
      {/* Header */}
      <header className="pt-12 pb-8 px-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-brand-100 text-brand-700 text-xs font-semibold px-3 py-1 rounded-full mb-4">
            <span className="w-2 h-2 bg-brand-500 rounded-full animate-pulse" />
            Beta · Vinted · willhaben · Kleinanzeigen
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
            Secondhand Schnäppchen Finder
          </h1>
          <p className="mt-2 text-slate-500 text-base sm:text-lg max-w-md mx-auto">
            Finde die besten Angebote auf Vinted, willhaben und Kleinanzeigen – sortiert nach echtem Wert.
          </p>
        </div>

        {/* Search */}
        <div className="max-w-2xl mx-auto space-y-3">
          <SearchBar onSearch={handleSearch} loading={isLoading} />
          <FilterPanel filters={filters} onChange={setFilters} />
          <button
            onClick={() => setDebugMode((v) => !v)}
            className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
              debugMode
                ? 'bg-brand-50 border-brand-300 text-brand-700 font-medium'
                : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            {debugMode ? 'Score ausblenden' : 'Score anzeigen'}
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-2xl mx-auto px-4 pb-16">

        {showAnimation && (
          <LoadingAnimation
            completedSources={state.completedSources}
            totalSources={state.totalSources}
            activeSource={state.activeSource}
            completedStatuses={state.sources}
          />
        )}

        {hasResults && (
          <>
            {/* Meta bar */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div className="text-sm text-slate-500">
                  <span className="font-semibold text-slate-800">{pageStart + 1}–{pageStart + results.length}</span>
                  {' '}von {total} Ergebnissen · „{currentQuery}"
                  {isSuccess && (
                    <span className="text-slate-400"> · {state.executionMs}ms</span>
                  )}
                  {marketMedian != null && (
                    <span className="ml-2 text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                      Marktpreis ~{new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(marketMedian)}
                    </span>
                  )}
                </div>
                {isLoading && (
                  <span className="w-4 h-4 border-2 border-slate-200 border-t-brand-500 rounded-full animate-spin" />
                )}
              </div>
              <SourceStatusBar sources={sources} />
            </div>

            {/* Loading pills */}
            {isLoading && (
              <div className="mb-3">
                <LoadingAnimation
                  completedSources={state.completedSources}
                  totalSources={state.totalSources}
                  activeSource={state.activeSource}
                  completedStatuses={state.sources}
                />
              </div>
            )}

            <div className="space-y-3">
              {results.map((listing, i) => (
                <ResultCard
                  key={listing.id}
                  listing={listing}
                  rank={pageStart + i + 1}
                  debugMode={debugMode}
                  onDismiss={() => dismissListing(listing.id)}
                />
              ))}
            </div>

            {/* Pagination */}
            {(hasPrevPage || hasNextPage) && (
              <div className="mt-6 flex items-center justify-center gap-3">
                {hasPrevPage && (
                  <button
                    onClick={() => { setPage((p) => p - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    className="px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:border-brand-400 hover:text-brand-600 transition-colors shadow-sm"
                  >
                    ← Zurück
                  </button>
                )}
                <span className="text-sm text-slate-400">
                  Seite {page + 1} von {Math.ceil(allResults.length / PAGE_SIZE)}
                </span>
                {hasNextPage && (
                  <button
                    onClick={() => { setPage((p) => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    className="px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:border-brand-400 hover:text-brand-600 transition-colors shadow-sm"
                  >
                    Weiter →
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* Error */}
        {state.status === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
            <p className="font-semibold text-red-700">Suche fehlgeschlagen</p>
            <p className="text-red-500 text-sm mt-1">{state.message}</p>
          </div>
        )}

        {/* No results */}
        {noResults && (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <svg className="w-12 h-12 text-slate-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-semibold text-slate-700">Keine Ergebnisse</p>
            <p className="text-slate-400 text-sm mt-1">Versuche andere Suchbegriffe oder passe die Filter an.</p>
          </div>
        )}

        {/* Empty state */}
        {state.status === 'idle' && (
          <div className="text-center mt-16 text-slate-400 space-y-3">
            <svg className="w-16 h-16 mx-auto text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p className="font-medium text-slate-400">Was suchen Sie?</p>
            <p className="text-sm text-slate-300">Wir durchsuchen Vinted, willhaben und Kleinanzeigen gleichzeitig.</p>
          </div>
        )}
      </main>

      <footer className="text-center text-xs text-slate-400 pb-8">
        Secondhand Schnäppchen Finder · Beta · Daten von Drittanbietern, nur zur Information
      </footer>
    </div>
  );
}
