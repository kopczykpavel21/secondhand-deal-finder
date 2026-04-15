/**
 * Simple browser pool: limits concurrent Playwright contexts to MAX_CONTEXTS.
 *
 * Uses a semaphore (no external dependency) to queue callers when all slots
 * are occupied.  A single shared Browser instance is reused across contexts.
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';

// Railway 1 GB RAM: run only one Playwright page at a time to prevent OOM.
// Sbazar / Vinted each load a heavy React SPA — running them concurrently
// crashes the shared Chromium process and invalidates both contexts.
const MAX_CONTEXTS = 1;

// Hard cap on how long a single page operation may run (navigation + fn).
// Adapters have their own shorter timeouts for individual waitForSelector
// calls; this is a last-resort backstop.
const PAGE_OP_TIMEOUT_MS = 45_000;

// ─── Semaphore ────────────────────────────────────────────────────────────────

class Semaphore {
  private count: number;
  private queue: Array<() => void> = [];

  constructor(max: number) {
    this.count = max;
  }

  acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.count++;
    }
  }
}

// ─── Shared state ─────────────────────────────────────────────────────────────

const sem = new Semaphore(MAX_CONTEXTS);
let sharedBrowser: Browser | null = null;

async function getSharedBrowser(): Promise<Browser> {
  // Reset dead browser before trying to reuse it
  if (sharedBrowser && !sharedBrowser.isConnected()) {
    sharedBrowser = null;
  }
  if (!sharedBrowser) {
    const thisBrowser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-default-apps',
        '--no-first-run',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--mute-audio',
      ],
    });
    sharedBrowser = thisBrowser;
    // ⚠️  Capture the instance by value — if a NEW browser is launched before
    // this one fires 'disconnected', the handler must not wipe out the new ref.
    thisBrowser.on('disconnected', () => {
      if (sharedBrowser === thisBrowser) sharedBrowser = null;
    });
  }
  return sharedBrowser;
}

async function newContext(): Promise<BrowserContext> {
  const browser = await getSharedBrowser();
  return browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
    viewport: { width: 1280, height: 900 },
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Acquire a semaphore slot, open a browser context+page, run fn, then release.
 *
 * Resilience features:
 * - If the browser crashes between acquire() and newContext() (e.g. OOM in
 *   the previous operation), we null-out sharedBrowser and retry once so the
 *   next call gets a fresh process instead of a permanent error.
 * - A hard PAGE_OP_TIMEOUT_MS deadline races against fn() so a stuck page
 *   can't block the semaphore slot forever.
 * - Default navigation / action timeouts are set on the page object so even
 *   Playwright waitFor* calls that don't specify a timeout are bounded.
 */
export async function withPooledPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  await sem.acquire();
  let ctx: BrowserContext | null = null;
  try {
    // If the browser died between acquire() and here, null it out and try once more.
    ctx = await newContext().catch(async (err) => {
      sharedBrowser = null;
      // Small pause so the OS can reap the old process before we launch a new one
      await sleep(500);
      return newContext();
    });

    const page = await ctx.newPage();

    // Bound every navigation and Playwright wait call on this page
    page.setDefaultNavigationTimeout(PAGE_OP_TIMEOUT_MS);
    page.setDefaultTimeout(PAGE_OP_TIMEOUT_MS);

    try {
      // Race fn against a hard deadline so a hung page never holds the semaphore
      return await Promise.race([
        fn(page),
        sleep(PAGE_OP_TIMEOUT_MS).then(() => {
          throw new Error(`withPooledPage: operation timed out after ${PAGE_OP_TIMEOUT_MS}ms`);
        }),
      ]);
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await ctx?.close().catch(() => {});
    sem.release();
  }
}

/** Close the shared browser. Call on process exit if desired. */
export async function closeBrowserPool(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
