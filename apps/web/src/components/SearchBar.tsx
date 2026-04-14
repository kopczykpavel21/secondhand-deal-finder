'use client';

import { useState, FormEvent } from 'react';

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

export function SearchBar({ onSearch, loading }: SearchBarProps) {
  const [query, setQuery] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (query.trim()) onSearch(query.trim());
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="relative">
        <div className="flex items-center bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-brand-500 transition-all">
          <svg
            className="w-5 h-5 ml-4 text-slate-400 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Co hledáte? Např. iPhone 13, kolo, zimní bunda..."
            className="flex-1 px-4 py-4 text-base text-slate-900 placeholder-slate-400 bg-transparent outline-none"
            autoComplete="off"
            autoFocus
          />
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
      </form>

      {/* Quick suggestion chips */}
      <div className="flex flex-wrap gap-2 mt-3 justify-center">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => {
              setQuery(s);
              onSearch(s);
            }}
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
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
