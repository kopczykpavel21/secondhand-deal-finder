/**
 * Simple browser pool: limits concurrent Playwright contexts to MAX_CONTEXTS.
 *
 * Uses a semaphore (no external dependency) to queue callers when all slots
 * are occupied.  A single shared Browser instance is reused across contexts.
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';

// Keep concurrency low — Railway free tier has 1 GB RAM shared with Next.js
const MAX_CONTEXTS = 2;

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
    sharedBrowser = await chromium.launch({
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
    // Auto-clear reference when browser unexpectedly closes
    sharedBrowser.on('disconnected', () => { sharedBrowser = null; });
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
 * Errors in fn are propagated; resources are always cleaned up.
 */
export async function withPooledPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  await sem.acquire();
  let ctx: BrowserContext | null = null;
  try {
    ctx = await newContext();
    const page = await ctx.newPage();
    try {
      return await fn(page);
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
