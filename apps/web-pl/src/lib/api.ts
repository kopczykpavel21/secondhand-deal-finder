import type { SearchResponse, SearchFilters } from '@sdf/types';

export async function searchListings(
  query: string,
  filters?: SearchFilters & { debug?: boolean; limit?: number },
): Promise<SearchResponse> {
  const params = new URLSearchParams({ query });

  if (filters?.priceMin != null) params.set('priceMin', String(filters.priceMin));
  if (filters?.priceMax != null) params.set('priceMax', String(filters.priceMax));
  if (filters?.location) params.set('location', filters.location);
  if (filters?.locationRadius != null)
    params.set('locationRadius', String(filters.locationRadius));
  if (filters?.sources?.length) params.set('sources', filters.sources.join(','));
  if (filters?.sortBy) params.set('sortBy', filters.sortBy);
  if (filters?.debug) params.set('debug', 'true');
  if (filters?.limit != null) params.set('limit', String(filters.limit));

  const res = await fetch(`/api/search?${params.toString()}`);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.json();
}
