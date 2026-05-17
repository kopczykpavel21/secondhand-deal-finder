'use client';

import { useState } from 'react';
import type { ScoredListing } from '@sdf/types';
import { ScoreBadge } from './ScoreBadge';
import { SourceBadge } from './SourceBadge';
import clsx from 'clsx';

interface ResultCardProps {
  listing: ScoredListing;
  rank: number;
  debugMode?: boolean;
  onDismiss?: () => void;
}

function formatPrice(price: number | null, currency: string): string {
  if (price === null) return 'Brak ceny';
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}

function formatDate(date: Date | string | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const hours = diff / 3_600_000;
  if (hours < 1) return 'Dodano przed chwilą';
  if (hours < 24) return `${Math.floor(hours)} godz. temu`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Wczoraj';
  if (days < 7) return `${days} dni temu`;
  return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
}

const CONDITION_LABEL: Record<string, string> = {
  new: 'Nowe',
  like_new: 'Jak nowe',
  good: 'Dobry stan',
  fair: 'Używane',
  poor: 'Uszkodzone',
  unknown: '',
};

const STALE_MS = 21 * 86_400_000; // 21 days

type DescState = 'idle' | 'loading' | 'done' | 'unavailable';

export function ResultCard({ listing, rank, debugMode, onDismiss }: ResultCardProps) {
  const [showExplanation, setShowExplanation] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [descState, setDescState] = useState<DescState>('idle');
  const [lazyDesc, setLazyDesc] = useState<string | null>(null);

  async function loadDescription() {
    setDescState('loading');
    try {
      const params = new URLSearchParams({ url: listing.url, source: listing.source });
      const res = await fetch(`/api/listing-description?${params}`);
      const data = (await res.json()) as { description: string | null };
      if (data.description) {
        setLazyDesc(data.description);
        setDescState('done');
      } else {
        setDescState('unavailable');
      }
    } catch {
      setDescState('unavailable');
    }
  }

  const listedAt = listing.postedAt ? new Date(listing.postedAt) : null;
  const likelySold =
    !listing.promoted &&
    listedAt !== null &&
    Date.now() - listedAt.getTime() > STALE_MS;

  return (
    <article className={clsx(
      'relative bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden',
      listing.promoted && 'ring-1 ring-amber-300',
    )}>
      {/* Dismiss button */}
      {onDismiss && (
        <button
          onClick={onDismiss}
          title="Ukryj tę ofertę"
          className="absolute top-2 right-2 z-10 w-5 h-5 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* Probably sold warning */}
      {likelySold && (
        <div className="bg-amber-50 border-b border-amber-200 px-3 py-1.5 text-xs text-amber-700 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Prawdopodobnie sprzedane — oferta ma ponad 3 tygodnie
        </div>
      )}

      <div className="flex gap-0">
        {/* Image */}
        <div className="relative shrink-0 w-28 sm:w-36 bg-slate-100">
          {listing.imageUrl && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.imageUrl}
              alt={listing.title}
              className="w-full h-full object-cover aspect-square"
              loading="lazy"
              decoding="async"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="w-full aspect-square flex items-center justify-center">
              <svg className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}

          {/* Rank badge */}
          <div className="absolute top-1.5 left-1.5 w-6 h-6 bg-slate-800 text-white rounded-full flex items-center justify-center text-xs font-bold">
            {rank}
          </div>

          {listing.promoted && (
            <div className="absolute bottom-0 left-0 right-0 bg-amber-400 text-amber-900 text-center text-xs font-semibold py-0.5">
              Promowane
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 p-3 sm:p-4 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                <SourceBadge source={listing.source} />
                {(listing.conditionText || listing.condition !== 'unknown') && (
                  <span className="text-xs text-slate-500">
                    {listing.conditionText ?? CONDITION_LABEL[listing.condition]}
                  </span>
                )}
                {typeof listing.rawMetadata?.size === 'string' && (
                  <span className="text-xs text-slate-400 border border-slate-200 rounded px-1 py-0.5 leading-none">
                    {listing.rawMetadata.size}
                  </span>
                )}
                {listing.shippingAvailable && (
                  <span className="text-xs text-emerald-600 flex items-center gap-0.5">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    Wysyłka
                  </span>
                )}
              </div>

              <a
                href={listing.url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                className="font-semibold text-slate-900 hover:text-brand-600 transition-colors line-clamp-2 text-sm sm:text-base"
              >
                {listing.title}
              </a>

              {/* Description — inline if already scraped, lazy otherwise */}
              {listing.description ? (
                <p className="mt-1 text-xs text-slate-500 line-clamp-3 leading-relaxed">
                  {listing.description}
                </p>
              ) : descState === 'done' && lazyDesc ? (
                <p className="mt-1 text-xs text-slate-500 line-clamp-3 leading-relaxed">
                  {lazyDesc}
                </p>
              ) : descState === 'unavailable' ? (
                <p className="mt-1 text-xs text-slate-400 italic">Opis jest niedostępny.</p>
              ) : descState === 'loading' ? (
                <p className="mt-1 text-xs text-slate-400 flex items-center gap-1">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Ładuję opis…
                </p>
              ) : (
                <button
                  onClick={loadDescription}
                  className="mt-1 text-xs text-slate-400 hover:text-brand-600 transition-colors flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Pokaż opis
                </button>
              )}

              <div className="flex items-center gap-2 mt-1 text-xs text-slate-400 flex-wrap">
                {listing.location && (
                  <span className="flex items-center gap-0.5">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    </svg>
                    {listing.location}
                  </span>
                )}
                {listing.postedAt && (
                  <span>{formatDate(listing.postedAt)}</span>
                )}
                {listing.likes !== null && listing.likes !== undefined && (
                  <span className="flex items-center gap-0.5 text-rose-400">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                    </svg>
                    {listing.likes}
                  </span>
                )}
              </div>
            </div>

            {/* Score + Price */}
            <div className="flex flex-col items-end gap-1 shrink-0">
              <ScoreBadge score={listing.score} />
              <span className="font-bold text-slate-900 text-base sm:text-lg">
                {formatPrice(listing.price, listing.currency)}
              </span>
            </div>
          </div>

          {/* Why ranked explanation toggle */}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => setShowExplanation((v) => !v)}
              className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Dlaczego taka ocena?
            </button>
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 ml-auto"
            >
              Otwórz ofertę
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>

          {showExplanation && (
            <div className="mt-2 p-3 bg-brand-50 rounded-xl text-xs text-brand-800 space-y-1">
              {listing.scoreExplanation.map((line, i) => (
                <p key={i} className="flex items-start gap-1.5">
                  <span className="mt-0.5 text-brand-400">›</span>
                  {line}
                </p>
              ))}
            </div>
          )}

          {debugMode && (
            <div className="mt-2">
              <button
                onClick={() => setShowDebug((v) => !v)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                {showDebug ? 'Ukryj szczegóły oceny' : 'Szczegóły oceny'}
              </button>
              {showDebug && (
                <div className="mt-2 p-3 bg-slate-50 rounded-xl text-xs font-mono space-y-1 border border-slate-200">
                  <ScoreBreakdown components={listing.scoreComponents} />
                  <p className="text-slate-400 pt-1">
                    id: {listing.id}
                    {listing.dedupeGroup && ` | dedup: ${listing.dedupeGroup}`}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function ScoreBreakdown({ components }: { components: ScoredListing['scoreComponents'] }) {
  const rows: Array<[string, number]> = [
    ['Dopasowanie', components.relevance],
    ['Wartość względem ceny', components.valueForMoney],
    ['Stan', components.condition],
    ['Świeżość', components.freshness],
    ['Kompletność oferty', components.completeness],
    ['Wiarygodność sprzedawcy', components.sellerTrust],
    ['Zainteresowanie kupujących', components.engagement],
    ['Kara: promowanie', components.promotedPenalty],
    ['Kara: spam', components.spamPenalty],
  ];
  return (
    <>
      {rows.map(([label, val]) => (
        <div key={label} className="flex justify-between gap-4">
          <span className="text-slate-500">{label}</span>
          <span className={clsx('font-semibold', val < 0 ? 'text-red-500' : 'text-slate-700')}>
            {(val * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </>
  );
}
