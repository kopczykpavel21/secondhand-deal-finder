/**
 * Listing-kind filter tests.
 *
 * Run: npx tsx --test packages/scoring/src/components/listing-kind.test.ts
 *
 * Titles, categories and prices are real listings captured from Sbazar, Aukro,
 * Bazoš, Vinted and Sprzedajemy on 2026-10-30 while tuning the filter.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Source } from '@sdf/types';
import { czMarket } from '@sdf/types';
import { analyzeQuery, categoryKind, createListingKindFilter } from './listing-kind.js';
import { scoreRelevance, tokenize } from './relevance.js';

type L = { title: string; source: Source; price: number | null; category?: string | null };
const l = (title: string, source: Source, price: number | null, category?: string): L =>
  ({ title, source, price, category: category ?? null });

/** Product-category listings that give the filter a typical product price. */
function withProducts(price: number, category: string, source: Source = 'sbazar'): L[] {
  return Array.from({ length: 8 }, (_, i) => l(`Produkt ${i}`, source, price, category));
}

function kindsFor(query: string, items: L[], context: L[] = []) {
  const filter = createListingKindFilter(query, [...items, ...context], czMarket);
  return items.map((item) => filter(item));
}

describe('tokenize', () => {
  it('keeps Polish, German and Greek letters instead of cutting words apart', () => {
    assert.deepEqual(tokenize('Ładowarka do iPhone'), ['ladowarka', 'do', 'iphone']);
    assert.deepEqual(tokenize('Hülle für Galaxy'), ['hulle', 'fur', 'galaxy']);
    assert.deepEqual(tokenize('Ποδήλατο βουνού'), ['ποδηλατο', 'βουνου']);
  });

  it('still strips Czech diacritics the way it always did', () => {
    assert.deepEqual(tokenize('Škoda Octavia – přední světlo'), ['skoda', 'octavia', 'predni', 'svetlo']);
  });
});

describe('analyzeQuery', () => {
  it('recognises car and device searches, and when nothing else is asked for', () => {
    assert.equal(analyzeQuery('škoda octavia').family, 'vehicle');
    assert.equal(analyzeQuery('škoda octavia').pure, true);
    assert.equal(analyzeQuery('playstation 5').family, 'device');
    assert.equal(analyzeQuery('iphone 13 modrý').pure, true);
    assert.equal(analyzeQuery('fifa 23 ps5').pure, false);
    assert.equal(analyzeQuery('horské kolo').family, 'other');
  });

  it('does not turn ambiguous words into car searches', () => {
    assert.equal(analyzeQuery('tesla rádio').family, 'other');
    assert.equal(analyzeQuery('golf hole').family, 'other');
    assert.equal(analyzeQuery('ktm kolo').family, 'other');
  });

  it('notes what the query asks for', () => {
    assert.ok(analyzeQuery('kryt iphone 13').wants.has('accessory'));
    assert.ok(analyzeQuery('lego porsche').wants.has('toy'));
    assert.ok(analyzeQuery('alu kola octavia').wants.has('part'));
    assert.ok(analyzeQuery('iphone 13 na díly').wants.has('for_parts'));
    assert.equal(analyzeQuery('horské kolo').wants.size, 0);
  });
});

describe('categoryKind', () => {
  it('reads Sbazar, Aukro, Sprzedajemy and Bazoš categories', () => {
    assert.equal(categoryKind('Náhradní díly a příslušenství'), 'part');
    assert.equal(categoryKind('Modelářství > Modely automobilů > Kovové a sběratelské modely aut > Modely aut 1:43 –⁠ 1:49'), 'toy');
    assert.equal(categoryKind('Hry > Hry na Sony PlayStation 5 (PS5)'), 'media');
    assert.equal(categoryKind('PlayStation Gamepady > PS5 ovladače'), 'accessory');
    assert.equal(categoryKind('elektronika > telefony i akcesoria > akcesoria gsm > Pokrowce, futerały i kabury'), 'accessory');
    assert.equal(categoryKind('dla dziecka > zabawki > Klocki dla dzieci'), 'toy');
    assert.equal(categoryKind('sluzby'), 'service');
  });

  it('leaves product categories alone, including mixed parents', () => {
    assert.equal(categoryKind('Herní zařízení > Herní konzole > PlayStation > PlayStation 5'), null);
    assert.equal(categoryKind('elektronika > telefony i akcesoria > telefony komorkowe > Telefony Apple, iPhone'), null);
    assert.equal(categoryKind('kultura i rozrywka > gry komputerowe i konsolowe > Konsole i automaty'), null);
    assert.equal(categoryKind('Cyklobazar > Horská (MTB) kola'), null);
    // Sbazar files monitors, keyboards and mice here
    assert.equal(categoryKind('PC příslušenství'), null);
  });
});

