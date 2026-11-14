/**
 * Product signature tests.
 *
 * Run: npx tsx --test packages/scoring/src/components/product-signature.test.ts
 *
 * Titles are real listings from the 2026-11-13 fixtures (packages/core/src/
 * __fixtures__/ranking) — the ones the old ranking put at the top of an
 * "iphone 13" / "garmin fenix 7" / "samsung galaxy s23" search.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createProductMatcher, isPatternPrice } from './product-signature.js';
import { scoreRelevance } from './relevance.js';

const sig = (query: string, title: string, family: 'vehicle' | 'device' | 'other' = 'device') =>
  createProductMatcher(query, { family, stopwords: new Set(['s', 'na', 'do', 'pro']) }).signature(title);

describe('model match', () => {
  it('tells the pinned model from other models of the line', () => {
    assert.equal(sig('iphone 13', 'Apple iPhone 13 128GB top stav').model, 'match');
    assert.equal(sig('iphone 13', 'Apple iPhone 5 16-64GB').model, 'conflict');
    assert.equal(sig('iphone 13', 'Apple iPhone 17 pro 256gb v záruce').model, 'conflict');
    assert.equal(sig('iphone 13', 'iPhone 14 Pro 512GB Gold (Zlatý)').model, 'conflict');
    assert.equal(sig('garmin fenix 7', 'Garmin Fénix 5x').model, 'conflict');
    assert.equal(sig('garmin fenix 7', 'GARMIN FENIX 7X SOLAR').model, 'match');
  });

  it('does not guess when the title names no model', () => {
    assert.equal(sig('iphone 13', 'Prodám iPhone, málo používaný').model, 'unknown');
    assert.equal(sig('garmin fenix 7', 'Garmin 7 fenix solar').model, 'unknown');
  });

  it('accepts a title that lists several models', () => {
    assert.equal(sig('iphone 13', 'Kryt iPhone 12/13/14').model, 'match');
    assert.equal(sig('garmin fenix 7', 'Premium punjač za Garmin (Fenix 8/7/6/5, Epix)').model, 'match');
  });

  it('reads letter+digit models and aliases', () => {
    assert.equal(sig('samsung galaxy s23', 'Samsung Galaxy S23 Ultra 12GB/512GB').model, 'match');
    assert.equal(sig('samsung galaxy s23', 'Samsung Galaxy S22 128GB').model, 'conflict');
    assert.equal(sig('samsung galaxy s23', 'Samsung Galaxy S23 s krabicí a 2 kryty').model, 'match');
    assert.equal(sig('playstation 5', 'konsola playstation 4 +3 pady').model, 'conflict');
    assert.equal(sig('playstation 5', 'Sony PS5 Slim 1TB').model, 'match');
    assert.equal(sig('macbook air m1', 'MacBook Air M2 2022').model, 'conflict');
    assert.equal(sig('macbook air m1', 'MacBook Air 13" M1 (256GB)').model, 'match');
  });

  it('ignores decimals and years next to the model word', () => {
    assert.equal(sig('golf 7', 'VW Golf 1.6 TDI 2015', 'other').model, 'unknown');
    assert.equal(sig('golf 7', 'VW Golf 7 1.6 TDI', 'other').model, 'match');
    assert.equal(sig('ipad 9', 'iPad 10.2 2021 64GB').model, 'unknown');
    assert.equal(sig('macbook pro 13', 'MacBook Pro 2019 Touch Bar').model, 'unknown');
  });

  it('does not pin specs, years or numbers after a preposition', () => {
    const pinned = (q: string) =>
      createProductMatcher(q, { family: 'other', stopwords: new Set(['do', 'na', 's']) }).pinned;
    assert.equal(pinned('pračka bosch 8 kg'), false);
    assert.equal(pinned('macbook pro 2019'), false);
    assert.equal(pinned('kolo do 5000'), false);
    assert.equal(pinned('horské kolo'), false);
    assert.equal(pinned('iphone 13'), true);
    assert.equal(pinned('s23'), true);
  });

  it('leaves car searches alone', () => {
    const m = createProductMatcher('škoda octavia 3', { family: 'vehicle' });
    assert.equal(m.pinned, false);
    assert.equal(m.signature('Škoda Octavia 2.0 TDI 110kW').model, 'unknown');
  });
});

describe('variant and storage', () => {
  it('reads variant words after the model number', () => {
    assert.deepEqual(sig('iphone 13', 'iPhone 13 Pro Max 256 Gb').variants, ['max', 'pro']);
    assert.deepEqual(sig('iphone 13', 'Iphone 13 mini 128GB 100%').variants, ['mini']);
    assert.deepEqual(sig('iphone 13', 'iPhone 13 128GB Green,1 rok záruka').variants, []);
    assert.deepEqual(sig('garmin fenix 7', 'Garmin Fenix 7X Sapphire Solar').variants, ['sapphire', 'solar', 'x']);
    assert.deepEqual(sig('playstation 5', 'Prodám nový Playstation 5 Slim - Digitalní verze').variants, ['digital', 'slim']);
    assert.deepEqual(sig('samsung galaxy s23', 'Samsung galaxy s23+').variants, ['plus']);
  });

  it('does not read ordinary words as variants', () => {
    // "s" = "with", "super stan" = "great condition"
    assert.deepEqual(sig('iphone 13', 'iPhone 13 s krabicí').variants, []);
    assert.deepEqual(sig('iphone 13', 'iPhone 13 zestaw | 81% | 128gb | super stan').variants, []);
    assert.deepEqual(sig('playstation 5', 'PS5 + 2 ovladače').variants, []);
  });

  it('reads storage, taking the larger figure when RAM is listed too', () => {
    assert.equal(sig('iphone 13', 'iPhone 13 128 GB').storageGb, 128);
    assert.equal(sig('samsung galaxy s23', 'Samsung Galaxy S23 Ultra 12GB/512GB').storageGb, 512);
    assert.equal(sig('playstation 5', 'Sony PlayStation 5 Pro 2TB').storageGb, 2048);
    assert.equal(sig('iphone 13', 'iPhone 13, baterie 100%').storageGb, null);
  });

  it('groups an unpinned search by the number the title itself gives', () => {
    assert.equal(sig('iphone', 'Apple iPhone 13 128GB').modelKey, '13');
    assert.equal(sig('iphone', 'iPhone 8 64GB').modelKey, '8');
    assert.equal(sig('iphone', 'Apple iPhone, top stav').modelKey, null);
  });
});

describe('relevance keeps the model number', () => {
  it('scores the wrong model lower than the right one', () => {
    const right = scoreRelevance('iphone 13', 'Apple iPhone 13 128GB', null);
    const wrong = scoreRelevance('iphone 13', 'Apple iPhone 5 16-64GB', null);
    assert.equal(right, 1);
    assert.ok(wrong < 0.7, `iPhone 5 scored ${wrong}`);
  });

  it('keeps the short pieces of a letter+digit model', () => {
    assert.equal(scoreRelevance('samsung galaxy s23', 'Samsung Galaxy S23 256GB', null), 1);
    assert.ok(scoreRelevance('samsung galaxy s23', 'Samsung Galaxy A54 5G', null) < 0.7);
  });
});

describe('isPatternPrice', () => {
  it('flags filler prices only', () => {
    for (const p of [1, 111, 1111, 123, 1234, 12345, 99999]) assert.equal(isPatternPrice(p), true, String(p));
    for (const p of [12, 999, 1200, 1235, 5400, 370.13, null]) assert.equal(isPatternPrice(p), false, String(p));
  });
});
