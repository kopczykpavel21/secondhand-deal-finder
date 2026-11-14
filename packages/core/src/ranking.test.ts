/**
 * Ranking regression tests — the whole pipeline replayed over frozen results
 * of real searches (see __fixtures__/ranking/load.ts).
 *
 * Run: npx tsx --test packages/core/src/ranking.test.ts
 *
 * Each test states something a person would expect of the result list, not a
 * snapshot of it: the assertions survive re-tuning of weights, and fail when a
 * change brings back what these fixtures showed on 2026-11-13 — an iPhone 5
 * first for "iphone 13", Croatian chargers second to ninth for "garmin
 * fenix 7", a cardboard dummy in the top ten for "samsung galaxy s23".
 *
 * To see the lists themselves: npx tsx scripts/replay-ranking.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ScoredListing, SortOption } from '@sdf/types';
import { czMarket } from '@sdf/types';
import { rankListings } from './ranking.js';
import { loadRankingFixture, type FixtureSlug } from './__fixtures__/ranking/load.js';

const cache = new Map<string, ScoredListing[]>();
function ranked(slug: FixtureSlug, sortBy: SortOption = 'best_deal'): ScoredListing[] {
  const key = `${slug}:${sortBy}`;
  if (!cache.has(key)) {
    const fixture = loadRankingFixture(slug);
    cache.set(key, rankListings(fixture.listings, fixture.query, { sortBy }, czMarket).results);
  }
  return cache.get(key)!;
}
const SORTS: SortOption[] = ['most_relevant', 'best_deal'];
const titles = (list: ScoredListing[]) => list.map((l) => l.title);
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

describe('other models of the same line are not results', () => {
  const cases: Array<[FixtureSlug, RegExp]> = [
    ['iphone-13', /iphone\s*(5|6|7|8|11|12|14|15|16|17)\b/i],
    ['garmin-fenix-7', /f[eé]nix\s*(3|5|6|8)\b/i],
    ['samsung-galaxy-s23', /\bs\s?(20|21|22|24|25)\b/i],
    ['playstation-5', /(playstation|ps)\s*(2|3|4)\b/i],
    ['macbook-air-m1', /\bm\s?(2|3|4)\b(?!.*\bm\s?1\b)/i],
  ];
  for (const [slug, otherModel] of cases) {
    it(slug, () => {
      for (const sortBy of SORTS) {
        // a listing may mention another model next to the right one ("iPhone 12/13")
        const fixture = loadRankingFixture(slug);
        const wanted = fixture.query.match(/(\d+)\s*$/)![1];
        const offenders = titles(ranked(slug, sortBy).slice(0, 50))
          .filter((t) => otherModel.test(t) && !new RegExp(`(^|\\D)${wanted}(\\D|$)`).test(t));
        assert.deepEqual(offenders, [], `${sortBy}: other models in the top 50`);
      }
    });
  }
});

describe('the top of the list is the product, not something around it', () => {
  it('iphone 13: no blocked phones, boxes or throwaway prices in the top 20', () => {
    for (const sortBy of SORTS) {
      const top = ranked('iphone-13', sortBy).slice(0, 20);
      assert.deepEqual(titles(top).filter((t) => /blokovan|krabičk|empty box/i.test(t)), [], sortBy);
      assert.ok(top.every((l) => (l.price ?? 0) >= 2000), `${sortBy}: a listing under 2 000 Kč in the top 20`);
    }
  });

  it('garmin fenix 7: the top 20 are watches, not straps and chargers', () => {
    for (const sortBy of SORTS) {
      const top = ranked('garmin-fenix-7', sortBy).slice(0, 20);
      // Croatian / Hungarian / Polish accessory words the noun lists do not know
      assert.deepEqual(titles(top).filter((t) => /punjač|remen\b|óraszíj|narukvic|etui/i.test(t)), [], sortBy);
      assert.ok(top.every((l) => (l.price ?? 0) >= 3000), `${sortBy}: a listing under 3 000 Kč in the top 20`);
    }
  });

  it('samsung galaxy s23: no boxes or dummies anywhere', () => {
    for (const sortBy of SORTS) {
      assert.deepEqual(titles(ranked('samsung-galaxy-s23', sortBy)).filter((t) => /\bcutie\b|atrapa/i.test(t)), [], sortBy);
    }
  });

  it('playstation 5: the top 10 cost what a console costs', () => {
    for (const sortBy of SORTS) {
      const top = ranked('playstation-5', sortBy).slice(0, 10);
      assert.ok(top.every((l) => (l.price ?? 0) >= 4000), `${sortBy}: ${titles(top).join(' · ')}`);
    }
  });

  it('horské kolo: things made *for* a mountain bike are not mountain bikes', () => {
    for (const sortBy of SORTS) {
      const top = titles(ranked('horske-kolo', sortBy).slice(0, 20));
      assert.deepEqual(top.filter((t) => /\b(na|pro)\s+(\S+\s+\/\s+)?horsk[eé] kolo/i.test(t)), [], sortBy);
    }
  });
});

describe('prices are compared like for like', () => {
  it('a Pro Max is not overpriced because it costs more than a mini', () => {
    const all = ranked('iphone-13');
    const vfmOf = (re: RegExp) => median(all.filter((l) => re.test(l.title)).map((l) => l.scoreComponents.valueForMoney));
    const proMax = vfmOf(/pro\s?max/i);
    const mini = vfmOf(/\bmini\b/i);
    // against one median for the whole search these were ~0.3 and ~0.9
    assert.ok(proMax > 0.4 && proMax < 0.6, `typical Pro Max value score ${proMax}`);
    assert.ok(mini > 0.4 && mini < 0.6, `typical mini value score ${mini}`);
  });

  it('says what each price was compared with', () => {
    const top = ranked('iphone-13').slice(0, 20);
    assert.ok(top.every((l) => l.priceCheck && l.priceCheck.sampleSize >= 5));
    assert.ok(top.some((l) => l.priceCheck?.basis === 'same_spec'));
  });

  it('a price far below comparable listings is flagged and not promoted', () => {
    const all = ranked('iphone-13');
    const flagged = all.filter((l) => l.priceCheck?.flag === 'suspiciously_low');
    assert.ok(flagged.length > 0, 'the fixture has base iPhone 13s at a third of the going rate');
    // the low price earns nothing: never more than a listing at the median gets
    assert.ok(flagged.every((l) => l.scoreComponents.valueForMoney <= 0.5));
    assert.ok(flagged.every((l) => l.scoreExplanation.some((line) => line.startsWith('Pozor:'))));
    // under half the going rate: out of the first two pages. A borderline case
    // (a Pro Max at 60 % with a lot of views) may stay higher — flagged.
    const extreme = all.findIndex((l) => l.priceCheck?.flag === 'suspiciously_low' && l.priceCheck.ratio < 0.5);
    assert.ok(extreme >= 50, `a listing under half the going rate ranks #${extreme + 1}`);
  });

  it('a filler price is not a bargain', () => {
    const filler = ranked('garmin-fenix-7').find((l) => l.price === 1234);
    assert.ok(filler, 'the "Fenix 7s PRO sapphire solar" listing at 1 234 Kč stays visible');
    assert.equal(filler.priceCheck?.flag, 'placeholder');
    assert.ok(ranked('garmin-fenix-7').indexOf(filler) >= 10);
  });
});

describe('a match that comes only from the description ranks behind title matches', () => {
  it('a swap ad for another phone does not sit among the iPhone 13s', () => {
    // Seen live on 2026-11-14 at #3 for "iphone 13" (fixtures carry no descriptions)
    const fixture = loadRankingFixture('iphone-13');
    const swapAd = {
      ...fixture.listings[0],
      id: 'bazos:swap-ad',
      sourceListingId: 'swap-ad',
      title: 'Galaxy S26 Ultra 12/512 + hodinky Výměna za iPhone',
      description: 'Vyměním Samsung Galaxy S26 Ultra za iPhone 13 nebo novější s doplatkem.',
      price: 25000,
      conditionText: 'v záruce',
      condition: 'new' as const,
    };
    for (const sortBy of SORTS) {
      const { results } = rankListings([...fixture.listings, swapAd], fixture.query, { sortBy }, czMarket);
      const at = results.findIndex((l) => l.id === swapAd.id);
      assert.ok(at >= 50, `${sortBy}: the swap ad ranks #${at + 1}`);
    }
  });
});

describe('searches without a model number are left as they were', () => {
  it('škoda octavia: a car search is not gated on numbers', () => {
    const all = ranked('skoda-octavia');
    assert.ok(all.length >= 100, `${all.length} listings kept`);
    assert.ok(all.slice(0, 20).every((l) => /octavi/i.test(l.title)));
    // engine sizes and years must not be read as models
    assert.ok(all.some((l) => /\b[12][.,]\d\s*t(d|s)i/i.test(l.title)));
  });

  it('lego: cheap is not suspicious when the search is wide', () => {
    const all = ranked('lego');
    assert.ok(all.length >= 400);
    assert.equal(all.filter((l) => l.priceCheck?.flag === 'suspiciously_low').length, 0);
  });
});
