import type { SearchResponse, SearchStreamEvent } from '@sdf/types';
import {
  appendSearchJobEvent,
  claimSearchJob,
  createProductionAustriaSearchCoordinator,
  getSearchCache,
  markSearchJobFailed,
  storeSearchJobResult,
  type SearchJobPayload,
} from '@sdf/platform';

const workerConcurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 2));
const pollIntervalMs = Math.max(250, Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1000));

let shuttingDown = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function responseFromCompleteEvent(
  job: SearchJobPayload,
  event: Extract<SearchStreamEvent, { type: 'complete' }>,
): SearchResponse {
  return {
    results: event.results,
    total: event.total,
    sources: event.sources,
    query: job.request.query,
    executionMs: event.executionMs,
  };
}

async function processJob(job: SearchJobPayload): Promise<void> {
  const coordinator = createProductionAustriaSearchCoordinator(getSearchCache());

  try {
    for await (const event of coordinator.searchStream(job.request)) {
      await appendSearchJobEvent(job.jobId, event);

      if (event.type === 'complete') {
        await storeSearchJobResult(job, responseFromCompleteEvent(job, event));
      }
    }
  } catch (error) {
    const message = (error as Error).message;
    console.error(`[worker-at] job ${job.jobId} failed:`, error);
    await markSearchJobFailed(job, message);
  }
}

async function run(): Promise<void> {
  console.log(`[worker-at] starting with concurrency=${workerConcurrency}`);
  const active = new Set<Promise<void>>();

  while (!shuttingDown) {
    while (active.size < workerConcurrency) {
      const job = await claimSearchJob('at');
      if (!job) break;

      const task = processJob(job).finally(() => active.delete(task));
      active.add(task);
    }

    if (active.size === 0) {
      await sleep(pollIntervalMs);
      continue;
    }

    await Promise.race(active);
  }

  await Promise.allSettled(active);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shuttingDown = true;
  });
}

run().catch((error) => {
  console.error('[worker-at] fatal error:', error);
  process.exitCode = 1;
});
