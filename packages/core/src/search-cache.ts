import type { SearchRequest, SearchResponse } from '@sdf/types';

export interface SearchCache {
  get(key: string): Promise<SearchResponse | null>;
  set(key: string, response: SearchResponse, ttlMs?: number): Promise<void>;
}

export const DEFAULT_SEARCH_CACHE_TTL_MS = 20 * 60 * 1_000;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]);
    return Object.fromEntries(entries);
  }

  return value;
}

export function createSearchCacheKey(
  request: SearchRequest,
  defaultLimit = 50,
  maxLimit = 100,
  namespace?: string,
): string {
  return JSON.stringify(stableValue({
    n: namespace ?? 'default',
    q: request.query.toLowerCase().trim(),
    f: request.filters ?? {},
    l: Math.min(request.limit ?? defaultLimit, maxLimit),
  }));
}
