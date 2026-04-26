import { getRedisClient } from './redis';

interface CounterState {
  count: number;
  resetAt: number;
}

const memoryCounters = new Map<string, CounterState>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimitInput {
  namespace: string;
  identifier: string;
  limit: number;
  windowMs: number;
}

function memoryRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const current = memoryCounters.get(key);

  if (!current || current.resetAt <= now) {
    memoryCounters.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterMs: windowMs };
  }

  current.count += 1;
  memoryCounters.set(key, current);

  return {
    allowed: current.count <= limit,
    remaining: Math.max(0, limit - current.count),
    retryAfterMs: Math.max(0, current.resetAt - now),
  };
}

export async function checkRateLimit({
  namespace,
  identifier,
  limit,
  windowMs,
}: RateLimitInput): Promise<RateLimitResult> {
  const key = `ratelimit:${namespace}:${identifier}`;
  const redis = await getRedisClient();

  if (!redis) {
    return memoryRateLimit(key, limit, windowMs);
  }

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.pExpire(key, windowMs);
  }

  const ttl = await redis.pTTL(key);
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterMs: ttl > 0 ? ttl : windowMs,
  };
}
