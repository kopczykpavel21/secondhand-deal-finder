/**
 * Replay the ranking pipeline over frozen search results and print the top of
 * each list — the quick way to see what a scoring change does to real results.
 *
 *   npx tsx scripts/replay-ranking.ts                 # every fixture, default sort
 *   npx tsx scripts/replay-ranking.ts iphone-13       # one fixture
 *   npx tsx scripts/replay-ranking.ts --sort best_deal --top 20
 *
 * Save the output before a change and diff it afterwards.
 */
import type { SortOption } from '@sdf/types';
import { czMarket } from '@sdf/types';
import { rankListings } from '../packages/core/src/ranking.js';
import {
  FIXTURE_SLUGS,
  loadRankingFixture,
  type FixtureSlug,
} from '../packages/core/src/__fixtures__/ranking/load.js';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const sorts = flag('sort', 'most_relevant,best_deal').split(',') as SortOption[];
const top = Number(flag('top', '12'));
const flagValues = new Set(['sort', 'top'].flatMap((n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? [args[i], args[i + 1]] : [];
}));
const wanted = args.filter((a) => !flagValues.has(a));
const slugs = (wanted.length ? wanted : [...FIXTURE_SLUGS]) as FixtureSlug[];

for (const slug of slugs) {
  const fixture = loadRankingFixture(slug);
  for (const sortBy of sorts) {
    const { results } = rankListings(fixture.listings, fixture.query, { sortBy }, czMarket);
    const mix: Record<string, number> = {};
    for (const r of results.slice(0, 50)) mix[r.source] = (mix[r.source] ?? 0) + 1;
    const scores = results.slice(0, 50).map((r) => r.score);
    console.log(
      `\n=== "${fixture.query}" · ${sortBy} · ${fixture.listings.length} raw → ${results.length} kept` +
      ` · top-50 scores ${Math.min(...scores)}–${Math.max(...scores)} · top-50 mix ${JSON.stringify(mix)}`,
    );
    results.slice(0, top).forEach((r, i) => {
      const c = r.scoreComponents;
      const price = r.price == null ? '—' : String(Math.round(r.price));
      console.log(
        `${String(i + 1).padStart(3)} ${String(r.score).padStart(3)} ${r.source.padEnd(6)} ${price.padStart(7)}` +
        `  rel=${c.relevance.toFixed(2)} vfm=${c.valueForMoney.toFixed(2)}  ${r.title.slice(0, 68)}`,
      );
    });
  }
}
