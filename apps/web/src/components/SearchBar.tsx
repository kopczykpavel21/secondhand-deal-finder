'use client';

import { useState, FormEvent, useEffect } from 'react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  loading?: boolean;
}

const SUGGESTIONS = [
  'iPhone 13 128GB',
  'kolo horské',
  'zimní bunda',
  'MacBook Pro',
  'PlayStation 5',
  'dětský kočárek',
];

const RECENT_KEY    = 'sdf-recent-searches';
const MAX_RECENT    = 8;

function loadRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

function saveRecent(query: string) {
  try {
    const existing = loadRecent().filter((q) => q.toLowerCase() !== query.toLowerCase());
    const next = [query, ...existing].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* storage full */ }
}

function removeRecent(query: string) {
  try {
    const next = loadRecent().filter((q) => q !== query);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

export function SearchBar({ onSearch, loading }: SearchBarProps) {
  const [query, setQuery]       = useState('');
  const [recent, setRecent]     = useState<string[]>([]);
  const [showRecent, setShowRecent] = useState(false);

  // Load from localStorage after mount (avoids SSR mismatch)
  useEffect(() => { setRecent(loadRecent()); }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    submit(q);
  }

  function submit(q: string) {
    setQuery(q);
    setShowRecent(false);
    saveRecent(q);
    setRecent(loadRecent());
    onSearch(q);
  }

  function handleRemove(q: string, e: React.MouseEvent) {
    e.stopPropagation();
    removeRecent(q);
    setRecent(loadRecent());
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="relative">
        <div className="flex items-center bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-brand-500 transition-all">
          <svg
            className="w-5 h-5 ml-4 text-slate-400 shrink-0"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setShowRecent(true)}
            onBlur={() => setTimeout(() => setShowRecent(false), 150)}
            placeholder="Co hledáte? Např. iPhone 13, kolo, zimní bunda..."
            className="flex-1 px-4 py-4 text-base text-slate-900 placeholder-slate-400 bg-transparent outline-none"
            autoComplete="off"
            autoFocus
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="mr-2 w-6 h-6 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="m-1.5 px-6 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white font-semibold rounded-xl transition-colors text-sm whitespace-nowrap"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Spinner />
                Hledám…
              </span>
            ) : (
              'Hledat'
            )}
          </button>
        </div>

        {/* Recent searches dropdown */}
        {showRecent && recent.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden">
            <p className="px-4 pt-3 pb-1 text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Nedávná hledání
            </p>
            {recent.map((q) => (
              <div
                key={q}
                onMouseDown={() => submit(q)}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 cursor-pointer group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm text-slate-700 truncate">{q}</span>
                </div>
                <button
                  onMouseDown={(e) => handleRemove(q, e)}
                  className="w-5 h-5 flex items-center justify-center rounded-full text-slate-300 hover:text-slate-500 hover:bg-slate-200 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </form>

      {/* Chips: recent searches first, then suggestions for what's not already saved */}
      <div className="flex flex-wrap gap-2 mt-3 justify-center">
        {recent.slice(0, 4).map((q) => (
          <button
            key={`r-${q}`}
            onClick={() => submit(q)}
            className="px-3 py-1 text-xs bg-brand-50 border border-brand-200 rounded-full text-brand-700 hover:bg-brand-100 transition-colors flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {q}
          </button>
        ))}
        {SUGGESTIONS.filter((s) => !recent.some((r) => r.toLowerCase() === s.toLowerCase()))
          .slice(0, Math.max(0, 6 - Math.min(recent.length, 4)))
          .map((s) => (
            <button
              key={`s-${s}`}
              onClick={() => submit(s)}
              className="px-3 py-1 text-xs bg-white border border-slate-200 rounded-full text-slate-600 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 transition-colors"
            >
              {s}
            </button>
          ))}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
