import { createHash, randomUUID } from 'crypto';
import type { MarketId, SearchRequest, SearchResponse, SearchStreamEvent } from '@sdf/types';
import { createSearchCacheKey } from '@sdf/core';
import { getRedisClient } from './redis';

export type SearchJobEvent =
  | SearchStreamEvent
  | { type: 'error'; message: string };

export interface SearchJobPayload {
  jobId: string;
  market: MarketId;
  cacheKey: string;
  request: SearchRequest;
  createdAt: string;
}

export interface SearchJobState {
  jobId: string;
  market: MarketId;
  cacheKey: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  updatedAt: string;
  error?: string;
}

const JOB_TTL_MS = Number(process.env.SEARCH_JOB_TTL_MS ?? 15 * 60 * 1_000);

function cacheHash(cacheKey: string): string {
  return createHash('sha1').update(cacheKey).digest('hex');
}

function queueKey(market: MarketId): string {
  return `search:jobs:queue:${market}`;
}

function activeJobKey(market: MarketId, cacheKey: string): string {
  return `search:jobs:active:${market}:${cacheHash(cacheKey)}`;
}

function eventsKey(jobId: string): string {
  return `search:jobs:${jobId}:events`;
}

function stateKey(jobId: string): string {
  return `search:jobs:${jobId}:state`;
}

function requestKey(jobId: string): string {
  return `search:jobs:${jobId}:request`;
}

function resultKey(jobId: string): string {
  return `search:jobs:${jobId}:result`;
}

export function isWorkerSearchEnabled(): boolean {
  return process.env.SEARCH_WORKER_ENABLED === 'true' && Boolean(process.env.REDIS_URL);
}

export async function enqueueSearchJob(
  market: MarketId,
  request: SearchRequest,
): Promise<SearchJobPayload | null> {
  const redis = await getRedisClient();
  if (!redis) return null;

  const cacheKey = createSearchCacheKey(request, 50, 100, market);
  const activeKey = activeJobKey(market, cacheKey);
  const existingJobId = await redis.get(activeKey);
  if (existingJobId) {
    return {
      jobId: existingJobId,
      market,
      cacheKey,
      request,
      createdAt: new Date().toISOString(),
    };
  }

  const payload: SearchJobPayload = {
    jobId: `job_${randomUUID()}`,
    market,
    cacheKey,
    request,
    createdAt: new Date().toISOString(),
  };

  const acquired = await redis.set(activeKey, payload.jobId, {
    NX: true,
    PX: JOB_TTL_MS,
  });

  if (!acquired) {
    const winner = await redis.get(activeKey);
    if (!winner) return payload;
    return {
      jobId: winner,
      market,
      cacheKey,
      request,
      createdAt: new Date().toISOString(),
    };
  }

  const state: SearchJobState = {
    jobId: payload.jobId,
    market,
    cacheKey,
    status: 'queued',
    updatedAt: new Date().toISOString(),
  };

  await Promise.all([
    redis.set(requestKey(payload.jobId), JSON.stringify(payload), { PX: JOB_TTL_MS }),
    redis.set(stateKey(payload.jobId), JSON.stringify(state), { PX: JOB_TTL_MS }),
    redis.rPush(queueKey(market), JSON.stringify(payload)),
  ]);

  return payload;
}

export async function claimSearchJob(market: MarketId): Promise<SearchJobPayload | null> {
  const redis = await getRedisClient();
  if (!redis) return null;

  const raw = await redis.lPop(queueKey(market));
  if (!raw) return null;

  const payload = JSON.parse(raw) as SearchJobPayload;
  const state: SearchJobState = {
    jobId: payload.jobId,
    market: payload.market,
    cacheKey: payload.cacheKey,
    status: 'running',
    updatedAt: new Date().toISOString(),
  };

  await redis.set(stateKey(payload.jobId), JSON.stringify(state), { PX: JOB_TTL_MS });
  return payload;
}

export async function appendSearchJobEvent(jobId: string, event: SearchJobEvent): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;

  await Promise.all([
    redis.rPush(eventsKey(jobId), JSON.stringify(event)),
    redis.pExpire(eventsKey(jobId), JOB_TTL_MS),
  ]);
}

export async function readSearchJobEvents(jobId: string, fromIndex = 0): Promise<SearchJobEvent[]> {
  const redis = await getRedisClient();
  if (!redis) return [];

  const raw = await redis.lRange(eventsKey(jobId), fromIndex, -1);
  return raw.map((entry) => JSON.parse(entry) as SearchJobEvent);
}

export async function storeSearchJobResult(job: SearchJobPayload, response: SearchResponse): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;

  const state: SearchJobState = {
    jobId: job.jobId,
    market: job.market,
    cacheKey: job.cacheKey,
    status: 'complete',
    updatedAt: new Date().toISOString(),
  };

  await Promise.all([
    redis.set(resultKey(job.jobId), JSON.stringify(response), { PX: JOB_TTL_MS }),
    redis.set(stateKey(job.jobId), JSON.stringify(state), { PX: JOB_TTL_MS }),
    redis.pExpire(activeJobKey(job.market, job.cacheKey), JOB_TTL_MS),
  ]);
}

export async function markSearchJobFailed(job: SearchJobPayload, error: string): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;

  const state: SearchJobState = {
    jobId: job.jobId,
    market: job.market,
    cacheKey: job.cacheKey,
    status: 'failed',
    updatedAt: new Date().toISOString(),
    error,
  };

  await Promise.all([
    redis.set(stateKey(job.jobId), JSON.stringify(state), { PX: JOB_TTL_MS }),
    appendSearchJobEvent(job.jobId, { type: 'error', message: error }),
    redis.del(activeJobKey(job.market, job.cacheKey)),
  ]);
}

export async function getSearchJobResult(jobId: string): Promise<SearchResponse | null> {
  const redis = await getRedisClient();
  if (!redis) return null;

  const raw = await redis.get(resultKey(jobId));
  return raw ? (JSON.parse(raw) as SearchResponse) : null;
}

export async function getSearchJobState(jobId: string): Promise<SearchJobState | null> {
  const redis = await getRedisClient();
  if (!redis) return null;

  const raw = await redis.get(stateKey(jobId));
  return raw ? (JSON.parse(raw) as SearchJobState) : null;
}
