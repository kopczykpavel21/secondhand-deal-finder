/**
 * extractDescriptionFromNgState tests.
 *
 * Run: npx tsx --test packages/source-adapters/src/aukro/aukro.test.ts
 *
 * Fixture shape (the `aukCache` key format, the "offers/{id}/offer" substring,
 * and the `.b.descriptionStripped` path) was captured from a real Aukro item
 * detail page on 2026-08-23 (aukro.cz/cerna-pracka-gorenje-7122657327), whose
 * ng-state carried "Koupená před 2 roky, plně funkční..." at exactly that path.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractDescriptionFromNgState, extractSearchItemsFromNgState } from './index.js';

function ngStateHtml(aukCache: Record<string, unknown>): string {
  const state = { aukCache };
  return `<html><body><script id="ng-state" type="application/json">${JSON.stringify(state)}</script></body></html>`;
}

const SEARCH_CACHE_KEY =
  'POST\x1c/backend-web/api/offers/searchItemsCommon\x1cpage=0&size=60\x1c{"text":"pračka"}\x1c{}';

describe('extractSearchItemsFromNgState', () => {
  // 2026-08-24 regression: a fresh live run returned "ng-state: found 0 items"
  // on every one of 9 queries. Aukro started serving the searchItemsCommon
  // cache entry pre-parsed as an object on at least some responses, instead of
  // always as a JSON string; the un-guarded JSON.parse(cacheVal) threw and was
  // silently swallowed by the surrounding catch. Confirmed against a real
  // captured search page (aukro.cz/vysledky-vyhledavani?text=pračka), which
  // parsed 0 items before the fix and 60 after.

  it('reads items when the cache value is a pre-parsed object', () => {
    const html = ngStateHtml({
      [SEARCH_CACHE_KEY]: { b: { content: [{ itemId: 1, itemName: 'Pračka A' }] } },
    });
    const items = extractSearchItemsFromNgState(html);
    assert.equal(items.length, 1);
    assert.equal(items[0].itemName, 'Pračka A');
  });

  it('still reads items when the cache value is a JSON-encoded string', () => {
    const html = ngStateHtml({
      [SEARCH_CACHE_KEY]: JSON.stringify({ b: { content: [{ itemId: 2, itemName: 'Pračka B' }] } }),
    });
    const items = extractSearchItemsFromNgState(html);
    assert.equal(items.length, 1);
    assert.equal(items[0].itemName, 'Pračka B');
  });

  it('returns an empty array, not a throw, for malformed cached JSON string', () => {
    const html = ngStateHtml({ [SEARCH_CACHE_KEY]: '{not valid json' });
    assert.deepEqual(extractSearchItemsFromNgState(html), []);
  });

  it('returns an empty array when no searchItemsCommon key is present', () => {
    const html = ngStateHtml({ 'unit-code-mappings': ['x'] });
    assert.deepEqual(extractSearchItemsFromNgState(html), []);
  });

  it('returns an empty array when there is no ng-state at all', () => {
    assert.deepEqual(extractSearchItemsFromNgState('<html><body>nothing</body></html>'), []);
  });
});

describe('extractDescriptionFromNgState', () => {
  it('reads descriptionStripped from the offer-detail cache entry', () => {
    const html = ngStateHtml({
      'GET/backend-web/api/offers/7122657327/offerDetailpageType=DETAIL': {
        t: 1,
        b: {
          descriptionInHtml: '<div>Koupená před 2 roky.</div>',
          descriptionStripped: 'Koupená před 2 roky, plně funkční, čistá a bez vad.',
        },
      },
    });
    assert.equal(
      extractDescriptionFromNgState(html),
      'Koupená před 2 roky, plně funkční, čistá a bez vad.',
    );
  });

  it('handles the cache value arriving as a JSON string, not a parsed object', () => {
    const html = ngStateHtml({
      'GET/backend-web/api/offers/123/offer': JSON.stringify({
        b: { descriptionStripped: 'Plně funkční pračka.' },
      }),
    });
    assert.equal(extractDescriptionFromNgState(html), 'Plně funkční pračka.');
  });

  it('ignores unrelated cache entries and finds the offer one among them', () => {
    const html = ngStateHtml({
      'unit-code-mappings': ['x', 'y'],
      'GET/backend-web/api/registry/supported-countries': { list: [] },
      'GET/backend-web/api/offers/999/offerDetail': { b: { descriptionStripped: 'Found it.' } },
    });
    assert.equal(extractDescriptionFromNgState(html), 'Found it.');
  });

  it('returns null when descriptionStripped is missing', () => {
    const html = ngStateHtml({
      'GET/backend-web/api/offers/1/offer': { b: { images: [] } },
    });
    assert.equal(extractDescriptionFromNgState(html), null);
  });

  it('returns null when descriptionStripped is an empty string', () => {
    const html = ngStateHtml({
      'GET/backend-web/api/offers/1/offer': { b: { descriptionStripped: '   ' } },
    });
    assert.equal(extractDescriptionFromNgState(html), null);
  });

  it('returns null when there is no ng-state script tag at all', () => {
    assert.equal(extractDescriptionFromNgState('<html><body>no data here</body></html>'), null);
  });

  it('returns null on malformed ng-state JSON rather than throwing', () => {
    const html = '<script id="ng-state" type="application/json">{not valid json</script>';
    assert.equal(extractDescriptionFromNgState(html), null);
  });
});
