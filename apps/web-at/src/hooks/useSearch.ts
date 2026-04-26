'use client';

import { useState, useCallback, useRef } from 'react';
import type { SearchFilters, ScoredListing, SourceStatus, Source } from '@sdf/types';

export type SearchState =
  | { status: 'idle' }
  | {
      status: 'loading';
      results: ScoredListing[];
      sources: SourceStatus[];
      total: number;
      activeSource: Source | null;
      completedSources: number;
      totalSources: number;
    }
  | {
      status: 'success';
      results: ScoredListing[];
      sources: SourceStatus[];
      total: number;
      executionMs: number;
      query: string;
    }
  | { status: 'error'; message: string };

export function useSearch() {
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(
    async (query: string, filters?: SearchFilters & { debug?: boolean; limit?: number }) => {
      if (!query.trim()) return;

      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      setState({
        status: 'loading',
        results: [],
        sources: [],
        total: 0,
        activeSource: null,
        completedSources: 0,
        totalSources: 0,
      });

      try {
        const params = new URLSearchParams({ query });
        if (filters?.priceMin != null) params.set('priceMin', String(filters.priceMin));
        if (filters?.priceMax != null) params.set('priceMax', String(filters.priceMax));
        if (filters?.sources?.length) params.set('sources', filters.sources.join(','));
        if (filters?.sortBy) params.set('sortBy', filters.sortBy);
        if (filters?.limit != null) params.set('limit', String(filters.limit));

        const res = await fetch(`/api/search/stream?${params}`, { signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const part of parts) {
            const line = part.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;

            let event: Record<string, unknown>;
            try { event = JSON.parse(line.slice(6)); } catch { continue; }

            if (event.type === 'source_done') {
              setState((prev) => ({
                status: 'loading',
                results: event.results as ScoredListing[],
                sources: [
                  ...(prev.status === 'loading' ? prev.sources : []),
                  event.status as SourceStatus,
                ],
                total: event.total as number,
                activeSource: (event.status as SourceStatus).source,
                completedSources: event.completedSources as number,
                totalSources: event.totalSources as number,
              }));
            } else if (event.type === 'complete') {
              setState({
                status: 'success',
                results: event.results as ScoredListing[],
                sources: event.sources as SourceStatus[],
                total: event.total as number,
                executionMs: event.executionMs as number,
                query,
              });
            } else if (event.type === 'error') {
              setState({ status: 'error', message: event.message as string });
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setState({ status: 'error', message: (err as Error).message });
      }
    },
    [],
  );

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, search, reset };
}
