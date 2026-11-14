/**
 * Like-for-like price reference tests.
 *
 * Run: npx tsx --test packages/scoring/src/components/value-for-money.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPriceReference, type PricedListing } from './value-for-money.js';
import type { ProductSignature } from './product-signature.js';

const sig = (variants: string[], storageGb: number | null, modelKey: string | null = '13'): ProductSignature =>
  ({ model: modelKey ? 'match' : 'unknown', variants, storageGb, modelKey });
const many = (n: number, price: number, signature: ProductSignature, step = 100): PricedListing[] =>
  Array.from({ length: n }, (_, i) => ({ price: price + (i - Math.floor(n / 2)) * step, signature, comparable: true }));

const base128 = sig([], 128);
const proMax256 = sig(['max', 'pro'], 256);
const mini = sig(['mini'], null);

describe('buildPriceReference', () => {
  const ref = buildPriceReference([
    ...many(11, 5400, base128),
    ...many(9, 9000, proMax256),
    ...many(3, 3500, mini),
  ]);

  it('compares a listing with its own model, variant and storage', () => {
    const base = ref.assess(5400, base128);
    assert.equal(base.check?.basis, 'same_spec');
    assert.equal(base.check?.referencePrice, 5400);
    assert.equal(base.score, 0.5);

    // 9 000 Kč is the going rate for a Pro Max 256, not "67 % over the median"
    const pro = ref.assess(9000, proMax256);
    assert.equal(pro.check?.referencePrice, 9000);
    assert.equal(pro.score, 0.5);
  });

  it('falls back to a wider group when the narrow one is too small', () => {
    // 3 minis are not enough → whole model family (all 23 listings)
    assert.equal(ref.assess(3500, mini).check?.basis, 'model_family');
    // a title that states no model at all → the whole search
    assert.equal(ref.assess(5000, sig([], null, null)).check?.basis, 'search');
  });

  it('rewards a lower price within the plausible range', () => {
    assert.ok(ref.assess(4300, base128).score > ref.assess(5400, base128).score);
    assert.equal(ref.assess(4300, base128).check?.flag, undefined);
  });

  it('does not reward a price far below comparable listings', () => {
    const cheap = ref.assess(1700, base128);
    assert.equal(cheap.check?.flag, 'suspiciously_low');
    // a third of the going rate: clearly below a listing at the median
    assert.ok(cheap.score < ref.assess(5400, base128).score);
    // just under the limit (58 %): close to the median score, not buried
    const borderline = ref.assess(3150, base128);
    assert.equal(borderline.check?.flag, 'suspiciously_low');
    assert.ok(borderline.score > 0.45 && borderline.score <= 0.5, String(borderline.score));
    assert.ok(cheap.score < borderline.score);
  });

  it('treats a filler price as no price', () => {
    const filler = ref.assess(1234, base128);
    assert.equal(filler.check?.flag, 'placeholder');
    assert.equal(filler.score, ref.assess(null, base128).score);
  });

  it('keeps filler and irrelevant prices out of the reference', () => {
    const withJunk = buildPriceReference([
      ...many(11, 5400, base128),
      ...Array.from({ length: 30 }, () => ({ price: 1, signature: base128, comparable: true })),
      ...Array.from({ length: 30 }, () => ({ price: 150, signature: base128, comparable: false })),
    ]);
    assert.equal(withJunk.assess(5400, base128).check?.referencePrice, 5400);
  });
});

describe('a wide search is not a suspicious one', () => {
  it('does not flag a cheap listing when prices are spread out', () => {
    // "horské kolo": children's bikes to e-bikes
    const none = sig([], null, null);
    const prices = [500, 800, 1200, 1500, 2500, 4000, 6000, 9000, 15000, 25000, 40000, 60000];
    const ref = buildPriceReference(prices.map((price) => ({ price, signature: none, comparable: true })));
    assert.equal(ref.assess(800, none).check?.flag, undefined);
    assert.ok(ref.assess(800, none).score > 0.9);
  });
});