describe('createListingKindFilter — car searches', () => {
  const cars = withProducts(229_900, 'Škoda');

  it('hides parts, scale models and listings from sites that sell no cars', () => {
    const kinds = kindsFor('škoda octavia', [
      l('Zámky ŠKODA Octavia 3', 'sbazar', 500, 'Náhradní díly a příslušenství'),
      l('Škoda Octavia RS lll FL 1/43 DeA', 'vinted', 420),
      l('Škoda Octavia Combi 2.0 TDI', 'aukro', 900, 'Modelářství > Modely automobilů > Kovové a sběratelské modely aut > Modely aut 1:43 –⁠ 1:49'),
      l('Hledáme automechanika do servisu Porsche', 'bazos', null, 'prace'),
    ], cars);
    assert.deepEqual(kinds, ['part', 'accessory', 'toy', 'accessory']);
  });

  it('keeps the cars — including one misfiled under spare parts', () => {
    const kinds = kindsFor('škoda octavia', [
      l('Škoda Octavia 4 Combi 2.0 TDI 110kW DSG', 'bazos', 369_000, 'auto'),
      l('Škoda Octavia, 1,6 ČR, SERVISNÍ KNÍŽKA', 'sbazar', 59_900, 'Škoda'),
      l('Škoda Octavia Octavie 1 Tour combi 1.9TDI tažné', 'sbazar', 89_000, 'Náhradní díly a příslušenství'),
    ], cars);
    assert.deepEqual(kinds, [null, null, null]);
  });

  it('shows parts and toys when the query asks for them', () => {
    assert.deepEqual(
      kindsFor('alu kola octavia', [l('Alu kola R16 Škoda Octavia', 'sbazar', 6000, 'Kola a disky')], cars),
      [null],
    );
    assert.deepEqual(
      kindsFor('lego porsche', [l('LEGO 42056 Porsche', 'aukro', 23_499, 'Hračky > LEGO > LEGO sety')], cars),
      [null],
    );
  });
});

describe('createListingKindFilter — device searches', () => {
  const phones = withProducts(5000, 'iPhone');

  it('hides sold-for-parts phones, empty boxes and accessories', () => {
    const kinds = kindsFor('iphone 13', [
      l('Apple iPhone 13 na ND!!!', 'sbazar', 300, 'iPhone'),
      l('Nefunkční iphone 13 pro max', 'sbazar', 950, 'iPhone'),
      l('iphone 13 prazdna krabica box', 'vinted', 98),
      l('Krabičky iPhone 12, 13, 14 (Pro Max mini) 15 ks', 'aukro', 990, 'Mobilní telefony > iPhone'),
      l('Quadlock Magcase iphone 13', 'sbazar', 450, 'Mobil - příslušenství'),
    ], phones);
    assert.deepEqual(kinds, ['for_parts', 'for_parts', 'packaging', 'packaging', 'accessory']);
  });

  it('keeps phones that sellers misfiled or sold with extras', () => {
    const kinds = kindsFor('iphone 13', [
      l('iPhone 13', 'sbazar', 6500, 'Mobil - příslušenství'),
      l('iPhone 13 + etui + szybka', 'vinted', 4209),
      l('iPhone 13 mini (128GB) - nová baterie, krabička', 'sbazar', 5290, 'Mobil - příslušenství'),
    ], phones);
    assert.deepEqual(kinds, [null, null, null]);
  });

  it('hides games for a bare console search, but not for a game search', () => {
    const consoles = withProducts(9000, 'Herní konzole');
    assert.deepEqual(
      kindsFor('playstation 5', [
        l('Hry na Playstation 5', 'sbazar', 350, 'Herní konzole'),
        l('Ovladače na ps5 (originální dualsense)', 'bazos', 750, 'pc'),
        l('PS5 + 2 ovladače + 3 hry', 'bazos', 9500, 'pc'),
      ], consoles),
      ['media', 'accessory', null],
    );
    assert.deepEqual(
      kindsFor('fifa 23 ps5', [l('PlayStation 5, PS5 hra FIFA 23', 'sbazar', 350, 'Počítačové hry')], consoles),
      [null],
    );
  });

  it('hides watch straps but keeps watches whose model name ends in "Band"', () => {
    const watches = withProducts(6000, 'Chytré hodinky');
    assert.deepEqual(
      kindsFor('garmin hodinky', [
        l('Nabíjecí Kabel Garmin (pro Vívoactive/Vívoactive HR)', 'sbazar', 99, 'Chytré hodinky'),
        l('Garmin Epix Pro 47mm Slate Gray/Black Band', 'vinted', 8500),
      ], watches),
      ['accessory', null],
    );
  });
});

