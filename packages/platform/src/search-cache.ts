import type { SearchResponse } from '@sdf/types';
import type { SearchCache } from '@sdf/core';
import { DEFAULT_SEARCH_CACHE_TTL_MS } from '@sdf/core';
import { getRedisClient } from './redis';

interface MemoryCacheEntry {
  response: SearchResponse;
  expiresAt: number;
}

const memoryCache = new Map<string, MemoryCacheEntry>();

function namespacedKey(key: string): string {
  return `search:result:${key}`;
}

function pruneMemoryCache() {
  const now = Date.now();
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt <= now) memoryCache.delete(key);
  }
}

export class MemorySearchCache implements SearchCache {
  async get(key: string): Promise<SearchResponse | null> {
    pruneMemoryCache();
    const cached = memoryCache.get(key);
    return cached?.response ?? null;
  }

  async set(
    key: string,
    response: SearchResponse,
    ttlMs = DEFAULT_SEARCH_CACHE_TTL_MS,
  ): Promise<void> {
    memoryCache.set(key, { response, expiresAt: Date.now() + ttlMs });
    pruneMemoryCache();
  }
}

export class RedisSearchCache implements SearchCache {
  async get(key: string): Promise<SearchResponse | null> {
    const redis = await getRedisClient();
    if (!redis) return null;

    const raw = await redis.get(namespacedKey(key));
    return raw ? (JSON.parse(raw) as SearchResponse) : null;
  }

  async set(
    key: string,
    response: SearchResponse,
    ttlMs = DEFAULT_SEARCH_CACHE_TTL_MS,
  ): Promise<void> {
    const redis = await getRedisClient();
    if (!redis) return;

    await redis.set(namespacedKey(key), JSON.stringify(response), {
      PX: ttlMs,
    });
  }
}

let sharedSearchCache: SearchCache | null = null;

export function getSearchCache(): SearchCache {
  if (!sharedSearchCache) {
    sharedSearchCache = process.env.REDIS_URL
      ? new RedisSearchCache()
      : new MemorySearchCache();
  }
  return sharedSearchCache;
}