describe('createListingKindFilter — other searches', () => {
  it('never hides toys or games when they are what was searched', () => {
    const toys = withProducts(800, 'Hračky > LEGO > LEGO sety', 'aukro');
    assert.deepEqual(kindsFor('lego', [l('LEGO stavebnice 42115', 'sbazar', 3000, 'Lego stavebnice')], toys), [null]);
    assert.deepEqual(kindsFor('autodráha', [l('Autodráha Carrera GO 1:43', 'sbazar', 900, 'Autodráhy')], toys), [null]);
  });

  it('hides parts and accessories only when they are a minority of the results', () => {
    const washers = withProducts(3000, 'Pračky');
    const parts = [l('ZÁVĚS OKNA PRAČKY BOSCH CLASIXX', 'aukro', 315, 'Velké elektrospotřebiče > Příslušenství k velkým elektrospotřebičům')];
    assert.deepEqual(kindsFor('pračka bosch', parts, washers), ['accessory']);

    // "xenony": nearly every result is in a parts category, so parts are the product
    const xenons = Array.from({ length: 10 }, (_, i) =>
      l(`Xenon světlo ${i}`, 'sbazar', 1500, 'Světla, blinkry a osvětlení'));
    assert.deepEqual(kindsFor('xenony', xenons.slice(0, 1), xenons.slice(1)), [null]);
  });

  it('trusts a title that is exactly the query over a wrong category', () => {
    const bikes = withProducts(5000, 'Kola');
    assert.deepEqual(kindsFor('horské kolo', [l('Horské kolo Author', 'sbazar', 750, 'Kola a disky')], bikes), [null]);
  });

  it('always hides wanted ads and repair offers, never "a new owner" offers', () => {
    assert.deepEqual(
      kindsFor('autodráha', [
        l('KOUPÍM: Autodráha Irisa GRAPA', 'bazos', null, 'deti'),
        l('Čištění, servis, oprava konzolí PlayStation (PS4) (PS5)', 'bazos', 499, 'sluzby'),
        l('Hledám nového majitele - autodráha Carrera', 'bazos', 600, 'deti'),
      ]),
      ['wanted', 'service', null],
    );
  });
});

describe('scoreRelevance accessory guard', () => {
  it('no longer hides real products because of ambiguous words', () => {
    assert.ok(scoreRelevance('monitor dell', 'LCD monitor Dell 24"', null, czMarket) > 0.5);
    assert.ok(scoreRelevance('horské kolo', 'Horská kola 2ks', null, czMarket) > 0.5);
    assert.ok(scoreRelevance('lego', 'LEGO stavebnice 42115', null, czMarket) > 0.5);
  });

  it('steps aside when the query asks for accessories in words it does not know', () => {
    assert.equal(scoreRelevance('alu kola', '4x alu kola + letní pneu', null, czMarket), 0.05);
    assert.ok(scoreRelevance('alu kola', '4x alu kola + letní pneu', null, czMarket, { queryWantsAccessories: true }) > 0.5);
  });
});
